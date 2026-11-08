FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml .
COPY prisma/ prisma/
RUN uv pip install --system --no-cache -e .
# Generate the Prisma Python client at build time so no network is needed at runtime
RUN prisma generate

COPY src/ src/

ENV PYTHONUNBUFFERED=1 NVIDIA_VISIBLE_DEVICES=all NVIDIA_DRIVER_CAPABILITIES=compute,utility

# Non-root for security
RUN useradd -r -u 1001 proctor
USER proctor

HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import httpx; httpx.get('http://localhost:8090/healthz').raise_for_status()"

CMD ["uvicorn", "proctor.main:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
