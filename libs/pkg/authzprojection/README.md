# Authorization projection bootstrap and resync

`authz.grants_snapshot.v1` remains the normal per-principal revision event.
This package adds a separate, targeted recovery protocol for the case where a
JetStream durable has been unavailable beyond the platform stream's eight-day
retention window. It never changes the existing snapshot payload or subject.

## Protocol

Every subject is versioned and target-specific:

| Direction | Subject |
| --- | --- |
| target service → User | `authz.grants_snapshot.resync_requested.<service>.v1` |
| User → target service | `authz.grants_snapshot.resync_snapshot.<service>.v1` |
| User → target service | `authz.grants_snapshot.resync_completed.<service>.v1` |

The target writes the request through its own durable outbox. The request and
resync IDs are application-generated UUIDv7 values. User validates the exact
subject/payload target match, permits only the server-side target enum, limits
each target to one accepted request per 30 seconds, and deduplicates both
request IDs before it reads canonical authorization data.

The current canonical target set is `identity`, `tenant`, `user`,
`question-bank`, `assessment`, `submission`, `seb`, `notification`, and
`analytics`. Adding a service requires a User allow-list migration, a
target-local paired migration, and matching NATS ACLs; a free-form service
token is never accepted.

User emits an item for each current `users.authz_revisions` row and a terminal
completion containing the count and SHA-256 manifest. An item wraps the
unchanged complete snapshot payload and its SHA-256:

```json
{
  "resync_id": "UUIDv7",
  "target_service": "submission",
  "snapshot": { "principal_id": "UUID", "authz_revision": 7, "reason": "role_changed", "grants": [] },
  "snapshot_sha256": "lowercase-hex-sha256"
}
```

Completion contains `resync_id`, `target_service`, `snapshot_count`, and
`manifest_sha256`. The manifest is SHA-256 of lexically ordered lines:

```text
<principal_id>|<authz_revision>|<snapshot_sha256>\n...
```

The target only flips `projection_ready` to true after it has applied every
item for the active resync and the count and manifest match. Completion before
items is safe; it remains not ready until later item delivery completes the
same batch. Duplicate delivery with the same event ID is idempotent; a reused
event ID, principal, completion, or resync ID with different content is
terminal and leaves the projection fail-closed.

## Required target migration

Each RLS-protected service must add its own paired migration before wiring the
runtime. Use User migration `000012_authorization_projection_resync` as the
reference and keep these contracts unchanged:

- private `authz.authorization_projection_resync_state` singleton and
  `authz.authorization_projection_resync_items` tables;
- `authz.begin_authorization_projection_resync(request_event_id, resync_id,
  target_service, reason)` SECURITY DEFINER function, hard-bound to that
  service name, which marks the projection stale and enqueues the request into
  the service's own `app.outbox_events` atomically;
- `authz.set_context` or its `authz.has_*_authorization_at` dependency must
  require the state row's `projection_ready`; this is the actual RLS gate, not
  merely an HTTP readiness check;
- only the dedicated projection-worker role gets the narrow state/item DML and
  function execute grants. Request-serving app roles receive no resync-table
  or canonical User-table grant.

The state row begins with `projection_ready = false`. A running service must
also start a fresh resync whenever the normal snapshot/response consumers or
outbox publisher becomes unhealthy, because a disconnected durable can exceed
retention while the process remains alive.

## Exact target-service startup wiring

After creating the existing normal snapshot `PullConsumer`, use this shape in
each protected service main (replace `submission` with the database service
identifier and keep its service-specific durable names):

```go
resyncStore, err := authzprojection.NewResyncStore(projectionPool, "submission")
if err != nil { return err }

resyncSnapshotSubject, err := authzprojection.ResyncSnapshotSubject("submission")
if err != nil { return err }
resyncSnapshotConsumer, err := messaging.NewPullConsumer(
    ctx, natsURL, "submission-authz-resync-snapshots",
    "submission_authz_resync_snapshots_v1", resyncSnapshotSubject, logger,
    resyncStore.ApplySnapshot,
)
if err != nil { return err }

resyncCompletedSubject, err := authzprojection.ResyncCompletedSubject("submission")
if err != nil { return err }
resyncCompletedConsumer, err := messaging.NewPullConsumer(
    ctx, natsURL, "submission-authz-resync-completed",
    "submission_authz_resync_completed_v1", resyncCompletedSubject, logger,
    resyncStore.ApplyCompleted,
)
if err != nil { return err }

go normalSnapshotConsumer.Run(ctx)
go resyncSnapshotConsumer.Run(ctx)
go resyncCompletedConsumer.Run(ctx)

monitor, err := authzprojection.NewResyncMonitor(
    resyncStore, logger,
    publisher.Ready,
    normalSnapshotConsumer.Ready,
    resyncSnapshotConsumer.Ready,
    resyncCompletedConsumer.Ready,
)
if err != nil { return err }
go monitor.Run(ctx)
```

Add `resyncStore.Ping(ctx)` and `resyncStore.Ready(ctx)` to service readiness.
Do not make a direct NATS request or add a positive authorization cache: the
outbox-backed request and the database gate are what make recovery durable and
fail closed.

No new application environment variable is introduced. The existing `NATS_URL`
and the service's existing projection-worker database URL (for example,
`SUBMISSION_PROJECTION_DATABASE_URL`) are required. That URL must authenticate
as the service's dedicated projection-worker role, never as the app role or a
table owner.

Only User also starts a request consumer:

```go
consumer, err := messaging.NewPullConsumer(
    ctx, natsURL, "user-authz-resync-requests",
    "user_authz_resync_requests_v1",
    authzprojection.ResyncRequestWildcardSubject,
    logger, resyncRequestProjection.Apply,
)
```

## NATS permissions

Platform NATS ACLs must allow a target service to publish only its own
`resync_requested.<service>.v1` subject and subscribe only to its normal
snapshot plus its own resync snapshot/completion subjects. Only User may
subscribe to the request wildcard and publish response subjects. The User
database allow-list and 30-second per-target rate limit remain defense in
depth against accidental or compromised publisher amplification.
