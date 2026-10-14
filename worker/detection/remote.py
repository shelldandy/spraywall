"""Hold detection via the deployed Modal app (see modal_app.py)."""
import modal

APP_NAME = "spraywall-detect"


def detect_holds_remote(image_path: str) -> list[dict]:
    """Send the image to the Modal GPU detector and return holds in the same shape as detect_holds."""
    with open(image_path, "rb") as f:
        data = f.read()
    detector = modal.Cls.from_name(APP_NAME, "Detector")()
    return detector.detect.remote(data)
