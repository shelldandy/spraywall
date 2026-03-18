"""Hold detection inference using YOLOv8."""
import os
from ultralytics import YOLO

MODEL_DIR = os.environ.get("MODEL_DIR", "./models")
MODEL_PATH = os.path.join(MODEL_DIR, "yolov8n-freeclimbs-detect-2.pt")

_model = None


def get_model():
    global _model
    if _model is None:
        _model = YOLO(MODEL_PATH)
    return _model


def detect_holds(image_path: str) -> list[dict]:
    """Run inference on an image and return normalized hold bboxes.

    Returns list of dicts with keys: bbox, polygon, confidence
    bbox is {x, y, w, h} normalized 0-1
    polygon is [[x,y], ...] normalized or None
    """
    model = get_model()
    results = model(image_path, imgsz=2560, max_det=2000, verbose=False)

    holds = []
    img_w = 0
    img_h = 0
    for result in results:
        img_h, img_w = result.orig_shape

        if result.boxes is not None:
            for i, box in enumerate(result.boxes):
                # Get bbox in xyxy format
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                conf = float(box.conf[0].cpu().numpy())

                # Normalize to 0-1
                nx = float(x1 / img_w)
                ny = float(y1 / img_h)
                nw = float((x2 - x1) / img_w)
                nh = float((y2 - y1) / img_h)

                hold = {
                    "bbox": {"x": nx, "y": ny, "w": nw, "h": nh},
                    "polygon": None,
                    "confidence": conf,
                }

                # If masks are available, extract polygon
                if result.masks is not None and i < len(result.masks):
                    mask_xy = result.masks[i].xy[0]
                    if len(mask_xy) > 0:
                        polygon = [
                            [float(pt[0] / img_w), float(pt[1] / img_h)]
                            for pt in mask_xy
                        ]
                        hold["polygon"] = polygon

                holds.append(hold)

    # Run SAM segmentation if enabled (only on holds without polygons)
    from detection.segment import SAM_ENABLED, segment_holds

    if SAM_ENABLED and img_w > 0 and img_h > 0:
        holds_needing_segmentation = [h for h in holds if h["polygon"] is None]
        if holds_needing_segmentation:
            holds_needing_segmentation = segment_holds(
                image_path, holds_needing_segmentation, img_w, img_h
            )
            # Merge back
            seg_idx = 0
            for i, h in enumerate(holds):
                if h["polygon"] is None and seg_idx < len(holds_needing_segmentation):
                    holds[i] = holds_needing_segmentation[seg_idx]
                    seg_idx += 1

    return holds
