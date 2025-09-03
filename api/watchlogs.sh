#!/bin/bash

LOG_FILE="logs/uvicorn.log"

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
    echo "Log file $LOG_FILE not found!"
    echo "Make sure uvicorn is running and logging to this file."
    exit 1
fi

echo "Watching uvicorn logs with watch command..."
echo "Press Ctrl+C to stop"

# Use watch to continuously display the last 20 lines of the log
watch -n 1 "tail -20 $LOG_FILE"
