"""GPU inference pipeline using YOLOv8x + MediaPipe FaceMesh."""
import io
import logging
import time
from pathlib import Path

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# COCO class IDs that matter for proctoring.
_PERSON = 0
_PHONE = 67


class Detector:
    """Loads models once; analyze() is safe to call from multiple threads via executor."""

    def __init__(self, model_path: str = "yolov8x.pt", conf_person: float = 0.60, conf_phone: float = 0.50) -> None:
        from ultralytics import YOLO

        self._yolo = YOLO(model_path)
        self._yolo.to("cuda")
        self._conf_person = conf_person
        self._conf_phone = conf_phone
        logger.info("YOLOv8x loaded on CUDA")

        # MediaPipe FaceMesh — running server-side gives us 468 landmarks
        # for gaze/head-pose without any client-side JavaScript.
        try:
            import mediapipe as mp
            self._face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=True, max_num_faces=4, refine_landmarks=True
            )
            logger.info("MediaPipe FaceMesh loaded")
        except Exception as exc:
            logger.warning("MediaPipe unavailable: %s — face-mesh checks disabled", exc)
            self._face_mesh = None

    def analyze(self, jpeg_bytes: bytes) -> list[dict]:
        """Return a list of violation dicts. Thread-safe (model inference is stateless)."""
        t0 = time.monotonic()
        img_pil = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        img_np = np.array(img_pil)

        violations: list[dict] = []

        # ── YOLO: person and phone detection ──────────────────────────────────
        results = self._yolo(img_np, verbose=False, device="cuda")[0]
        persons = [b for b in results.boxes if int(b.cls) == _PERSON and float(b.conf) >= self._conf_person]
        phones  = [b for b in results.boxes if int(b.cls) == _PHONE  and float(b.conf) >= self._conf_phone]

        if len(persons) == 0:
            violations.append({"kind": "face_missing", "confidence": 0.90, "details": "no person in frame"})
        elif len(persons) > 1:
            violations.append({
                "kind": "multiple_faces",
                "confidence": float(persons[1].conf),
                "details": f"{len(persons)} people detected",
            })

        for phone in phones:
            violations.append({
                "kind": "phone_detected",
                "confidence": float(phone.conf),
                "details": "cell phone detected by YOLOv8x",
            })

        # ── MediaPipe: gaze deviation ─────────────────────────────────────────
        if self._face_mesh and len(persons) == 1 and not violations:
            gaze = self._check_gaze(img_np)
            if gaze:
                violations.append(gaze)

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.debug("analyze() finished in %dms, %d violation(s)", elapsed_ms, len(violations))
        return violations

    def _check_gaze(self, img_np: np.ndarray) -> dict | None:
        """Return a gaze_away violation if the iris is too far from center, else None."""
        import mediapipe as mp

        h, w = img_np.shape[:2]
        res = self._face_mesh.process(img_np)
        if not res.multi_face_landmarks:
            return None

        lm = res.multi_face_landmarks[0].landmark
        # MediaPipe iris indices: left iris center=473, right iris center=468
        # Eye corner indices: left outer=33, left inner=133, right outer=362, right inner=263
        def px(idx: int) -> tuple[float, float]:
            return lm[idx].x * w, lm[idx].y * h

        # Left eye: iris x relative to eye width
        iris_l_x = px(473)[0]
        eye_l_left, eye_l_right = px(33)[0], px(133)[0]
        ratio_l = (iris_l_x - eye_l_left) / max(eye_l_right - eye_l_left, 1)

        # Right eye
        iris_r_x = px(468)[0]
        eye_r_left, eye_r_right = px(362)[0], px(263)[0]
        ratio_r = (iris_r_x - eye_r_left) / max(eye_r_right - eye_r_left, 1)

        avg = (ratio_l + ratio_r) / 2
        # 0.35–0.65 is "looking at screen"; outside → looking away
        if avg < 0.30 or avg > 0.70:
            direction = "left" if avg < 0.30 else "right"
            return {
                "kind": "gaze_away",
                "confidence": round(abs(avg - 0.5) * 2, 2),
                "details": f"gaze deviation {direction} (iris ratio {avg:.2f})",
            }
        return None
