# ADR-0080: Proctor violation policy, auto-submit and evidence export

- Status: accepted
- Date: 2026-11-17

## Context

ADR-0078 left two proctoring gaps: a per-exam violation policy (the proctor
service used one global cooldown and never acted on counts) and evidence export
beyond the attempt page thumbnails. The assessment service already versions an
opaque proctor-policy body per exam, and the proctor service stores violations
in its own database (`aether_proctor`).

## Decision

**Policy body** (assessment, validated in `internal/app/proctor_policy.go`,
`ProctorPolicyBody` in the OpenAPI): `enabled` (default false),
`violation_cooldown_seconds` (1-3600), `max_violations` (1-1000),
`auto_submit_on_breach` (requires `max_violations`), `counted_violation_kinds`.
Kinds are `NO_FACE`, `MULTIPLE_FACES`, `PROHIBITED_DEVICE`, `GAZE_AWAY`, or the
detector's snake_case names (`face_missing`, `multiple_faces`, `phone_detected`,
`gaze_away`). Omitted or empty counts every kind. Unknown keys such as
`seb_required` stay valid so published versions keep working. A published
version is immutable, as for every versioned aggregate.

**Breach** is the cumulative count of stored violations of the counted kinds for
the attempt. A violation is stored only after the per-kind cooldown, so one
continuous blip counts once. `breached` needs `enabled`, `auto_submit_on_breach`
and `max_violations`; a missing policy never auto-submits.

**Delivery of the policy**: Assessment migration 000040 adds `proctor_policy` (the
exam version's policy body, or null) to the candidate assignment snapshot event.
Submission migration 000043 stores it on `assignment_projections`
(`set_assignment_proctor_policy`, called in the projection transaction and ignored
for a stale version). Each webcam upload reads it back
(`get_attempt_proctor_policy`, in the upload's own transaction under a savepoint,
because a capability is single-use) and puts it on the `proctor.analyze` event as
`SnapshotEvent.policy`. A failed lookup only leaves that frame without a policy.
The proctor service never calls assessment.

**Auto-submit**: the proctor service publishes `proctor.violation.threshold` to
JetStream (a `messaging.Event` envelope; `Nats-Msg-Id` is derived from
`attempt_id` and the count, so retries are deduplicated). Submission consumes it
(`internal/adapters/violation`) and calls
`submission.submit_attempt_for_violation(tenant_id, attempt_id, reason)` (migrations
000041 and 000045), a SECURITY DEFINER sibling of `expire_overdue_attempts` that
submits the one open attempt of that tenant with reason
`proctor_violation_threshold_breach`. An open attempt with no answers is marked
`expired` instead, as at time-up, and its payload keeps the documented fields. It
returns false for an attempt that is no longer open, so redelivery is harmless
without an inbox. The consumer runs on the existing least-privilege expiry role,
which gains EXECUTE on the function and still has no table access. The platform
stream gains the `proctor.violation.>` subject (not `proctor.>`: per-frame `proctor.analyze` messages travel on core NATS and a stream on that subject would store them).

**Evidence export**: the proctor service serves `GET /violations?attempt_id&tenant_id`
behind a bearer token (`PROCTOR_INTERNAL_TOKEN`; unset disables it). Submission
serves `GET /v1/tenants/{t}/attempts/{a}/proctor-evidence`, bundling those
violations with presigned snapshot URLs (`SUBMISSION_PROCTOR_URL`,
`SUBMISSION_PROCTOR_TOKEN`), authorized as `read` on `proctor_evidence`.
Submission migration 000042 lets `list_snapshots` accept that resource.

**Authorization**: `permsAllow` and `bitsAllow` in the User service grant `read` on
`submission.snapshots` and `submission.proctor_evidence` to a holder of
`VIEW_STUDENT_PII` who also has `VIEW_SCOPE`, or to `ADMINISTRATOR`, within the
assignment's scope, so tenant and college boundaries still apply. Both resources
were missing from the submission route table, so the snapshot listing was refused
for everyone until now. User migration 000049 registers their six resource flags
as platform-only (so the staff roles seeded for each college never get them) and
lets the audit log record the verb `proctor.evidence.exported`, written by the
authorization decision, allowed or denied.

## Consequences

- Nothing auto-submits until an exam's policy version sets `enabled`,
  `auto_submit_on_breach` and `max_violations`.
- Rollout order is free: the projection decoder ignores unknown fields, so an older
  Submission drops `proctor_policy` and loses nothing else. Existing assignments carry no policy until Assessment re-emits their snapshot
  (a move of the window or a repin does).
- The audit entry is written when access is granted, not when the response is
  delivered.
- The migration 000049 down removes `proctor.evidence.exported` audit rows and
  leaves the registry flags, which the append-only trigger protects.
- Submission migration 000044 makes `store_snapshot` require the caller's own attempt; it only checked the tenant-level write context, so a candidate could add frames to another candidate's attempt. `get_attempt_proctor_policy` has the same check.
- Reading student images is elevated: the User service requires a recent MFA check
  for snapshots and the evidence export, and refuses the read when the audit entry
  cannot be written. A long exam therefore asks the invigilator to re-verify MFA
  every five minutes to keep the camera grid.
- The breach is re-checked on every analysed frame, so a failed publish is retried
  by the next frame; an attempt that sends no further frame is not retried.
- Submission migration 000045 revokes the app role's direct access to
  `attempt_snapshots`, so `store_snapshot` is the only way in.
- There is no frontend policy editor yet.
