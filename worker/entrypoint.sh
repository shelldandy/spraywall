#!/bin/bash
set -e

MODEL_DIR="./models"
MODEL_FILE="${MODEL_DIR}/yolov8n.pt"

if [ ! -f "$MODEL_FILE" ]; then
    echo "Downloading YOLOv8n model weights..."
    mkdir -p "$MODEL_DIR"
    python -c "
from ultralytics import YOLO
model = YOLO('yolov8n.pt')
import shutil, os
# ultralytics caches to ~/.cache/ultralytics or beside the script; find and move it
for candidate in ['yolov8n.pt', os.path.expanduser('~/.cache/ultralytics/yolov8n.pt')]:
    if os.path.isfile(candidate):
        shutil.move(candidate, '${MODEL_FILE}')
        break
"
    if [ ! -f "$MODEL_FILE" ]; then
        echo "ERROR: Failed to download YOLOv8n model weights" >&2
        exit 1
    fi
fi

echo "Starting worker..."
exec python main.py
