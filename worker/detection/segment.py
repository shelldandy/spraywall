"""SAM-based hold segmentation using bounding box prompts."""
import os

import cv2
import numpy as np

SAM_ENABLED = os.environ.get("SAM_ENABLED", "false").lower() == "true"
SAM_MODEL_TYPE = os.environ.get("SAM_MODEL_TYPE", "vit_b")
SAM_CHECKPOINT = os.environ.get(
    "SAM_CHECKPOINT",
    os.path.join(os.environ.get("MODEL_DIR", "./models"), "sam_vit_b_01ec64.pth"),
)

_sam_predictor = None


def get_predictor():
    """Lazy-load SAM predictor."""
    global _sam_predictor
    if _sam_predictor is None:
        from segment_anything import SamPredictor, sam_model_registry

        sam = sam_model_registry[SAM_MODEL_TYPE](checkpoint=SAM_CHECKPOINT)
        _sam_predictor = SamPredictor(sam)
    return _sam_predictor


def segment_holds(
    image_path: str,
    holds: list[dict],
    img_w: int,
    img_h: int,
) -> list[dict]:
    """Run SAM segmentation on detected holds using bbox prompts.

    Updates each hold's 'polygon' field with simplified contour points.
    Returns the updated holds list.
    """
    if not SAM_ENABLED or not holds:
        return holds

    image = cv2.imread(image_path)
    if image is None:
        return holds
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    predictor = get_predictor()
    predictor.set_image(image_rgb)

    for hold in holds:
        bbox = hold["bbox"]
        # Convert normalized xywh to pixel xyxy
        x1 = bbox["x"] * img_w
        y1 = bbox["y"] * img_h
        x2 = (bbox["x"] + bbox["w"]) * img_w
        y2 = (bbox["y"] + bbox["h"]) * img_h

        input_box = np.array([x1, y1, x2, y2])

        masks, scores, _ = predictor.predict(
            box=input_box[None, :],
            multimask_output=True,
        )

        # Select best mask by IoU score
        best_idx = int(np.argmax(scores))
        mask = masks[best_idx]

        polygon = _post_process_mask(mask, img_w, img_h)
        if polygon is not None:
            hold["polygon"] = polygon
            hold["confidence"] = max(hold["confidence"], float(scores[best_idx]))

    return holds


def _post_process_mask(
    mask: np.ndarray,
    img_w: int,
    img_h: int,
) -> list[list[float]] | None:
    """Convert binary mask to simplified polygon contour.

    Pipeline mirrors freeclimbs SamWorker.ts:
    1. Convert to uint8
    2. Morphological erode + dilate to clean noise
    3. Find contours
    4. Approximate polygon (simplify)
    5. Normalize to 0-1
    """
    # Convert boolean mask to uint8
    mask_uint8 = (mask * 255).astype(np.uint8)

    # Morphological operations to clean up
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask_uint8 = cv2.erode(mask_uint8, kernel, iterations=1)
    mask_uint8 = cv2.dilate(mask_uint8, kernel, iterations=1)

    # Find contours
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None

    # Take the largest contour
    contour = max(contours, key=cv2.contourArea)

    # Simplify polygon
    epsilon = 0.002 * cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, epsilon, True)

    if len(approx) < 3:
        return None

    # Normalize to 0-1
    polygon = [[float(pt[0][0] / img_w), float(pt[0][1] / img_h)] for pt in approx]

    return polygon
