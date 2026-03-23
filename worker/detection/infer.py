"""Hold detection inference using YOLOv8."""
import logging
import os
from ultralytics import YOLO

logger = logging.getLogger(__name__)

MODEL_DIR = os.environ.get("MODEL_DIR", "./models")
MODEL_PATH = os.path.join(MODEL_DIR, "yolov8n-freeclimbs-detect-2.pt")

DETECTION_IMGSZ = int(os.environ.get("DETECTION_IMGSZ", "1280"))
DETECTION_CONF = float(os.environ.get("DETECTION_CONF", "0.5"))
DETECTION_IOU = float(os.environ.get("DETECTION_IOU", "0.45"))
DETECTION_MAX_DET = int(os.environ.get("DETECTION_MAX_DET", "500"))

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
    results = model(image_path, imgsz=DETECTION_IMGSZ, conf=DETECTION_CONF, iou=DETECTION_IOU, max_det=DETECTION_MAX_DET, verbose=False)

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

    logger.info("SAM_ENABLED=%s, img_w=%d, img_h=%d", SAM_ENABLED, img_w, img_h)
    needs_seg = [h for h in holds if h["polygon"] is None]
    logger.info("%d/%d holds need segmentation", len(needs_seg), len(holds))

    if SAM_ENABLED and img_w > 0 and img_h > 0 and needs_seg:
        try:
            needs_seg = segment_holds(image_path, needs_seg, img_w, img_h)
            polygons_produced = sum(1 for h in needs_seg if h["polygon"] is not None)
            logger.info("SAM produced %d polygons", polygons_produced)
            # Merge back
            seg_idx = 0
            for i, h in enumerate(holds):
                if h["polygon"] is None and seg_idx < len(needs_seg):
                    holds[i] = needs_seg[seg_idx]
                    seg_idx += 1
        except Exception:
            logger.exception("SAM segmentation failed")

    return holds
