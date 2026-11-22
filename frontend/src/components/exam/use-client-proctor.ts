"use client";

import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/client/api";

type HintKind = "face_missing" | "multiple_faces" | "phone_detected";

/** TF.js BlazeFace hints beside the GPU proctor path (ADR-0078 phase 3). Fail-soft. */
export function useClientProctor(
  enabled: boolean,
  tenantId: string | undefined,
  attemptId: string | undefined,
  video: HTMLVideoElement | null,
  intervalMs = 12_000,
) {
  const model = useRef<Awaited<ReturnType<typeof loadModel>> | null>(null);
  const busy = useRef(false);
  const faces = useRef(0);

  const analyze = useCallback(async () => {
    if (!enabled || !video || !tenantId || !attemptId || video.readyState < 2 || busy.current) return;
    busy.current = true;
    try {
      const detector = model.current ?? (await loadModel());
      model.current = detector;
      if (!detector) return;
      const predictions = await detector.estimateFaces(video, false);
      faces.current = predictions.length;
      let kind: HintKind | null = null;
      let confidence = 0;
      if (predictions.length === 0) {
        kind = "face_missing";
        confidence = 0.85;
      } else if (predictions.length > 1) {
        kind = "multiple_faces";
        confidence = Math.min(0.95, 0.7 + predictions.length * 0.05);
      } else if (predictions[0]!.probability[0]! > 0.92) {
        // BlazeFace does not detect phones; keep the hook extensible for a second pass later.
        void predictions;
      }
      if (!kind) return;
      await api(`/submission/v1/tenants/${tenantId}/attempts/${attemptId}/client-proctor-hints`, {
        method: "POST",
        body: { kind, confidence },
        cache: "no-store",
      }).catch(() => undefined);
    } catch {
      // Fail-soft: a broken model must not disturb the exam.
    } finally {
      busy.current = false;
    }
  }, [enabled, tenantId, attemptId, video]);

  useEffect(() => {
    if (!enabled || !video) return;
    const timer = setInterval(() => void analyze(), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, video, analyze, intervalMs]);
}

async function loadModel() {
  try {
    const tf = await import("@tensorflow/tfjs");
    await tf.setBackend("webgl");
    const blazeface = await import("@tensorflow-models/blazeface");
    return await blazeface.load({ maxFaces: 3 });
  } catch {
    return null;
  }
}