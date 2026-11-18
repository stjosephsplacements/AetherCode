FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip libgl1 libglib2.0-0 \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml .
COPY prisma/ prisma/
# Pin to python3.11 so uv resolves against the right ABI (mediapipe has no cp312+ wheels yet)
RUN uv pip install --system --no-cache --python python3.11 -e .
# Generate the Prisma Python client at build time so no network is needed at runtime
RUN prisma generate

COPY src/ src/

# Bake the YOLO weights in: the pod has a read-only root filesystem and no internet access at runtime.
# Ultralytics saves the download into the working directory, so this leaves /app/yolov8x.pt.
RUN python3.11 -c "from ultralytics import YOLO; YOLO('yolov8x.pt')" && test -s /app/yolov8x.pt

ENV PYTHONUNBUFFERED=1 NVIDIA_VISIBLE_DEVICES=all NVIDIA_DRIVER_CAPABILITIES=compute,utility

# Non-root for security
RUN useradd -r -u 1001 proctor
USER proctor

HEALTHCHECK --interval=30s --timeout=5s CMD python3.11 -c "import httpx; httpx.get('http://localhost:8090/healthz').raise_for_status()"

CMD ["uvicorn", "proctor.main:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
