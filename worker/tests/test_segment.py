import sys
from contextlib import nullcontext
from types import ModuleType, SimpleNamespace

import numpy as np

import detection.segment as segment
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


def test_segment_holds_batches_boxes_and_assigns_best_mask(monkeypatch):
    image = np.zeros((1200, 2000, 3), dtype=np.uint8)
    masks = np.zeros((2, 3, 614, 1024), dtype=bool)
    masks[0, 2, 100:200, 150:300] = True
    masks[1, 0, 350:500, 600:800] = True
    scores = np.array([[0.1, 0.2, 0.9], [0.8, 0.3, 0.2]])

    class StubPredictor:
        def __init__(self):
            self.predict_calls = 0

        def set_image(self, supplied_image):
            assert supplied_image.shape == (614, 1024, 3)

        def predict(self, *, box, multimask_output):
            self.predict_calls += 1
            self.boxes = box
            assert multimask_output is True
            if len(box) == 1:
                return masks[0], scores[0], None
            return masks, scores, None

    predictor = StubPredictor()
    monkeypatch.setattr(segment, "SAM_ENABLED", True)
    monkeypatch.setattr(segment, "sam_available", lambda: True)
    monkeypatch.setattr(segment, "get_predictor", lambda: predictor)
    monkeypatch.setattr(segment.cv2, "imread", lambda _path: image)

    # Keep this unit test independent of an installed PyTorch runtime.
    torch_stub = ModuleType("torch")
    torch_stub.cuda = SimpleNamespace(is_available=lambda: False)
    torch_stub.inference_mode = nullcontext
    monkeypatch.setitem(sys.modules, "torch", torch_stub)

    holds = [
        {
            "bbox": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
            "polygon": None,
            "confidence": 0.4,
        },
        {
            "bbox": {"x": 0.5, "y": 0.1, "w": 0.25, "h": 0.5},
            "polygon": None,
            "confidence": 0.95,
        },
    ]

    result = segment.segment_holds("unused.jpg", holds, img_w=2000, img_h=1200)

    assert result is holds
    assert predictor.predict_calls == 1
    np.testing.assert_allclose(
        predictor.boxes,
        [[102.4, 122.8, 409.6, 368.4], [512, 61.4, 768, 368.4]],
    )
    assert all(hold["polygon"] is not None for hold in result)
    assert result[0]["confidence"] == 0.9
    assert result[1]["confidence"] == 0.95

    first_x = [point[0] for point in result[0]["polygon"]]
    first_y = [point[1] for point in result[0]["polygon"]]
    second_x = [point[0] for point in result[1]["polygon"]]
    second_y = [point[1] for point in result[1]["polygon"]]
    assert min(first_x) == 150 / 1024
    assert min(first_y) == 100 / 614
    assert min(second_x) == 600 / 1024
    assert np.isclose(min(second_y), 350 / 614, atol=1 / 614)

    single_hold = [{"bbox": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}, "polygon": None, "confidence": 0.4}]
    result = segment.segment_holds("unused.jpg", single_hold, img_w=2000, img_h=1200)
    assert result[0]["polygon"] is not None
    assert result[0]["confidence"] == 0.9


def test_segment_holds_chunks_predictions_and_skips_bf16_on_t4(monkeypatch):
    image = np.zeros((32, 32, 3), dtype=np.uint8)

    class StubPredictor:
        def __init__(self):
            self.batch_sizes = []
            self.set_image_calls = 0

        def set_image(self, supplied_image):
            self.set_image_calls += 1
            assert supplied_image.shape == image.shape

        def predict(self, *, box, multimask_output):
            self.batch_sizes.append(len(box))
            assert multimask_output is True
            masks = np.zeros((len(box), 3, 32, 32), dtype=bool)
            masks[:, 1, 8:24, 8:24] = True
            scores = np.tile([0.1, 0.9, 0.2], (len(box), 1))
            if len(box) == 1:
                return masks[0], scores[0], None
            return masks, scores, None

    predictor = StubPredictor()
    monkeypatch.setattr(segment, "SAM_ENABLED", True)
    monkeypatch.setattr(segment, "sam_available", lambda: True)
    monkeypatch.setattr(segment, "get_predictor", lambda: predictor)
    monkeypatch.setattr(segment.cv2, "imread", lambda _path: image)

    torch_stub = ModuleType("torch")
    torch_stub.cuda = SimpleNamespace(
        is_available=lambda: True,
        get_device_capability=lambda: (7, 5),
    )
    torch_stub.inference_mode = nullcontext
    torch_stub.autocast = lambda **_kwargs: (_ for _ in ()).throw(AssertionError("T4 must skip bfloat16 autocast"))
    monkeypatch.setitem(sys.modules, "torch", torch_stub)

    holds = [
        {"bbox": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8}, "polygon": None, "confidence": 0.5}
        for _ in range(65)
    ]

    result = segment.segment_holds("unused.jpg", holds, img_w=32, img_h=32)

    assert predictor.set_image_calls == 1
    assert predictor.batch_sizes == [32, 32, 1]
    assert all(hold["polygon"] is not None for hold in result)
    assert all(hold["confidence"] == 0.9 for hold in result)


def test_cuda_autocast_uses_bfloat16_on_supported_gpu():
    torch_stub = ModuleType("torch")
    torch_stub.cuda = SimpleNamespace(is_available=lambda: True, get_device_capability=lambda: (8, 0))
    torch_stub.bfloat16 = "bf16"
    autocast_calls = []

    def autocast(**kwargs):
        autocast_calls.append(kwargs)
        return nullcontext()

    torch_stub.autocast = autocast

    with segment._cuda_autocast_context(torch_stub):
        pass

    assert autocast_calls == [{"device_type": "cuda", "dtype": "bf16"}]


def test_post_process_mask_preserves_tiny_hold_with_scaled_kernel():
    mask = np.zeros((20, 20), dtype=bool)
    mask[5:8, 5:8] = True

    assert _post_process_mask(mask, img_w=20, img_h=20) is None
    assert _post_process_mask(mask, img_w=20, img_h=20, kernel_size=1) is not None
