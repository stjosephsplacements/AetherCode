# Identity migrations

These files use [golang-migrate](https://github.com/golang-migrate/migrate).
Apply them in numeric order with the `aether_identity_migrator` credential:

```sh
make migrate SVC=identity DIR=up
```

The migrator must be able to `SET ROLE aether_identity_owner`; the owner is
non-login and owns every created object. The runtime app role must not run these
files. Provision the HMAC key in `authz.context_keys` through the KMS deployment
workflow before accepting protected requests.

`000001` is the security/bootstrap boundary and `000002` creates the identity
domain. `000003` adds the password, refresh-family, reset, lockout, and audit
workflows; `000004` adds persisted MFA login challenges; `000005` adds durable
access-token session state for immediate logout/reset/MFA invalidation. Roll
back in reverse numeric order. Do not edit an applied migration; use an
expand/backfill/contract pair for production changes.

`000006_authorization_projection_resync` adds the complete snapshot inbox,
targeted recovery state, and hard fail-closed gate for both tenant and platform
contexts. Only `aether_identity_projection_worker` may apply snapshots or
start an outbox-backed Identity recovery request.

`000015_sso` adds single sign-on (ADR-0042): `sso_links` (an account's
provider subject and directory user, and whether AetherCode created that
user) and `sso_directory_sync`, the queue of accounts to copy to the
provider. Triggers on `password_credentials` (hash set or changed) and
`principals` (username, name or email changed) fill the queue. Every existing
account with a password is queued once. Rollback drops them.
