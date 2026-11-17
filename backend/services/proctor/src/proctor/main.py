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
import hmac
import logging
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import httpx
import nats
from fastapi import FastAPI, Header, HTTPException, Query
from minio import Minio
from prisma import Prisma

from .config import settings
from .detector import Detector
from .models import AnalysisResult, SnapshotEvent, Violation
from .policy import THRESHOLD_SUBJECT, ProctorPolicy, threshold_event

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("proctor")

_detector: Detector | None = None
_minio: Minio | None = None
_db: Prisma | None = None
_nc: nats.aio.client.Client | None = None
_http: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(application: FastAPI):
    global _detector, _minio, _db, _nc, _http

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

    _http = httpx.AsyncClient(base_url=settings.submission_url, timeout=10)

    logger.info("Starting NATS consumer on %s", settings.nats_subject)
    _nc = await nats.connect(settings.nats_url)
    asyncio.create_task(_consume())
    yield

    logger.info("Proctor shutting down")
    await _nc.drain()
    await _http.aclose()
    await _db.disconnect()


app = FastAPI(title="AetherCode Proctor", lifespan=lifespan)


async def _consume() -> None:
    assert _nc is not None
    sub = await _nc.subscribe(settings.nats_subject)
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


async def _is_cooled_down(attempt_id: str, kind: str, cooldown_seconds: int) -> bool:
    """Return True if enough time has passed since the last violation of this kind."""
    assert _db is not None
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=cooldown_seconds)
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


def _fetch_jpeg(key: str) -> bytes:
    """Blocking MinIO download — run in executor to keep the event loop free."""
    assert _minio is not None
    response = _minio.get_object(settings.minio_bucket, key)
    try:
        return response.read()
    finally:
        response.close()


# The last policy seen per attempt. A frame sent without one (Submission could not
# read it that time) still uses the policy of earlier frames, so a lost breach
# publish is retried. Bounded; oldest attempts are dropped first.
_policy_cache: "OrderedDict[str, ProctorPolicy]" = OrderedDict()
_POLICY_CACHE_MAX = 4096


def _effective_policy(event: SnapshotEvent) -> ProctorPolicy:
    if event.policy is not None:
        _policy_cache[event.attempt_id] = event.policy
        _policy_cache.move_to_end(event.attempt_id)
        while len(_policy_cache) > _POLICY_CACHE_MAX:
            _policy_cache.popitem(last=False)
        return event.policy
    return _policy_cache.get(event.attempt_id) or ProctorPolicy()


# Serialises the cooldown check and insert for one attempt inside this process.
# Replicas still race; a database constraint would be needed to close that.
_attempt_locks: dict[str, asyncio.Lock] = {}


async def _process(event: SnapshotEvent) -> None:
    lock = _attempt_locks.setdefault(event.attempt_id, asyncio.Lock())
    try:
        async with lock:
            await _process_locked(event)
    finally:
        if not lock.locked() and not getattr(lock, "_waiters", None):
            _attempt_locks.pop(event.attempt_id, None)


async def _process_locked(event: SnapshotEvent) -> None:
    assert _detector is not None and _http is not None

    if await _already_processed(event.snapshot_id):
        logger.debug("Snapshot %s already processed, skipping", event.snapshot_id)
        return

    t0 = time.monotonic()
    loop = asyncio.get_running_loop()
    try:
        jpeg = await loop.run_in_executor(None, _fetch_jpeg, event.storage_key)
    except Exception as exc:
        logger.error("Cannot fetch snapshot %s: %s", event.snapshot_id, exc)
        return

    raw_violations = await loop.run_in_executor(None, _detector.analyze, jpeg)
    await _mark_processed(event.snapshot_id)

    elapsed = int((time.monotonic() - t0) * 1000)
    logger.info(
        "Snapshot %s analyzed in %dms: %d violation(s)",
        event.snapshot_id, elapsed, len(raw_violations),
    )

    policy = _effective_policy(event)
    cooldown = policy.cooldown(settings.violation_cooldown_seconds)
    for v in raw_violations:
        if not await _is_cooled_down(event.attempt_id, v["kind"], cooldown):
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
            r = await _http.post(
                f"/v1/tenants/{event.tenant_id}/attempts/{event.attempt_id}/events",
                json={"kind": v["kind"]},
                headers={"X-Internal-Proctor": "true"},
            )
            r.raise_for_status()
            logger.info("Posted %s violation for attempt %s", v["kind"], event.attempt_id)
        except Exception as exc:
            logger.warning("Failed to post violation %s: %s", v["kind"], exc)

    # Checked on every analysed frame, not only after a new violation: a publish
    # that failed earlier is retried by the next frame (the message id dedups).
    await _publish_if_breached(event, policy)


