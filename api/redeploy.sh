#!/bin/bash

# Kill existing uvicorn processes
echo "Checking for running uvicorn processes..."
UVICORN_PIDS=$(ps aux | grep uvicorn | grep -v grep | awk '{print $2}')

if [ -n "$UVICORN_PIDS" ]; then
    echo "Killing uvicorn processes: $UVICORN_PIDS"
    kill $UVICORN_PIDS
    sleep 2
    
    # Force kill if still running
    REMAINING_PIDS=$(ps aux | grep uvicorn | grep -v grep | awk '{print $2}')
    if [ -n "$REMAINING_PIDS" ]; then
        echo "Force killing remaining processes: $REMAINING_PIDS"
        kill -9 $REMAINING_PIDS
    fi
else
    echo "No uvicorn processes found"
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Start uvicorn with nohup
echo "Starting uvicorn..."
nohup .venv/bin/python3.12 -m uvicorn main:app > logs/uvicorn.log 2>&1 &

echo "Uvicorn started with PID: $!"
echo "Logs are being written to logs/uvicorn.log"
