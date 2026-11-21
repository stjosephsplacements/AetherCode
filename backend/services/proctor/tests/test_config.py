import os

# Module import constructs Settings(); seed required secrets before that.
os.environ.setdefault("PROCTOR_MINIO_ACCESS_KEY", "test-access")
os.environ.setdefault("PROCTOR_MINIO_SECRET_KEY", "test-secret")
os.environ.setdefault("PROCTOR_DATABASE_URL", "postgresql://proctor:proctor@localhost/aether_proctor")

from proctor.config import Settings  # noqa: E402


def _settings(monkeypatch, **extra: str) -> Settings:
    monkeypatch.setenv("PROCTOR_MINIO_ACCESS_KEY", "access")
    monkeypatch.setenv("PROCTOR_MINIO_SECRET_KEY", "secret")
    monkeypatch.setenv("PROCTOR_DATABASE_URL", "postgresql://proctor:proctor@localhost/aether_proctor")
    for key, value in extra.items():
        monkeypatch.setenv(key, value)
    return Settings(_env_file=None)


def test_redis_url_reads_proctor_prefix(monkeypatch):
    assert _settings(monkeypatch, PROCTOR_REDIS_URL="redis://redis:6379/0").redis_url == "redis://redis:6379/0"


def test_redis_url_defaults_empty_when_unset(monkeypatch):
    monkeypatch.delenv("PROCTOR_REDIS_URL", raising=False)
    assert _settings(monkeypatch).redis_url == ""
