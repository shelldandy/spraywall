"""Match holds across aligned wall images using normalized-coordinate overlap."""
import cv2
import numpy as np


def _polygon(hold):
    points = hold.get("polygon")
    if points:
        return np.asarray(points, dtype=np.float32).reshape(-1, 2)
    box = hold["bbox"]
    x, y, w, h = (float(box[k]) for k in ("x", "y", "w", "h"))
    return np.asarray([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32)


def _project(points, matrix):
    points = np.asarray(points, dtype=np.float64).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(points, matrix).reshape(-1, 2).astype(np.float32)


def _iou(first, second):
    if len(first) < 3 or len(second) < 3:
        return 0.0
    first_hull = cv2.convexHull(first).reshape(-1, 2)
    second_hull = cv2.convexHull(second).reshape(-1, 2)
    area_a = abs(cv2.contourArea(first_hull))
    area_b = abs(cv2.contourArea(second_hull))
    if area_a <= 0 or area_b <= 0:
        return 0.0
    intersection, _ = cv2.intersectConvexConvex(first_hull, second_hull)
    union = area_a + area_b - intersection
    return float(intersection / union) if union > 0 else 0.0


def match_holds(new_holds: list[dict], old_holds: list[dict], homography, threshold: float = 0.3) -> list[dict]:
    """Return greedy one-to-one matches; homography maps new normalized points to old."""
    matrix = np.asarray(homography, dtype=np.float64).reshape(3, 3)
    if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix)) < 1e-10:
        return []
    inverse = np.linalg.inv(matrix)
    candidates = []
    for new_index, new_hold in enumerate(new_holds):
        try:
            new_polygon = _polygon(new_hold)
            for old_index, old_hold in enumerate(old_holds):
                projected_old = _project(_polygon(old_hold), inverse)
                overlap = _iou(new_polygon, projected_old)
                if overlap >= threshold:
                    center_distance = float(np.linalg.norm(new_polygon.mean(axis=0) - projected_old.mean(axis=0)))
                    candidates.append((overlap, center_distance, new_index, old_index))
        except (KeyError, TypeError, ValueError, cv2.error):
            continue

    matches = []
    used_new, used_old = set(), set()
    for overlap, _center_distance, new_index, old_index in sorted(
        candidates, key=lambda candidate: (-candidate[0], candidate[1], candidate[2], candidate[3])
    ):
        if new_index in used_new or old_index in used_old:
            continue
        used_new.add(new_index)
        used_old.add(old_index)
        matches.append({"new_index": new_index, "old_index": old_index, "iou": overlap})
    return matches
