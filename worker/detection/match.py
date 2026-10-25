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


# intersectConvexConvex has absolute float tolerances that zero out overlaps of
# small holds in normalized coordinates; IoU is scale-invariant, so scale up first.
_IOU_SCALE = 10_000.0


def _hull_area(polygon):
    if len(polygon) < 3:
        return 0.0
    hull = cv2.convexHull(polygon).reshape(-1, 2)
    return abs(cv2.contourArea(hull * _IOU_SCALE)) / (_IOU_SCALE * _IOU_SCALE)


def _iou(first, second):
    if len(first) < 3 or len(second) < 3:
        return 0.0
    first = first * _IOU_SCALE
    second = second * _IOU_SCALE
    first_hull = cv2.convexHull(first).reshape(-1, 2)
    second_hull = cv2.convexHull(second).reshape(-1, 2)
    area_a = abs(cv2.contourArea(first_hull))
    area_b = abs(cv2.contourArea(second_hull))
    if area_a <= 0 or area_b <= 0:
        return 0.0
    intersection, _ = cv2.intersectConvexConvex(first_hull, second_hull)
    union = area_a + area_b - intersection
    return float(intersection / union) if union > 0 else 0.0


def _greedy_assign(candidates, used_new=None, used_old=None):
    used_new = set() if used_new is None else used_new
    used_old = set() if used_old is None else used_old
    matches = []
    for overlap, _center_distance, new_index, old_index in sorted(
        candidates, key=lambda candidate: (-candidate[0], candidate[1], candidate[2], candidate[3])
    ):
        if new_index in used_new or old_index in used_old:
            continue
        used_new.add(new_index)
        used_old.add(old_index)
        matches.append({"new_index": new_index, "old_index": old_index, "iou": overlap})
    return matches


_NEIGHBOURS = 6
# Weight vertical distance more heavily so a hold borrows its correction from
# its own row; a kickboard's offset differs from the wall directly above it.
_ROW_WEIGHT = 5.0
_CORRECTION_ROUNDS = 5


def _corrected_candidates(new_polygons, projected_old, matches, used_new, used_old, threshold):
    candidates = []
    for new_index, new_polygon in new_polygons.items():
        if new_index in used_new:
            continue
        new_center = new_polygon.mean(axis=0)
        new_area = _hull_area(new_polygon)
        if new_area <= 0:
            continue

        def neighbour_distance(match):
            dx, dy = new_center - new_polygons[match["new_index"]].mean(axis=0)
            return float(np.hypot(dx, _ROW_WEIGHT * dy))

        neighbours = sorted(
            matches, key=lambda match: (neighbour_distance(match), match["new_index"], match["old_index"])
        )[:_NEIGHBOURS]
        offsets = np.asarray(
            [
                projected_old[match["old_index"]].mean(axis=0)
                - new_polygons[match["new_index"]].mean(axis=0)
                for match in neighbours
            ]
        )
        # Residuals point from the new hold to the projected old hold, so
        # translate old shapes by the negative residual to align them locally.
        correction = -np.median(offsets, axis=0)

        for old_index, old_polygon in projected_old.items():
            if old_index in used_old:
                continue
            shifted_old = old_polygon + correction
            old_area = _hull_area(shifted_old)
            if old_area <= 0:
                continue
            overlap = _iou(new_polygon, shifted_old)
            center_distance = float(np.linalg.norm(new_center - shifted_old.mean(axis=0)))
            close_with_similar_area = (
                center_distance <= 0.5 * np.sqrt(new_area)
                and 0.5 <= old_area / new_area <= 2.0
            )
            if overlap >= threshold or close_with_similar_area:
                candidates.append((overlap, center_distance, new_index, old_index))
    return candidates


def match_holds(new_holds: list[dict], old_holds: list[dict], homography, threshold: float = 0.3) -> list[dict]:
    """Return greedy one-to-one matches; homography maps new normalized points to old."""
    matrix = np.asarray(homography, dtype=np.float64).reshape(3, 3)
    if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix)) < 1e-10:
        return []
    inverse = np.linalg.inv(matrix)

    new_polygons, projected_old = {}, {}
    for index, hold in enumerate(new_holds):
        try:
            new_polygons[index] = _polygon(hold)
        except (KeyError, TypeError, ValueError, cv2.error):
            continue
    for index, hold in enumerate(old_holds):
        try:
            projected_old[index] = _project(_polygon(hold), inverse)
        except (KeyError, TypeError, ValueError, cv2.error):
            continue

    candidates = []
    for new_index, new_polygon in new_polygons.items():
        for old_index, old_polygon in projected_old.items():
            overlap = _iou(new_polygon, old_polygon)
            if overlap >= threshold:
                center_distance = float(np.linalg.norm(new_polygon.mean(axis=0) - old_polygon.mean(axis=0)))
                candidates.append((overlap, center_distance, new_index, old_index))

    matches = _greedy_assign(candidates)
    used_new = {match["new_index"] for match in matches}
    used_old = {match["old_index"] for match in matches}

    # Correct remaining projected holds using nearby established matches. This
    # accommodates local planes (such as kickboards) that differ from the wall.
    if len(matches) < 3:
        return matches

    for _round in range(_CORRECTION_ROUNDS):
        added = _greedy_assign(
            _corrected_candidates(new_polygons, projected_old, matches, used_new, used_old, threshold),
            used_new,
            used_old,
        )
        if not added:
            break
        # Fresh matches sharpen the local correction for their unmatched neighbours.
        matches.extend(added)
    return matches
