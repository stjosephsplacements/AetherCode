from pydantic import BaseModel
from datetime import datetime

from .policy import ProctorPolicy


class SnapshotEvent(BaseModel):
    """Published to NATS after a snapshot is stored in MinIO."""
    snapshot_id: str
    attempt_id: str
    tenant_id: str
    storage_key: str
    captured_at: datetime
    # Resolved by submission from the exam's proctor policy version; absent
    # means no policy, so no auto-submit.
    policy: ProctorPolicy | None = None


class Violation(BaseModel):
    kind: str  # "phone_detected" | "multiple_faces" | "face_missing"
    confidence: float
    details: str


class AnalysisResult(BaseModel):
    snapshot_id: str
    attempt_id: str
    tenant_id: str
    violations: list[Violation]
    processing_ms: int
