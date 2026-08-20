# SEB

The SEB control-plane owns encrypted Safe Exam Browser configuration references,
one-way key hashes, attempt-bound sessions, configuration rotation/revocation,
and partitioned validation audits. It never persists plaintext SEB keys or quit
tokens.

## Implemented API

All business routes require a bearer identity assertion, a fresh mTLS decision
from the User authorization service, and a matching local authorization-grant
snapshot before a signed RLS transaction begins.

- Create/read encrypted configuration metadata.
- Rotate or revoke an active configuration through narrow database procedures.
- Issue an attempt-bound session with a 256-bit quit token; the raw token is
  returned only once in the issuance response with `Cache-Control: no-store`.
- Read or optimistic-close an active session.
- Validate a `config_key` or `browser_exam_key` header. The HTTP adapter hashes
  the raw header before SQL; audit records store only the validation result and
  a required, already-hashed non-secret request fingerprint.

The complete REST contract is in [api/openapi.yaml](api/openapi.yaml).

## Mutation idempotency

The public state-transition routes require a caller-generated
`Idempotency-Key` header: configuration create, rotate, and revoke; session
issue and close. It must contain 1–255 printable ASCII characters. The
adapter first strictly validates one JSON value, then persists the SHA-256 of
those exact validated bytes alongside the key. Reusing a key with a different
body is rejected with `409 Conflict`.

The claim, SEB state change, outbox event, and durable safe response are all
in one signed RLS transaction. Keys are tenant-, authenticated-actor-,
operation-, and target-resource-scoped where a target exists, and expire after
24 hours. Each replay still obtains a fresh central authorization decision and
must pass the local authorization-revision gate; idempotency never bypasses a
revocation.

- Configuration create/rotate/revoke and session close replay their original
  non-secret response safely.
- Session issue stores only `{ "session": ... }` in the idempotency record.
  It deliberately never stores the raw quit token. A completed retry returns
  `409 Conflict` rather than re-emitting a secret; an authorized caller can
  retrieve non-secret session state with `GET /sessions/{session_id}`. The
  initial `201` remains the only token-bearing response and is `no-store`.
- Header validation is intentionally excluded. Every validation is a distinct
  append-only security audit event from the Gateway path, not a retry of a
  state-transition command.

## Security and persistence

- `seb.configurations` contains object keys, checksums, encryption-key
  references, and hashes only. Configuration material is immutable after
  creation.
- Rotation/revocation, issuance, and header validation are security-definer
  procedures that re-check the caller's signed `seb.write` capability. The app
  role does not receive broad cross-table access.
- Session validation uses `AuthorizeSelfHTTP`: the User authorization service
  authorizes only the bearer subject as `/validation_events/:id`, and
  `seb.validate_session_header` independently binds that signed RLS actor to
  `seb.sessions.candidate_id`. Unknown and another candidate's sessions both
  return the same generic denial and no session/configuration metadata.
- A configuration key is always required. An absent browser key is accepted
  only when the configuration has no browser-key hash, producing
  `not_required`; it can never activate a session. Only a matched config key
  activates an issued session.
- `000003_outbox_contract` upgrades the original outbox to the shared leased,
  checksum-protected publisher schema. `000004_authorization_grant_snapshots`
  fails closed until the first complete `authz.grants_snapshot.v1` is applied.
- `000005_security_workflows` provides the multi-table procedures. Migrations
  are paired and have been fresh-applied, reversed, and reapplied by
  `make test-migrations`.
- `000006_self_session_validation` replaces the formerly event-ID-authorized
  validation procedure in place. `000007_authorization_projection_resync`
  adds the durable targeted resync state/items and makes RLS deny until the
  complete manifest has been applied.
- The existing `app.idempotency_keys` bootstrap table is used without new
  grants or a separate secret store. Application code refuses any durable
  idempotency response containing a `quit_token` key, including nested JSON.

## Runtime configuration

`SEB_DATABASE_URL` is the non-owner application role URL.
`SEB_PROJECTION_DATABASE_URL` is required and must use the dedicated
projection-worker role; it consumes normal grant snapshots plus targeted resync
snapshots/completions. `NATS_URL` is required because the resync request is
written through the SEB outbox and the database/RLS gate begins deny-by-default.
The normal shared authorization variables (`AUTHZ_*`) configure the mTLS User
service client. Do not expose the SEB service directly to browsers: Gateway is
the component that creates its non-secret request fingerprint and invokes both
header validations.

Run from the repository root:

```sh
go test ./services/seb/...
make test-migrations
```
