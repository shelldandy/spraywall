import numpy as np

from detection.segment import _post_process_mask


def test_post_process_mask_returns_normalized_polygon_for_filled_rectangle():
    mask = np.zeros((100, 200), dtype=bool)
    mask[20:80, 40:160] = True

    polygon = _post_process_mask(mask, img_w=200, img_h=100)

    assert polygon is not None
    assert len(polygon) >= 3
    assert all(0 <= coordinate <= 1 for point in polygon for coordinate in point)


def test_post_process_mask_returns_none_for_empty_mask():
    mask = np.zeros((100, 200), dtype=bool)

    assert _post_process_mask(mask, img_w=200, img_h=100) is None
