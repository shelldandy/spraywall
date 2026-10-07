"""Modal app that runs hold detection (YOLOv8 + SAM) on a serverless GPU.

Setup (from the worker/ directory):
    modal token new
    modal run modal_app.py::download_weights
    modal deploy modal_app.py

Smoke test:
    modal run modal_app.py --image-path /path/to/wall.jpg
"""
import os
import tempfile

import modal

APP_NAME = "spraywall-detect"
MODEL_DIR = "/models"

YOLO_REPO = "jwlarocque/yolov8n-freeclimbs-detect-2"
YOLO_FILE = "yolov8n-freeclimbs-detect-2.pt"
SAM_URL = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"

app = modal.App(APP_NAME)
models_volume = modal.Volume.from_name("spraywall-models", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "ultralytics>=8.1",
        "opencv-python-headless>=4.8",
        "segment-anything",
        "huggingface_hub",
    )
    .env({"MODEL_DIR": MODEL_DIR, "SAM_ENABLED": "true"})
    .add_local_python_source("detection")
)


@app.function(image=image, volumes={MODEL_DIR: models_volume}, timeout=1200)
def download_weights():
    """One-off: populate the models volume with YOLO and SAM weights."""
    import shutil
    import urllib.request

    from huggingface_hub import hf_hub_download

    yolo_path = os.path.join(MODEL_DIR, YOLO_FILE)
    if not os.path.exists(yolo_path):
        shutil.copy(hf_hub_download(repo_id=YOLO_REPO, filename=YOLO_FILE), yolo_path)
        print(f"Downloaded {yolo_path}")

    sam_path = os.path.join(MODEL_DIR, os.path.basename(SAM_URL))
    if not os.path.exists(sam_path):
        urllib.request.urlretrieve(SAM_URL, sam_path)
        print(f"Downloaded {sam_path}")

    models_volume.commit()


@app.cls(image=image, gpu="T4", volumes={MODEL_DIR: models_volume}, scaledown_window=120, timeout=600)
class Detector:
    @modal.enter()
    def load(self):
        from detection.infer import get_model
        from detection.segment import get_predictor

        get_model()
        get_predictor()

    @modal.method()
    def detect(self, image_bytes: bytes) -> list[dict]:
        from detection.infer import detect_holds

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            f.write(image_bytes)
            path = f.name
        try:
            return detect_holds(path)
        finally:
            os.unlink(path)


@app.local_entrypoint()
def main(image_path: str):
    with open(image_path, "rb") as f:
        holds = Detector().detect.remote(f.read())
    with_polygons = sum(1 for h in holds if h["polygon"] is not None)
    print(f"Detected {len(holds)} holds ({with_polygons} with polygons)")
