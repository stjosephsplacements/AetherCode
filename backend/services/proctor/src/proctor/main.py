"""Proctoring service.

Architecture:
  - HTTP /healthz and /analyze (for direct testing / smoke checks)
  - NATS core consumer on proctor.analyze — receives SnapshotEvent JSON
    published by the submission service after StoreSnapshot succeeds
  - Downloads JPEG from MinIO, runs Detector.analyze() in a thread pool
    (keeps the event loop free), writes violations to Prisma DB, posts
    integrity events back to the submission service.

Database (Prisma):
  - Cooldown check: last violation of (attempt_id, kind) within cooldown window
  - Idempotency: ProcessedSnapshot table prevents re-analyzing the same frame
  - All violations are persisted for audit / replay

Run `prisma generate` to regenerate the Python client after schema changes.
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import httpx
import nats
from fastapi import FastAPI
from minio import Minio
from prisma import Prisma

from .config import settings
from .detector import Detector
from .models import AnalysisResult, SnapshotEvent, Violation

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("proctor")

_detector: Detector | None = None
_minio: Minio | None = None
_db: Prisma | None = None


@asynccontextmanager
async def lifespan(application: FastAPI):
    global _detector, _minio, _db

    logger.info("Connecting to Prisma DB…")
    _db = Prisma()
    await _db.connect()
    logger.info("Prisma connected")

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
    await _db.disconnect()


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


async def _already_processed(snapshot_id: str) -> bool:
    """Idempotency check — skip snapshots already analyzed (e.g. on restart)."""
    assert _db is not None
    existing = await _db.processedsnapshot.find_unique(where={"snapshotId": snapshot_id})
    return existing is not None


async def _mark_processed(snapshot_id: str) -> None:
    assert _db is not None
    await _db.processedsnapshot.upsert(
        where={"snapshotId": snapshot_id},
        data={"create": {"snapshotId": snapshot_id}, "update": {}},
    )


async def _is_cooled_down(attempt_id: str, kind: str) -> bool:
    """Return True if enough time has passed since the last violation of this kind."""
    assert _db is not None
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.violation_cooldown_seconds)
    recent = await _db.violation.find_first(
        where={
            "attemptId": attempt_id,
            "kind": kind,
            "detectedAt": {"gte": cutoff},
        },
        order={"detectedAt": "desc"},
    )
    return recent is None


async def _store_violation(
    tenant_id: str, attempt_id: str, snapshot_id: str, kind: str, confidence: float, details: str
) -> None:
    assert _db is not None
    await _db.violation.create(
        data={
            "tenantId": tenant_id,
            "attemptId": attempt_id,
            "snapshotId": snapshot_id,
            "kind": kind,
            "confidence": confidence,
            "details": details,
        }
    )


async def _process(event: SnapshotEvent) -> None:
    assert _detector is not None and _minio is not None

    if await _already_processed(event.snapshot_id):
        logger.debug("Snapshot %s already processed, skipping", event.snapshot_id)
        return

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
    await _mark_processed(event.snapshot_id)

    elapsed = int((time.monotonic() - t0) * 1000)
    logger.info(
        "Snapshot %s analyzed in %dms: %d violation(s)",
        event.snapshot_id, elapsed, len(raw_violations),
    )

    if not raw_violations:
        return

    async with httpx.AsyncClient(base_url=settings.submission_url, timeout=10) as client:
        for v in raw_violations:
            if not await _is_cooled_down(event.attempt_id, v["kind"]):
                continue

            # Persist violation to DB first (idempotent on re-delivery)
            await _store_violation(
                tenant_id=event.tenant_id,
                attempt_id=event.attempt_id,
                snapshot_id=event.snapshot_id,
                kind=v["kind"],
                confidence=v["confidence"],
                details=v.get("details", ""),
            )

            # Post integrity event to submission service (best-effort)
            try:
                r = await client.post(
                    f"/v1/tenants/{event.tenant_id}/attempts/{event.attempt_id}/events",
                    json={"kind": v["kind"]},
                    headers={"X-Internal-Proctor": "true"},
                )
                r.raise_for_status()
                logger.info("Posted %s violation for attempt %s", v["kind"], event.attempt_id)
            except Exception as exc:
                logger.warning("Failed to post violation %s: %s", v["kind"], exc)


@app.get("/healthz")
async def healthz() -> dict:
    assert _db is not None
    try:
        await _db.execute_raw("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if (_detector is not None and db_ok) else "degraded",
        "model_loaded": _detector is not None,
        "db_connected": db_ok,
    }


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
