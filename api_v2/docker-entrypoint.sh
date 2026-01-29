#!/bin/bash
set -e

echo "=============================================="
echo "Whole-Head Segmentation API v2"
echo "=============================================="
echo "GPU Count: ${GPU_COUNT:-4}"
echo "Redis Host: ${REDIS_HOST:-localhost}:${REDIS_PORT:-6379}"
echo "=============================================="

# Check NVIDIA GPU availability
if command -v nvidia-smi &> /dev/null; then
    echo "GPU Status:"
    nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader
    echo "=============================================="
else
    echo "WARNING: nvidia-smi not found. GPU support may not be available."
fi

# Wait for Redis to be ready
echo "Waiting for Redis..."
until python -c "import redis; r = redis.Redis(host='${REDIS_HOST:-localhost}', port=${REDIS_PORT:-6379}); r.ping()" 2>/dev/null; do
    echo "Redis is unavailable - sleeping"
    sleep 2
done
echo "Redis is ready!"

# Start the GPU scheduler in background
echo "Starting GPU scheduler daemon..."
python -c "
import threading
from runtime.scheduler import scheduler

def run_scheduler():
    scheduler.scheduler_loop()

t = threading.Thread(target=run_scheduler, daemon=True)
t.start()
print('Scheduler started in background thread')
" &

# Give scheduler a moment to start
sleep 2

# Start the FastAPI application
echo "Starting FastAPI application on port 8100..."
exec uvicorn app:app --host 0.0.0.0 --port 8100 --workers 1
