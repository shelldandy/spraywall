import cv2
import numpy as np

from detection.align import estimate_alignment


def test_alignment_returns_identity_when_image_cannot_be_read(tmp_path):
    result = estimate_alignment(str(tmp_path / "missing-new.jpg"), str(tmp_path / "missing-old.jpg"))

    assert result == {"homography": np.eye(3).tolist(), "inliers": 0, "ok": False}


def test_alignment_recovers_synthetic_normalized_homography(tmp_path):
    rng = np.random.default_rng(12)
    new_image = rng.integers(0, 256, (600, 800), dtype=np.uint8)
    # Add structured features in addition to noise so ORB has repeatable keypoints.
    for x in range(40, 780, 80):
        for y in range(40, 580, 80):
            cv2.circle(new_image, (x, y), 12, int((x + y) % 255), 2)
    pixel_transform = np.asarray([[1, 0, 18], [0, 1, -12], [0, 0, 1]], dtype=np.float32)
    old_image = cv2.warpPerspective(new_image, pixel_transform, (800, 600))
    new_path, old_path = tmp_path / "new.png", tmp_path / "old.png"
    assert cv2.imwrite(str(new_path), new_image)
    assert cv2.imwrite(str(old_path), old_image)

    result = estimate_alignment(str(new_path), str(old_path))

    expected = np.asarray([[1, 0, 18 / 800], [0, 1, -12 / 600], [0, 0, 1]])
    assert result["ok"] is True
    assert result["inliers"] >= 40
    np.testing.assert_allclose(result["homography"], expected, atol=0.015)
