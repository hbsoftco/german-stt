FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODELS_DIR=/models \
    LD_LIBRARY_PATH=/opt/conda/lib/python3.11/site-packages/torch/lib:/usr/local/nvidia/lib:/usr/local/nvidia/lib64

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

RUN pip install --upgrade pip && \
    pip install -r requirements.txt

COPY app ./app
COPY frontend ./frontend

VOLUME ["/models"]

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
