# Signed authorization context contract

Every platform service database exposes the same `authz.set_context` function.
The user authorization service signs a decision only after evaluating its
canonical role, policy, and relationship data. The receiving service verifies
the capability with a KMS-provisioned key stored only in its private
`authz.context_keys` table.

The exact function signature is:

```sql
authz.set_context(
  actor_id uuid,
  tenant_id uuid,
  authz_revision bigint,
  decision text,
  action text,
  resource text,
  issued_at timestamptz,
  expires_at timestamptz,
  key_id uuid,
  signature bytea
)
```

The signature is HMAC-SHA-256 over this UTF-8, delimiter-separated canonical
envelope, with timestamps formatted in UTC at microsecond precision:

```text
aether-authz-context-v1|<database>|<key_id>|<actor>|<tenant-or-empty>|<revision>|<allow>|<action>|<resource>|<YYYY-MM-DDTHH:MM:SS.USZ>|<YYYY-MM-DDTHH:MM:SS.USZ>
```

Only `allow` decisions are accepted. The issue/expiry window is at most five
seconds. A capability must match the target database audience, an active key,
and the exact local effective authorization projection revision.

On success the database inserts an unlogged `authz.request_contexts` row bound
to `pg_backend_pid()` and `txid_current()`, then transaction-locally sets only
`app.authz_context_id`. RLS evaluates that row plus the local projection for
every protected query. Manually setting tenant, actor, revision, or context GUCs
does not grant access; a copied context ID fails in a different transaction or
backend. Database restart clears these transient rows and fails closed.

Each protected table supplies fixed, exact action and resource literals to its
RLS helper; neither prefixes nor wildcards authorize a row. A `SELECT` policy
accepts the table's exact read action or its exact write action so PostgreSQL
can locate rows for an `UPDATE` or `DELETE`. The corresponding mutation policy
requires the exact write action. A read capability therefore never authorizes a
write, while a write capability has only the row visibility PostgreSQL requires
to perform that write.

The projection worker is the only role permitted to call
`authz.apply_tenant_authorization`. It must retain revocation tombstones and
ignore older revisions. A user authorization change must publish complete
effective grants for the new revision, so projection lag is a denial rather
than continued access.

## Key lifecycle

Create the HMAC material in the approved KMS/secret controller, distribute the
active key only to the User authorization service and its matching target
database, and rotate by adding a new key before switching
`AUTHZ_CAPABILITY_KEYS`. Do not place a key in source control or a migration.
After a database bootstrap migration, an operator with the owner/migration
credential can use [`scripts/provision-authz-context-key`](../../scripts/provision-authz-context-key)
with an explicit expiry. The script verifies that its audience is the connected
logical database and never prints secret material.
