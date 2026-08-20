# Question Bank

The Question Bank owns the global coding-question catalogue in `aether_qbank`:
question slugs, immutable published versions, global tags, encrypted test-case
manifest references, encrypted evaluation-bundle references, and encrypted
asset references. It never reads another service database or stores source,
hidden tests, evaluation bundles, KMS material, or plaintext secrets.

Only a fresh canonical User authorization decision can open an application
transaction. The database independently verifies the five-second signed
capability and an exact local authorization-projection revision before its
`FORCE ROW LEVEL SECURITY` policies permit work. A missing or lagging global
projection denies access.

## Authoring workflow

1. `POST /v1/questions` creates a draft question and draft version `1`.
2. Add or replace a sample manifest, add exactly one immutable hidden manifest,
   add encrypted assets, and replace tags while the version remains draft.
3. `POST /v1/question-versions/{id}/publish` publishes only when both sample
   and hidden manifests exist. The publication trigger and immutable-version
   trigger enforce this in PostgreSQL, not only in HTTP code.
4. Publish a corrected draft as a new version; published versions and their
   child content cannot be changed. Archive the question to stop future use.

Every mutation requires an `Idempotency-Key` header. The key is bound to the
actor, operation, and canonical request payload for 24 hours; a repeated
request receives the original response, while reusing a key for different
content returns `409 Conflict`. Draft-changing commands require an expected
version/revision for optimistic concurrency.

The browser-facing responses expose safe question metadata and manifest/asset
counts only. They do not return object keys, checksums, or key references.
Use the versioned internal contracts and separately authorized object-store
access when an execution service must resolve an encrypted payload.

The complete REST contract is [api/openapi.yaml](api/openapi.yaml).

## Runtime configuration

Required in all environments:

- `QBANK_DATABASE_URL` — application-role connection to `aether_qbank`.
- `AUTHZ_ENDPOINT` — canonical User authorization gRPC endpoint.

When `NATS_URL` is set (mandatory in staging and production):

- `QBANK_PROJECTION_DATABASE_URL` — dedicated
  `aether_question_bank_projection_worker` connection.
- `NATS_URL` — JetStream platform event bus.

The service publishes `qbank.question.created.v1`,
`qbank.question.version_created.v1`, `qbank.question.version_published.v1`, and
`qbank.question.archived.v1` through its transactional outbox. Event payloads
contain opaque IDs and public metadata only, never encrypted object references.
It consumes `authz.grants_snapshot.v1` through a durable pull consumer; empty
global grants persist a revocation tombstone and fail closed.

Staging/production also require the standard authorization-client mTLS files:
`AUTHZ_CLIENT_TLS_CERT_FILE`, `AUTHZ_CLIENT_TLS_KEY_FILE`, and
`AUTHZ_CLIENT_TLS_CA_FILE` (plus an optional
`AUTHZ_CLIENT_TLS_SERVER_NAME`).

## Database migration notes

`000003_authoring_workflows_and_reliability` aligns the old outbox table with
`libs/pkg/messaging.OutboxStore` (`event_id`, payload SHA-256, retry time,
lease deadline, and publication-attempt counter). It also removes direct table
access from the application role: narrow security-definer aggregate functions
perform multi-table commands under one exact signed capability. The dedicated
projection worker retains the only DML grants for `authz` projection state.

Run migrations with:

```sh
make migrate SVC=question-bank DIR=up
```

Verify the service module with:

```sh
(cd services/question-bank && go test ./...)
make test-migrations
```

## Authorization projection recovery

`000004_authorization_projection_resync` moves Question Bank's normal grant
consumer onto the shared complete-snapshot contract. It derives global
Question Bank access only from the platform grant and treats an empty platform
grant as a durable revoke. The `aether_question_bank_projection_worker` emits
a UUIDv7 recovery request through the local outbox and may open global RLS
only after its targeted snapshot batch's count and SHA-256 manifest match.
`QBANK_PROJECTION_DATABASE_URL` must use that worker role whenever `NATS_URL`
is configured.
