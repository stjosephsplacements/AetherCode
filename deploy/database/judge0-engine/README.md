# Judge0 engine database boundary

The Judge0 engine database is a distinct PostgreSQL deployment owned entirely
by upstream Judge0. Its schema, migrations, language seeding, backups, and
payload lifecycle are not part of AetherCode migrations.

Production uses a separate India-resident HA database deployment with its own
encrypted WAL archive and restore evidence. Its topology and the exact upstream
CE 1.13.1 migration/seeding record are captured by the engine chart's
`engineDatabase.haEvidenceRef`; neither the wrapper nor platform database
operators may apply AetherCode schema migrations to it.

Before an approved engine rollout, run the upstream Judge0 version-pinned
migration/seeding job exactly once against this database, using only the
upstream image and its documented process. The wrapper must not receive direct
database credentials and must communicate with the engine only through its
private authenticated HTTP API.

At v1.13.1, upstream Judge0 owns `clients`, `languages`, and `submissions`.
The `submissions` table can contain source and outputs, so the engine database
must use a dedicated encryption domain, stay in the Judge namespace, and purge
completed payloads within 24 hours of durable wrapper acknowledgement. The
gVisor compatibility gate remains mandatory before this database is connected
to production workloads.
