# Notification migrations

Apply paired migrations with `aether_notification_migrator`:

```sh
make migrate SVC=notification DIR=up
```

`000007_authorization_projection_resync` adds the targeted complete-grant
recovery ledger and makes the existing authorization helper fail closed until
the User manifest verifies. Only `aether_notification_projection_worker` can
start or apply that recovery protocol.

`000008_retention_execution_boundary` adds a per-tenant legal-hold state row,
orders a hold transition before every retained-record mutation, and grants the
separate `aether_notification_retention_worker` only execute access to a
bounded purge function. The function rechecks a hold after its tenant lock and
deletes provider metadata before a notification. Its rollback refuses to run
while an active legal hold remains.
