# User migrations

Apply these `golang-migrate` files only through the
`aether_user_migrator` credential:

```sh
make migrate SVC=user DIR=up
```

The migrator temporarily assumes non-login `aether_user_owner`. The request
runtime, authorization reader, and projection worker are separate roles; none
may own a schema or bypass RLS. Provision an audience-matched HMAC key before
using signed contexts.

`000001` establishes the signed authorization context and projection boundary.
`000002` creates user/role/affiliation data and synchronous authorization
revision outbox events. `000003` seeds the canonical Casbin policy baseline and
advances active assignees' revisions when a policy changes. Roll back in
reverse order and use a new expand/backfill/contract migration for any
production data change.

`000012_authorization_projection_resync` adds the authority-side grant
projection recovery protocol. Its local target state begins deny-by-default;
the User process writes an application-generated UUIDv7 request through its
outbox and only becomes ready after the User-issued batch manifest is complete.
The migration also provides the canonical rate-limited, deduplicated request
processor used exclusively by `aether_user_projection_worker`.

`000014_authorization_resync_identity_target` extends the canonical target
allow-list and its database check constraint with `identity`. Its rollback
refuses to discard durable identity resync history.

`000015_seb_validation_self_policy` permits a student to request only their
own `validation_events` authorization resource. SEB independently binds the
signed context actor to the attempt session's candidate, so this policy grants
no access to another candidate's opaque session ID.
