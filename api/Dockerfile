FROM python:3.10-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

# System dependencies for torch & monai
RUN apt-get update && apt-get install -y --no-install-recommends \
    git wget build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install PyTorch 1.13.1 (CUDA 11.7) - LAST version supporting NVIDIA TITAN Xp (sm_61)
RUN pip install --no-cache-dir \
    torch==1.13.1+cu117 \
    torchvision==0.14.1+cu117 \
    torchaudio==0.13.1 \
    --extra-index-url https://download.pytorch.org/whl/cu117

# Install MONAI version compatible with PyTorch 1.13.1
RUN pip install --no-cache-dir monai==1.2.0

# Install remaining Python deps
COPY api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy your application code
COPY api/ /app/api

WORKDIR /app/api

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
