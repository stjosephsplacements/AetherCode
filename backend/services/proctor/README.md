# proctor

GPU-accelerated webcam proctoring service. Consumes snapshot events from NATS,
downloads JPEG frames from MinIO, runs YOLOv8x + MediaPipe inference on a CUDA
GPU, and writes violations to its own PostgreSQL database. Posts integrity events
back to the submission service.

## Architecture

```
submission (NATS proctor.analyze) → proctor → MinIO (fetch JPEG)
                                           → Prisma (violations, processed_snapshots)
                                           → submission HTTP (POST integrity event)
```

Violation kinds: `phone_detected`, `multiple_faces`, `face_missing`, `gaze_away`.

A per-attempt, per-kind cooldown (default 30 s, DB-backed) prevents event floods.
The `processed_snapshots` table provides idempotency across restarts.

## Requirements

- NVIDIA GPU with CUDA 12.4+ (scheduled via `nvidia.com/gpu: 1` in Kubernetes)
- Python 3.11
- YOLOv8x model weights downloaded on first boot by `ultralytics`

## Configuration (env vars)

All vars are prefixed `PROCTOR_` via pydantic-settings.

| Variable | Required | Description |
|----------|----------|-------------|
| `PROCTOR_DATABASE_URL` | **yes** | Prisma connection URL (`postgresql://user:pass@host/db`) |
| `PROCTOR_DATABASE_DIRECT_URL` | **yes** | Direct (non-pooled) URL for migrations |
| `PROCTOR_MINIO_ENDPOINT` | no | MinIO host:port (default `minio:9000`) |
| `PROCTOR_MINIO_ACCESS_KEY` | **yes** | MinIO access key |
| `PROCTOR_MINIO_SECRET_KEY` | **yes** | MinIO secret key |
| `PROCTOR_MINIO_BUCKET` | no | Bucket name (default `aethercode`) |
| `PROCTOR_NATS_URL` | no | NATS URL (default `nats://nats:4222`) |
| `PROCTOR_NATS_SUBJECT` | no | Subject to subscribe (default `proctor.analyze`) |
| `PROCTOR_YOLO_MODEL` | no | Model path (default `yolov8x.pt`) |
| `PROCTOR_CONFIDENCE_PHONE` | no | Phone detection threshold (default `0.50`) |
| `PROCTOR_CONFIDENCE_PERSON` | no | Person detection threshold (default `0.60`) |
| `PROCTOR_VIOLATION_COOLDOWN_SECONDS` | no | Per-attempt, per-kind cooldown (default `30`) |
| `PROCTOR_SUBMISSION_URL` | no | Submission service base URL (default `http://submission:8080`) |

In Kubernetes, `PROCTOR_DATABASE_URL` and credentials are injected from the
`aethercode-secrets` Secret — see `deploy/helm/platform-service/values-proctor.yaml`.

## Local development

```bash
cd backend/services/proctor
uv pip install -e .
prisma generate
uvicorn proctor.main:app --reload --port 8090
```

## Database

Managed by `prisma-client-py`. Schema at `prisma/schema.prisma`. SQL migrations
at `migrations/` (applied by the `proctor-migrate` Helm Job or `deploy/single-server/migrate-all.sh`).

```bash
prisma generate        # regenerate Python client after schema changes
prisma db push         # apply schema to dev DB (use migrations in prod)
```

## HTTP API

| Endpoint | Description |
|----------|-------------|
| `GET /healthz` | Liveness check (returns model_loaded, db_connected) |
| `POST /analyze` | Direct HTTP trigger (smoke testing without NATS) |
