import json

from proctor.policy import ProctorPolicy, threshold_event


def test_defaults_never_breach():
    policy = ProctorPolicy()
    assert not policy.enabled and not policy.breached(10_000)


def test_breach_needs_enabled_auto_submit_and_max():
    base = {"max_violations": 3, "auto_submit_on_breach": True}
    assert not ProctorPolicy(**base).breached(5)  # enabled defaults to false
    assert not ProctorPolicy(enabled=True, max_violations=3).breached(5)
    policy = ProctorPolicy(enabled=True, **base)
    assert not policy.breached(2) and policy.breached(3)


def test_counted_kinds_map_policy_and_detector_names():
    policy = ProctorPolicy(counted_violation_kinds=["NO_FACE", "phone_detected", "GAZE_AWAY"])
    assert policy.counted_kinds() == ["face_missing", "phone_detected", "gaze_away"]
    assert ProctorPolicy().counted_kinds() is None


def test_unknown_keys_ignored_and_cooldown_default():
    policy = ProctorPolicy.model_validate({"seb_required": False})
    assert policy.cooldown(30) == 30
    assert ProctorPolicy(violation_cooldown_seconds=15).cooldown(30) == 15


def test_threshold_event_is_deterministic_envelope():
    id_a, data = threshold_event("t", "a", 5, 5)
    id_b, _ = threshold_event("t", "a", 5, 5)
    assert id_a == id_b != threshold_event("t", "a", 6, 5)[0]
    event = json.loads(data)
    assert event["type"] == "proctor.violation.threshold" and event["payload"]["violation_count"] == 5


def test_violation_recorded_event_uses_the_row_id():
    from datetime import datetime, timezone

    from proctor.policy import violation_recorded_event

    when = datetime(2026, 11, 17, tzinfo=timezone.utc)
    msg_id, data = violation_recorded_event("t", "a", "v1", "phone_detected", when)
    event = json.loads(data)
    assert msg_id == event["id"] == "v1" and event["type"] == "proctor.violation.recorded"
    assert event["payload"]["kind"] == "phone_detected" and event["tenant_id"] == "t"
