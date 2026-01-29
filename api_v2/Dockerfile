# =============================================================================
# Whole-Head Segmentation API v2 - Dockerfile
# =============================================================================
# Multi-stage build for GPU-accelerated MRI segmentation
# Requires NVIDIA Container Toolkit for GPU support
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base image with CUDA and Python
# -----------------------------------------------------------------------------
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04 AS base

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    python3-pip \
    wget \
    curl \
    ca-certificates \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.11 as default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# Upgrade pip
RUN python -m pip install --upgrade pip setuptools wheel

# -----------------------------------------------------------------------------
# Stage 2: Install FreeSurfer (minimal - just mri_convert)
# -----------------------------------------------------------------------------
FROM base AS freesurfer

# Download and extract FreeSurfer (minimal installation)
# Using FreeSurfer 7.4.1 - only extracting necessary binaries
ENV FREESURFER_VERSION=7.4.1
ENV FREESURFER_HOME=/usr/local/freesurfer

RUN mkdir -p ${FREESURFER_HOME} && \
    wget -q -O /tmp/freesurfer.tar.gz \
    "https://surfer.nmr.mgh.harvard.edu/pub/dist/freesurfer/${FREESURFER_VERSION}/freesurfer-linux-ubuntu22_amd64-${FREESURFER_VERSION}.tar.gz" && \
    tar -xzf /tmp/freesurfer.tar.gz -C /tmp && \
    # Copy only essential files for mri_convert
    cp -r /tmp/freesurfer/bin/mri_convert ${FREESURFER_HOME}/bin/ || true && \
    cp -r /tmp/freesurfer/lib ${FREESURFER_HOME}/ || true && \
    rm -rf /tmp/freesurfer /tmp/freesurfer.tar.gz

# -----------------------------------------------------------------------------
# Stage 3: Final production image
# -----------------------------------------------------------------------------
FROM base AS production

# Set working directory
WORKDIR /app

# Copy FreeSurfer from previous stage
ENV FREESURFER_HOME=/usr/local/freesurfer
COPY --from=freesurfer ${FREESURFER_HOME} ${FREESURFER_HOME}
ENV PATH="${FREESURFER_HOME}/bin:${PATH}"

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
# Using PyTorch with CUDA 12.1 support
RUN pip install --no-cache-dir \
    torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/sessions /app/models /app/logs

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV REDIS_HOST=redis
ENV REDIS_PORT=6379
ENV GPU_COUNT=4

# Expose API port
EXPOSE 8100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8100/health || exit 1

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Run both scheduler and API
ENTRYPOINT ["/docker-entrypoint.sh"]
