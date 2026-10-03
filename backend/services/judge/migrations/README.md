# Judge control-plane migrations

These migrations apply only to the wrapper-owned `aether_judge_wrapper` database.
They never target the upstream Judge0 engine database.

The migration connection must authenticate as a principal that can `SET ROLE`
to `aether_judge_migrator`; the runtime service must authenticate separately as
a non-owner principal granted only `aether_judge_app`. Run the provisioning
script in [`deploy/database/judge-control`](../../../deploy/database/judge-control)
before the first migration, then use `make migrate SVC=judge DIR=up`. The shared
runner creates the owner-controlled version ledger before `golang-migrate`
opens, so the migration principal never needs `CREATE` on `public`.

Never edit an applied migration. Any incompatible change is released as an
additive expand migration, followed by a verified backfill, then a later
contract migration after every running wrapper version no longer reads the old
shape. The migration runner, not a migration file, holds the database advisory
lock for the whole apply or rollback operation.

`000001` creates the durable wrapper state: idempotent jobs, per-test execution
units, dispatch attempts, language mappings, a RabbitMQ admission outbox, an
at-least-once pull-completion outbox, consumer leases, and an inbox
deduplication ledger. `admission_outbox` is the source of truth for RabbitMQ
publication. Its broker notification may contain only `event_id` and `job_id`;
it never contains source, test cases, encrypted request material, or results.
The publisher leases rows, records a broker-confirmed publication, and requeues
stale `published` pointers idempotently after a node failure. The current
foundation release intentionally has no engine dispatcher; in the separately
approved Judge0 phase, its worker must durably record an event ID before it
ACKs RabbitMQ.

Each Pull creates an immutable `completion_deliveries` record with a `delivery_id` and `lease_id`.
Acknowledgement must bind both IDs to the active outbox lease, so a delayed ACK
from an expired lease cannot acknowledge a later redelivery. It stores only
opaque object references and checksums for source, tests, requests, and outputs.
JSON event/outbox payloads are constrained to object metadata no larger than
64 KiB; result bodies remain in encrypted object storage.

`000002` pre-creates the current and next two monthly execution-event and
completion-delivery partitions. The migration principal must run both commands
once per month, before the last pre-created partition begins:

```sql
SELECT judge.create_execution_events_partition(
  date_trunc('month', CURRENT_DATE + INTERVAL '2 months')::date
);
SELECT judge.create_completion_deliveries_partition(
  date_trunc('month', CURRENT_DATE + INTERVAL '2 months')::date
);
```

There is intentionally no default partition: a missed partition is an
alertable write failure rather than unbounded retention.

The mutable `execution_jobs`, `admission_outbox`, and `outbox_events` tables
are intentionally nonpartitioned, indexed 30-day control state: global UUID
idempotency, active lease comparison, and the terminal-outbox uniqueness rule
must remain efficient and strongly enforced. `execution_events` and the
append-per-lease `completion_deliveries` history are the high-volume monthly
partitioned tables. The retention function expires old leases, deletes old
delivery rows before their referenced outbox rows, then deletes terminal
control rows.

The wrapper retention job may call
`judge.purge_expired_execution_data(clock_timestamp() - INTERVAL '30 days')`.
It refuses a cutoff newer than 30 days and deletes only terminal wrapper data;
academic submissions and scores remain owned by the submission service.

`000003_completion_contract_integrity` installs a trigger that rejects terminal
completion outbox payloads unless their UUIDv7 identity, verdict, completion
time, optional metrics, and encrypted result reference triple satisfy the
private `judge/v1` contract. It deliberately leaves nonterminal outbox events
unchanged.

`000004_soft_delete_schema` adds soft delete support to `execution_jobs` and
`language_mappings` tables. Soft delete columns (`deleted_at`, `deleted_by`,
`deletion_reason`) enable audit-preserving archival without losing execution
history. Child tables with `ON DELETE CASCADE` references are automatically
cleaned during hard delete. Event logs (`execution_events`, `inbox_messages`)
remain immutable. The `app.hard_delete` function enforces SuperAdmin-only access
via `pg_has_role` check and logs all physical deletions to
`app.hard_delete_audit_log`.

`000008_fix_execution_units_normalized_verdict_check` corrects
`execution_units.normalized_verdict`'s CHECK constraint, which spelled the
compile-error member `'compilation_error'` since `000001` while every actual
writer/reader (the Judge0 client, the outbox completion contract in `000003`,
and the wrapper's own verdict vocabulary) uses `'compile_error'`. Before this
fix, a real compile-error verdict from the engine could never be recorded on a
unit: `DispatchStoreAdapter.RecordVerdict`'s `UPDATE` would violate the
constraint the moment a candidate's code failed to compile.