async def _publish_if_breached(event: SnapshotEvent, policy: ProctorPolicy) -> None:
    """Count the attempt's cumulative violations and report a breach to JetStream.

    Submission closes the attempt idempotently, so publishing on every frame once
    the count is at or above the maximum is safe and retries a lost breach.
    """
    assert _db is not None and _nc is not None
    if not (policy.enabled and policy.auto_submit_on_breach and policy.max_violations):
        return
    where: dict = {"attemptId": event.attempt_id, "tenantId": event.tenant_id}
    kinds = policy.counted_kinds()
    if kinds:
        where["kind"] = {"in": kinds}
    count = await _db.violation.count(where=where)
    if not policy.breached(count):
        return
    msg_id, data = threshold_event(event.tenant_id, event.attempt_id, count, policy.max_violations)
    try:
        await _nc.jetstream().publish(THRESHOLD_SUBJECT, data, headers={"Nats-Msg-Id": msg_id})
        logger.warning("Attempt %s breached %d violations (count %d)", event.attempt_id, policy.max_violations, count)
    except Exception as exc:
        logger.error("Failed to publish violation threshold for attempt %s: %s", event.attempt_id, exc)


_MAX_VIOLATIONS = 1000


def _valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


@app.get("/violations")
async def violations(
    attempt_id: str = Query(),
    tenant_id: str = Query(),
    authorization: str = Header(default=""),
) -> dict:
    """Internal read for submission's evidence export; fails closed without a token."""
    assert _db is not None
    if not settings.internal_token:
        raise HTTPException(status_code=503, detail="violation reads are not configured")
    if not hmac.compare_digest(authorization.encode(), f"Bearer {settings.internal_token}".encode()):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not (_valid_uuid(attempt_id) and _valid_uuid(tenant_id)):
        raise HTTPException(status_code=422, detail="attempt_id and tenant_id must be UUIDs")
    # Newest first so a long attempt keeps its latest violations; one extra row
    # tells the caller the list was cut.
    rows = await _db.violation.find_many(
        where={"attemptId": attempt_id, "tenantId": tenant_id},
        order={"detectedAt": "desc"},
        take=_MAX_VIOLATIONS + 1,
    )
    truncated = len(rows) > _MAX_VIOLATIONS
    rows = list(reversed(rows[:_MAX_VIOLATIONS]))
    return {"truncated": truncated, "violations": [
        {"id": r.id, "snapshot_id": r.snapshotId, "kind": r.kind, "confidence": r.confidence,
         "details": r.details, "detected_at": r.detectedAt.isoformat()}
        for r in rows
    ]}


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
    assert _detector is not None
    t0 = time.monotonic()
    loop = asyncio.get_running_loop()
    jpeg = await loop.run_in_executor(None, _fetch_jpeg, event.storage_key)
    raw = await loop.run_in_executor(None, _detector.analyze, jpeg)
    return AnalysisResult(
        snapshot_id=event.snapshot_id,
        attempt_id=event.attempt_id,
        tenant_id=event.tenant_id,
        violations=[Violation(**v) for v in raw],
        processing_ms=int((time.monotonic() - t0) * 1000),
    )
