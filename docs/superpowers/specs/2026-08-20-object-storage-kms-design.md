# Object Storage Port and KMS Adapter — Design Spec

Date: 2026-08-20
Sub-project: B
Status: active

## Problem

Question content (evaluation bundles, manifests, assets) and SEB configurations
are stored in the database as opaque `(object_key, encryption_key_reference)` pairs.
Nothing can retrieve or decrypt them: there is no storage port and no KMS client.
The result is that published questions have no retrievable content and SEB
configurations cannot be served.

## Scope

This spec covers:
1. A `libs/pkg/storage` port interface and a MinIO adapter for local/CI use.
2. A `libs/pkg/kms` port interface and a local AES-256-GCM adapter for local/CI use.
3. A `GET /v1/questions/{version_id}/content/{asset_kind}` endpoint on question-bank
   that streams a presigned URL or the object bytes.
4. A `GET /v1/tenants/{tenant_id}/configurations/{config_id}/payload` endpoint on SEB
   that decrypts and returns the configuration object.

The production backend (India-resident S3 + managed KMS) is wired up by changing
two environment variables. No code change is needed when the real provider is approved.

## Architecture

### Storage port (`libs/pkg/storage`)

```
libs/pkg/storage/
  storage.go         — Object interface + ObjectInfo + errors
  minio/
    client.go        — MinIO adapter
    config.go        — LoadConfig("STORAGE") reads env vars
```

**Interface:**
```go
type Object interface {
    Put(ctx, key string, r io.Reader, size int64, contentType string) error
    Get(ctx, key string) (io.ReadCloser, int64, error)
    Delete(ctx, key string) error
    Exists(ctx, key string) (bool, error)
    PresignGet(ctx, key string, expiry time.Duration) (string, error)
}
```

The interface is intentionally narrow — no ListObjects, no CopyObject. Those
are added when a consumer needs them.

### KMS port (`libs/pkg/kms`)

```
libs/pkg/kms/
  kms.go             — KeyManager interface + errors
  local/
    client.go        — AES-256-GCM adapter (dev/CI)
    config.go        — LoadConfig("KMS") reads env vars
```

**Interface:**
```go
type KeyManager interface {
    // Encrypt returns an opaque keyRef and ciphertext. The keyRef is stored
    // in the DB alongside the ciphertext; Decrypt needs both.
    Encrypt(ctx context.Context, plaintext []byte) (ciphertext []byte, keyRef string, err error)
    Decrypt(ctx context.Context, ciphertext []byte, keyRef string) (plaintext []byte, err error)
}
```

The local adapter uses a single AES-256-GCM key from `KMS_LOCAL_KEY` (32 random
bytes, base64-encoded). The `keyRef` it returns is `"local:<sha256-of-key>"`.
A real KMS adapter would return `"arn:aws:kms:..."` or `"projects/.../cryptoKeys/..."`.

### Question-bank integration

New handler `GET /v1/questions/{question_version_id}/content/{asset_kind}`:
- Fetches the `(object_key, encryption_key_reference)` from `qbank.question_version_assets`
- If the asset is not encrypted (asset_kind == 'test_cases'), return a presigned URL
- If the asset is encrypted, decrypt and stream the bytes with appropriate Content-Type

New handler `GET /v1/questions/{question_version_id}/bundle`:
- Fetches evaluation_bundle from `qbank.question_versions`
- Decrypts and streams

### SEB integration

New handler `GET /v1/tenants/{tenant_id}/configurations/{config_id}/payload`:
- Fetches `(config_object_key, encryption_key_reference)` from `seb.configurations`
- Authorization: must hold an active SEB session for the tenant
- Decrypts and streams the configuration payload

## Data flow

```
Client → Handler → app.GetAsset(cmd) → store.GetObjectRef(ctx, versionID, kind)
      → kms.Decrypt(ctx, _, keyRef)
      → storage.Get(ctx, objectKey)
      → stream bytes to client
```

Upload path (Sub-project K adds the upload endpoints):
```
Client → Handler → app.PutAsset(cmd) → kms.Encrypt(ctx, bytes)
      → storage.Put(ctx, key, reader)
      → store.SetObjectRef(ctx, versionID, key, keyRef)
```

## Configuration

### Storage (MinIO dev / S3 production)
```
STORAGE_ENDPOINT=localhost:9000       (MinIO) or s3.ap-south-1.amazonaws.com (prod)
STORAGE_ACCESS_KEY=local-minio
STORAGE_SECRET_KEY=...
STORAGE_BUCKET=aethercode-qbank       (per-service bucket)
STORAGE_USE_SSL=false                 (false for MinIO, true for S3)
STORAGE_REGION=                       (empty for MinIO, ap-south-1 for prod)
```

### KMS (local AES / real KMS production)
```
KMS_PROVIDER=local                    (local or aws or gcp)
KMS_LOCAL_KEY=<32-bytes-base64>       (local dev only)
KMS_KEY_ARN=                          (AWS KMS — set when provider=aws)
```

## Security constraints

- Object keys are opaque UUIDs — callers cannot enumerate objects by key alone.
- Every Get call checks authorization before fetching from storage — never trust
  a client-supplied object key without first verifying the DB record exists and
  the caller is authorized to the parent resource.
- Encrypted assets are decrypted in-process and never written to disk.
- The local KMS key is never committed; it comes from the environment.

## Testing

- `libs/pkg/storage` and `libs/pkg/kms`: unit tests with no external dependencies.
  The MinIO adapter is tested against a TestContainers MinIO instance (once
  Sub-project F lands); for now, the interface and pure logic are unit-tested.
- Handler tests: mock the storage and KMS ports via interface.
- `make test-migrations` is not affected (no new migrations in this sub-project
  — the `object_key` columns already exist).

## Files created/modified

| Path | Action |
|---|---|
| `libs/pkg/storage/storage.go` | Create |
| `libs/pkg/storage/minio/client.go` | Create |
| `libs/pkg/storage/minio/config.go` | Create |
| `libs/pkg/kms/kms.go` | Create |
| `libs/pkg/kms/local/client.go` | Create |
| `libs/pkg/kms/local/config.go` | Create |
| `services/question-bank/internal/app/service.go` | Add GetAsset, GetBundle methods |
| `services/question-bank/internal/adapters/repo/postgres.go` | Add GetObjectRef methods |
| `services/question-bank/internal/adapters/http/handler.go` | Add content/bundle routes |
| `services/seb/internal/app/service.go` | Add GetConfigurationPayload method |
| `services/seb/internal/adapters/repo/postgres.go` | Add GetConfigObjectRef method |
| `services/seb/internal/adapters/http/handler.go` | Add payload route |
| `services/question-bank/cmd/server/main.go` | Wire storage + KMS clients |
| `services/seb/cmd/server/main.go` | Wire storage + KMS clients |
| `.env.example` | Add STORAGE_* and KMS_* vars |
| `docker-compose.yml` | Ensure MinIO has the required bucket (already present) |

## Definition of done

- `make build`, `make test`, `make vet`, `make fmt-check`, `make lint` all pass.
- A dev deployment can upload a question asset, retrieve it, and verify the bytes match.
- The local KMS round-trip test passes: encrypt → store keyRef → decrypt → compare.
- `services/question-bank/README.md` and `services/seb/README.md` document the new routes.
