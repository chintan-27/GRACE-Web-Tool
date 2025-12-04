FROM python:3.10-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git wget build-essential && \
    rm -rf /var/lib/apt/lists/*

# Torch + torchvision + torchaudio (Pascal-compatible CUDA 11.7)
RUN pip install --no-cache-dir \
    torch==1.13.1+cu117 \
    torchvision==0.14.1+cu117 \
    --extra-index-url https://download.pytorch.org/whl/cu117

# MONAI for PyTorch 1.13
RUN pip install --no-cache-dir monai==1.2.0

COPY api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY api/ /app/api

WORKDIR /app/api

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
