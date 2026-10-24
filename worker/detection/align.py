"""Estimate a normalized-coordinate projective transform between wall photos."""
import cv2
import numpy as np

MIN_INLIERS = 40


def estimate_alignment(new_image_path: str, old_image_path: str) -> dict:
    """Return new-to-old normalized homography and its inlier count."""
    identity = np.eye(3, dtype=float).tolist()
    failed = {"homography": identity, "inliers": 0, "ok": False}
    try:
        new_image = cv2.imread(new_image_path, cv2.IMREAD_GRAYSCALE)
        old_image = cv2.imread(old_image_path, cv2.IMREAD_GRAYSCALE)
        if new_image is None or old_image is None:
            return failed
        new_h, new_w = new_image.shape
        old_h, old_w = old_image.shape
        if not new_w or not new_h or not old_w or not old_h:
            return failed

        new_scale = min(1.0, 1600 / max(new_w, new_h))
        old_scale = min(1.0, 1600 / max(old_w, old_h))
        if new_scale < 1.0:
            new_image = cv2.resize(new_image, None, fx=new_scale, fy=new_scale, interpolation=cv2.INTER_AREA)
        if old_scale < 1.0:
            old_image = cv2.resize(old_image, None, fx=old_scale, fy=old_scale, interpolation=cv2.INTER_AREA)
        new_h, new_w = new_image.shape
        old_h, old_w = old_image.shape

        detector = cv2.ORB_create(nfeatures=10000)
        new_keypoints, new_descriptors = detector.detectAndCompute(new_image, None)
        old_keypoints, old_descriptors = detector.detectAndCompute(old_image, None)
        if new_descriptors is None or old_descriptors is None:
            return failed
        pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(new_descriptors, old_descriptors, k=2)
        good = [first for pair in pairs if len(pair) == 2
                for first, second in [pair] if first.distance < 0.75 * second.distance]
        if len(good) < MIN_INLIERS:
            return failed

        # Homography is estimated in normalized coordinates to support differing image sizes/aspect ratios.
        new_points = np.float32([
            [new_keypoints[m.queryIdx].pt[0] / new_w, new_keypoints[m.queryIdx].pt[1] / new_h]
            for m in good
        ]).reshape(-1, 1, 2)
        old_points = np.float32([
            [old_keypoints[m.trainIdx].pt[0] / old_w, old_keypoints[m.trainIdx].pt[1] / old_h]
            for m in good
        ]).reshape(-1, 1, 2)
        homography, mask = cv2.findHomography(new_points, old_points, cv2.RANSAC, 0.005)
        inliers = int(mask.sum()) if mask is not None else 0
        if homography is None or inliers < MIN_INLIERS or not np.isfinite(homography).all():
            return {"homography": identity, "inliers": inliers, "ok": False}
        if abs(np.linalg.det(homography)) < 1e-10:
            return {"homography": identity, "inliers": inliers, "ok": False}
        homography /= homography[2, 2]
        if not np.isfinite(homography).all():
            return {"homography": identity, "inliers": inliers, "ok": False}
        return {"homography": homography.tolist(), "inliers": inliers, "ok": True}
    except (cv2.error, ValueError, TypeError, np.linalg.LinAlgError):
        return failed


# Compatibility-friendly concise name for callers.
align_images = estimate_alignment
