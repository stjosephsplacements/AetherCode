# Question Bank

The Question Bank owns the global coding-question catalogue in `aether_qbank`:
question slugs, immutable published versions, global tags, encrypted test-case
test-case manifest references, encrypted evaluation-bundle references, and
encrypted asset references. It never reads another service database. Staff
upload plaintext tests; the service builds the bundles, encrypts them with KMS
and stores only the ciphertext in object storage, and the database holds only
references. Plaintext tests, KMS material and secrets are never persisted.

Only a fresh canonical User authorization decision can open an application
transaction. The database independently verifies the five-second signed
capability and an exact local authorization-projection revision before its
`FORCE ROW LEVEL SECURITY` policies permit work. A missing or lagging global
projection denies access.

## Collection endpoints

`GET /v1/questions` lists published questions with cursor-based keyset
pagination. Supported query parameters:

| Parameter    | Default | Notes                                      |
|---|---|---|
| `limit`      | 20      | 1–100; out-of-range returns 400            |
| `cursor`     | —       | Opaque token from `next_cursor` in a prior response |
| `difficulty` | —       | Optional filter (`easy`, `medium`, `hard`) |
| `tag`        | —       | Optional tag name filter                   |
| `language`   | —       | Optional supported-language filter         |

`GET /v1/questions/{question_id}/versions` lists all versions of one question
(including drafts visible to the caller under RLS), also cursor-paginated:

| Parameter | Default | Notes                            |
|---|---|---|
| `limit`   | 20      | 1–100                            |
| `cursor`  | —       | Opaque token from prior response |
| `status`  | —       | Optional filter (`draft`, `published`) |

Both endpoints return `{"items": [...], "next_cursor": "..."}`. An absent
`next_cursor` means the last page has been reached.

## Authoring workflow

1. `POST /v1/questions` creates a draft question and draft version `1`.
2. `PUT /v1/question-versions/{id}/tests` replaces all tests of the draft from
   plaintext (see below). Add encrypted assets and replace tags while the
   version remains draft.
3. `POST /v1/question-versions/{id}/publish` publishes only when the sample and
   hidden manifests and the evaluation bundle exist. The publication trigger and immutable-version
   trigger enforce this in PostgreSQL, not only in HTTP code.
4. Publish a corrected draft as a new version; published versions and their
   child content cannot be changed. Archive the question to stop future use.

Every mutation requires an `Idempotency-Key` header. The key is bound to the
actor, operation, and canonical request payload for 24 hours; a repeated
request receives the original response, while reusing a key for different
content returns `409 Conflict`. Draft-changing commands require an expected
version/revision for optimistic concurrency.

### Uploading tests

`PUT /v1/question-versions/{id}/tests` takes
`{"expected_question_version": n, "tests": [{"input", "expected_output",
"sample": bool, "weight": 1..100 (default 1)}]}` and returns the version
summary. It needs 1 to 500 tests with at least one sample and one hidden test;
the body is capped by the shared 1 MiB JSON limit, which bounds every input and
output (each must also be at most 1 MiB). Scores follow
`points x passed weight / total weight`; students see full input/output only
for sample tests.

The service builds three schema-version-2 bundles with
`backend/libs/pkg/evalbundle` (ADR-0014): the evaluation bundle (every test, in
the given order, which Judge fans out and grades), a sample-only bundle and a
hidden-only bundle. Each is encrypted with KMS and stored under a server-chosen
key `qbank/question-versions/<question_version_id>/<uuidv7>-<kind>.bundle`; the
recorded checksum is the SHA-256 of the stored ciphertext. A draft's tests,
hidden ones included, can be replaced any number of times: the new objects are
written first, the database swap happens in one transaction
(`qbank.set_question_version_tests`), and the superseded objects are then
deleted best-effort (failures are logged). If the database step fails the new
objects are deleted. A stale `expected_question_version` returns `409`.
Published versions stay fully immutable. There is no endpoint that returns
decrypted tests or bundles, and clients cannot supply object references for
them.

The browser-facing responses expose safe question metadata and manifest/asset
counts only. They do not return object keys, checksums, or key references.
Use the versioned internal contracts and separately authorized object-store
access when an execution service must resolve an encrypted payload.

The complete REST contract is [api/openapi.yaml](api/openapi.yaml).

## Runtime configuration

Required in all environments:

- `QBANK_DATABASE_URL` — application-role connection to `aether_qbank`.
- `AUTHZ_ENDPOINT` — canonical User authorization gRPC endpoint.
- `QBANK_STORAGE_ENDPOINT`, `QBANK_STORAGE_BUCKET`, `QBANK_STORAGE_ACCESS_KEY`,
  `QBANK_STORAGE_SECRET_KEY` (plus optional `QBANK_STORAGE_REGION`,
  `QBANK_STORAGE_USE_SSL`) — MinIO/S3 bucket for encrypted test bundles and assets.
- `QBANK_KMS_LOCAL_KEY` — base64 32-byte AES-256-GCM key (local/dev/CI only;
  production needs a managed KMS adapter).

The service refuses to start when storage or KMS is not configured.

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

`000010_server_built_test_bundles` makes the version's bundle columns nullable
for drafts (a `CHECK` still requires them once published), lets draft test
manifests including hidden ones be replaced, and replaces the caller-supplied
`qbank.upsert_test_case_manifest` with `qbank.set_question_version_tests`.
Its down migration refuses to run while drafts without uploaded tests exist.

`000003_authoring_workflows_and_reliability` aligns the old outbox table with
`backend/libs/pkg/messaging.OutboxStore` (`event_id`, payload SHA-256, retry time,
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
(cd backend/services/question-bank && go test ./...)
make test-migrations
```

## Internal service contract

`QuestionBankInternalService.ResolvePublishedQuestionVersion`
(`libs/proto/proto/aethercode/questionbank/v1`) lets Assessment pin a
published version to an exam item: its limits, languages and the encrypted
evaluation and sample bundle references. It never returns test content, and
anything other than a published version of a live question is `NOT_FOUND`.
It reads `qbank.resolve_published_question_version` (migration 000012)
without a user capability; mTLS is the gate.

| Variable | Default | Meaning |
|---|---|---|
| `QBANK_GRPC_ADDR` | `127.0.0.1:9445` | Listener address. |
| `QBANK_GRPC_TLS_CERT_FILE`, `QBANK_GRPC_TLS_KEY_FILE`, `QBANK_GRPC_CLIENT_CA_FILE` | — | Server certificate and the CA that signs client certificates; required in staging and production, all-or-none elsewhere. |
| `QBANK_GRPC_ALLOWED_CLIENT_SUBJECTS` | — | Comma-separated client certificate common names allowed to call (`assessment`); required with mTLS. |

## Authorization projection recovery

`000004_authorization_projection_resync` moves Question Bank's normal grant
consumer onto the shared complete-snapshot contract. It derives global
Question Bank access only from the platform grant and treats an empty platform
grant as a durable revoke. The `aether_question_bank_projection_worker` emits
a UUIDv7 recovery request through the local outbox and may open global RLS
only after its targeted snapshot batch's count and SHA-256 manifest match.
`QBANK_PROJECTION_DATABASE_URL` must use that worker role whenever `NATS_URL`
is configured.

Since `000011_staff_authoring` (ADR-0020), a tenant grant marked
`"authoring": true` (a `college_admin` or `department_user` role in any
college) gives the same global read and write as a platform grant, on both the
live consumer and the resync path. Students and mentors get no access to the
bank.
