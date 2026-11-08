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
    # Minimum seconds between violation events of the same kind per attempt
    # (prevents flooding the DB when the student is on their phone for 10 frames).
    violation_cooldown_seconds: int = 30

    class Config:
        env_prefix = "PROCTOR_"


settings = Settings()
