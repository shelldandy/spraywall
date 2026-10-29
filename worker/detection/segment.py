"""SAM-based hold segmentation using bounding box prompts."""
import logging
import os
from contextlib import nullcontext

import cv2
import numpy as np

logger = logging.getLogger(__name__)

SAM_ENABLED = os.environ.get("SAM_ENABLED", "true").lower() == "true"
SAM_MODEL_CFG = os.environ.get("SAM_MODEL_CFG", "configs/sam2.1/sam2.1_hiera_s.yaml")
SAM_CHECKPOINT = os.environ.get(
    "SAM_CHECKPOINT",
    os.path.join(os.environ.get("MODEL_DIR", "./models"), "sam2.1_hiera_small.pt"),
)

_sam_predictor = None
_sam_available = None


def sam_available() -> bool:
    """Check once whether SAM can run; warn and fall back to boxes if not."""
    global _sam_available
    if _sam_available is None:
        try:
            import sam2  # noqa: F401
        except ImportError:
            logger.warning("SAM disabled: sam2 is not installed (build with INSTALL_SAM=true)")
            _sam_available = False
        else:
            if not os.path.isfile(SAM_CHECKPOINT):
                logger.warning("SAM disabled: checkpoint not found at %s", SAM_CHECKPOINT)
                _sam_available = False
            else:
                _sam_available = True
    return _sam_available


def get_predictor():
    """Lazy-load SAM predictor."""
    global _sam_predictor
    if _sam_predictor is None:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = build_sam2(SAM_MODEL_CFG, SAM_CHECKPOINT, device=device)
        _sam_predictor = SAM2ImagePredictor(model)
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
    if not SAM_ENABLED or not holds or not sam_available():
        logger.info("SAM skipped: enabled=%s, holds=%d", SAM_ENABLED, len(holds))
        return holds

    logger.info("Running SAM on %d holds, checkpoint=%s", len(holds), SAM_CHECKPOINT)

    image = cv2.imread(image_path)
    if image is None:
        return holds
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    # Keep batched output masks bounded; SAM 2's encoder uses a 1024px long side.
    model_h, model_w = image_rgb.shape[:2]
    if max(model_h, model_w) > 1024:
        scale = 1024 / max(model_h, model_w)
        model_w = round(model_w * scale)
        model_h = round(model_h * scale)
        image_rgb = cv2.resize(image_rgb, (model_w, model_h), interpolation=cv2.INTER_AREA)

    predictor = get_predictor()
    boxes = np.array(
        [
            [
                hold["bbox"]["x"] * model_w,
                hold["bbox"]["y"] * model_h,
                (hold["bbox"]["x"] + hold["bbox"]["w"]) * model_w,
                (hold["bbox"]["y"] + hold["bbox"]["h"]) * model_h,
            ]
            for hold in holds
        ],
        dtype=np.float32,
    )

    import torch

    autocast = (
        torch.autocast(device_type="cuda", dtype=torch.bfloat16)
        if torch.cuda.is_available()
        else nullcontext()
    )
    with torch.inference_mode(), autocast:
        predictor.set_image(image_rgb)
        masks, scores, _ = predictor.predict(
            box=boxes,
            multimask_output=True,
        )

    # SAM 2 squeezes the batch dimension for a single box.
    if masks.ndim == 3:
        masks = masks[None, ...]
    if scores.ndim == 1:
        scores = scores[None, ...]

    for hold, hold_masks, hold_scores in zip(holds, masks, scores):
        # Select best mask by IoU score
        best_idx = int(np.argmax(hold_scores))
        mask = hold_masks[best_idx]

        polygon = _post_process_mask(mask, model_w, model_h)
        if polygon is not None:
            hold["polygon"] = polygon
            hold["confidence"] = max(hold["confidence"], float(hold_scores[best_idx]))

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
