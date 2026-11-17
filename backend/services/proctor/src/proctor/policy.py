"""Per-exam proctor policy carried on the analyze event (ADR-0080).

Mirrors assessment's validated policy body. `enabled` defaults to false, so
auto-submit never fires unless an exam activates it.
"""
import json
import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field

# Policy names (assessment/internal/app/proctor_policy.go) -> detector kinds.
_POLICY_TO_DETECTOR = {
    "NO_FACE": "face_missing",
    "MULTIPLE_FACES": "multiple_faces",
    "PROHIBITED_DEVICE": "phone_detected",
    "GAZE_AWAY": "gaze_away",
}
_DETECTOR_KINDS = set(_POLICY_TO_DETECTOR.values())

THRESHOLD_SUBJECT = "proctor.violation.threshold"


class ProctorPolicy(BaseModel):
    # Bodies also carry unrelated keys such as seb_required.
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    violation_cooldown_seconds: int | None = Field(default=None, ge=1, le=3600)
    max_violations: int | None = Field(default=None, ge=1, le=1000)
    auto_submit_on_breach: bool = False
    counted_violation_kinds: list[str] = Field(default_factory=list)

    def cooldown(self, default: int) -> int:
        return self.violation_cooldown_seconds or default

    def counted_kinds(self) -> list[str] | None:
        """Detector kinds that count toward the breach; None means all kinds."""
        kinds = [_POLICY_TO_DETECTOR.get(k, k) for k in self.counted_violation_kinds]
        kinds = [k for k in kinds if k in _DETECTOR_KINDS]
        return kinds or None

    def breached(self, count: int) -> bool:
        return (
            self.enabled
            and self.auto_submit_on_breach
            and self.max_violations is not None
            and count >= self.max_violations
        )


def threshold_event(tenant_id: str, attempt_id: str, count: int, max_violations: int) -> tuple[str, bytes]:
    """Return (Nats-Msg-Id, messaging.Event JSON) for a breach.

    The id is deterministic in attempt_id + count, so a retry is deduplicated by
    JetStream and the consumer sees one event per count.
    """
    event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"proctor-threshold:{attempt_id}:{count}"))
    event = {
        "id": event_id,
        "type": THRESHOLD_SUBJECT,
        "schema_version": 1,
        "aggregate_type": "attempt",
        "aggregate_id": attempt_id,
        "tenant_id": tenant_id,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "payload": {"attempt_id": attempt_id, "tenant_id": tenant_id,
                    "violation_count": count, "max_violations": max_violations},
    }
    return event_id, json.dumps(event).encode()


RECORDED_SUBJECT = "proctor.violation.recorded"


def violation_recorded_event(tenant_id: str, attempt_id: str, violation_id: str, kind: str,
                             detected_at: datetime) -> tuple[str, bytes]:
    """Return (Nats-Msg-Id, messaging.Event JSON) for one stored violation.

    The id is the violation row's id, so a retry is deduplicated and Submission's
    inbox counts the violation once.
    """
    event = {
        "id": violation_id,
        "type": RECORDED_SUBJECT,
        "schema_version": 1,
        "aggregate_type": "attempt",
        "aggregate_id": attempt_id,
        "tenant_id": tenant_id,
        "occurred_at": detected_at.isoformat(),
        "payload": {"tenant_id": tenant_id, "attempt_id": attempt_id, "kind": kind,
                    "detected_at": detected_at.isoformat()},
    }
    return violation_id, json.dumps(event).encode()
