from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    submission_url: str = "http://submission:8080"
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "aethercode"
    nats_url: str = "nats://nats:4222"
    # Subject that submission service publishes after storing a snapshot.
    # The proctor service subscribes and runs inference.
    nats_subject: str = "proctor.analyze"
    yolo_model: str = "yolov8x.pt"  # downloaded by ultralytics on first boot
    confidence_phone: float = 0.50
    confidence_person: float = 0.60
    # Minimum seconds between violation events of the same kind per attempt.
    # Stored in DB so cooldown is consistent across multiple replicas.
    violation_cooldown_seconds: int = 30
    # Prisma PostgreSQL URL — set via PROCTOR_DATABASE_URL env var.
    # Format: postgresql://user:password@host:port/dbname?sslmode=prefer
    # In Kubernetes this is injected from the aethercode-secrets Secret.
    database_url: str

    class Config:
        env_prefix = "PROCTOR_"


settings = Settings()
