#!/bin/bash
set -e

MODEL_DIR="${MODEL_DIR:-./models}"
MODEL_FILE="${MODEL_DIR}/yolov8n-freeclimbs-detect-2.pt"

if [ ! -f "$MODEL_FILE" ]; then
    echo "Downloading freeclimbs detection model..."
    mkdir -p "$MODEL_DIR"
    python -c "
from huggingface_hub import hf_hub_download
import shutil
path = hf_hub_download(
    repo_id='jwlarocque/yolov8n-freeclimbs-detect-2',
    filename='yolov8n-freeclimbs-detect-2.pt',
)
shutil.copy(path, '${MODEL_FILE}')
print('Model downloaded to ${MODEL_FILE}')
"
    if [ ! -f "$MODEL_FILE" ]; then
        echo "ERROR: Failed to download model weights" >&2
        exit 1
    fi
fi

echo "Starting worker..."
exec python main.py
