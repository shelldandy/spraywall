from types import SimpleNamespace

import numpy as np

from detection import infer


class FakeTensor:
    def __init__(self, value):
        self.value = value

    def __getitem__(self, index):
        return FakeTensor(np.asarray(self.value)[index])

    def cpu(self):
        return self

    def numpy(self):
        return np.asarray(self.value)


def test_detect_holds_normalizes_bbox_without_masks(monkeypatch):
    box = SimpleNamespace(
        xyxy=FakeTensor([[20, 10, 100, 50]]),
        conf=FakeTensor([0.87]),
    )
    result = SimpleNamespace(orig_shape=(100, 200), boxes=[box], masks=None)

    class FakeModel:
        def __call__(self, image_path, **_kwargs):
            assert image_path == "wall.jpg"
            return [result]

    monkeypatch.setattr(infer, "get_model", lambda: FakeModel())

    holds = infer.detect_holds("wall.jpg")

    assert len(holds) == 1
    assert holds[0]["bbox"] == {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.4}
    assert holds[0]["polygon"] is None
    assert holds[0]["confidence"] == 0.87
