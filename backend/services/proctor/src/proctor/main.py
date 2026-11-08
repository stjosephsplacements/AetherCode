"""Proctoring service.

Architecture:
  - HTTP /healthz and /analyze (for direct testing / smoke checks)
  - NATS core consumer on proctor.analyze — receives SnapshotEvent JSON
    published by the submission service after StoreSnapshot succeeds
  - Downloads JPEG from MinIO, runs Detector.analyze() in a thread pool
    (keeps the event loop free), posts violation events back to submission
    via POST /v1/tenants/{t}/attempts/{a}/events (internal mTLS not yet
    wired — shortcut: plain HTTP inside cluster; add mTLS when needed)
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
import nats
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from minio import Minio

from .config import settings
from .detector import Detector
from .models import AnalysisResult, SnapshotEvent, Violation

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("proctor")

_detector: Detector | None = None
_minio: Minio | None = None
# Per-(attempt_id, kind) → last violation timestamp; used for cooldown.
_last_violation: dict[tuple[str, str], float] = {}


@asynccontextmanager
async def lifespan(application: FastAPI):
    global _detector, _minio
    logger.info("Loading YOLOv8x on GPU…")
    _detector = Detector(
        model_path=settings.yolo_model,
        conf_person=settings.confidence_person,
        conf_phone=settings.confidence_phone,
    )
    _minio = Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,
    )
    logger.info("Starting NATS consumer on %s", settings.nats_subject)
    asyncio.create_task(_consume())
    yield
    logger.info("Proctor shutting down")


app = FastAPI(title="AetherCode Proctor", lifespan=lifespan)


async def _consume() -> None:
    nc = await nats.connect(settings.nats_url)
    sub = await nc.subscribe(settings.nats_subject)
    logger.info("NATS subscribed to %s", settings.nats_subject)
    async for msg in sub.messages:
        try:
            event = SnapshotEvent.model_validate_json(msg.data)
            asyncio.create_task(_process(event))
        except Exception as exc:
            logger.warning("Bad NATS message: %s", exc)


async def _process(event: SnapshotEvent) -> None:
    assert _detector is not None and _minio is not None
    t0 = time.monotonic()
    try:
        response = _minio.get_object(settings.minio_bucket, event.storage_key)
        jpeg = response.read()
        response.close()
    except Exception as exc:
        logger.error("Cannot fetch snapshot %s: %s", event.snapshot_id, exc)
        return

    loop = asyncio.get_event_loop()
    raw_violations = await loop.run_in_executor(None, _detector.analyze, jpeg)
    elapsed = int((time.monotonic() - t0) * 1000)
    logger.info("Snapshot %s analyzed in %dms: %d violation(s)", event.snapshot_id, elapsed, len(raw_violations))

    if not raw_violations:
        return

    now = time.monotonic()
    async with httpx.AsyncClient(base_url=settings.submission_url, timeout=10) as client:
        for v in raw_violations:
            key = (event.attempt_id, v["kind"])
            if now - _last_violation.get(key, 0) < settings.violation_cooldown_seconds:
                continue
            _last_violation[key] = now
            try:
                r = await client.post(
                    f"/v1/tenants/{event.tenant_id}/attempts/{event.attempt_id}/events",
                    json={"kind": v["kind"]},
                    headers={"X-Internal-Proctor": "true"},
                )
                r.raise_for_status()
            except Exception as exc:
                logger.warning("Failed to post violation %s: %s", v["kind"], exc)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "model_loaded": _detector is not None}


@app.post("/analyze", response_model=AnalysisResult)
async def analyze(event: SnapshotEvent) -> AnalysisResult:
    """Direct HTTP trigger — useful for smoke testing without NATS."""
    assert _detector is not None and _minio is not None
    t0 = time.monotonic()
    response = _minio.get_object(settings.minio_bucket, event.storage_key)
    jpeg = response.read()
    response.close()
    loop = asyncio.get_event_loop()
    raw = await loop.run_in_executor(None, _detector.analyze, jpeg)
    return AnalysisResult(
        snapshot_id=event.snapshot_id,
        attempt_id=event.attempt_id,
        tenant_id=event.tenant_id,
        violations=[Violation(**v) for v in raw],
        processing_ms=int((time.monotonic() - t0) * 1000),
    )
