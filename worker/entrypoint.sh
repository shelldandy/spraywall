#!/bin/bash
set -e

MODEL_DIR="./models"
MODEL_FILE="${MODEL_DIR}/yolov8n.pt"

if [ ! -f "$MODEL_FILE" ]; then
    echo "Downloading YOLOv8n model weights..."
    python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
    mv yolov8n.pt "$MODEL_FILE" 2>/dev/null || true
fi

echo "Starting worker..."
exec python main.py
