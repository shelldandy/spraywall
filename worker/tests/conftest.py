"""Keep worker unit tests independent of model and PyTorch installations."""

import os
import sys
from pathlib import Path
from types import ModuleType

WORKER_ROOT = Path(__file__).resolve().parents[1]
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

os.environ["SAM_ENABLED"] = "false"


class _UnusedYOLO:
    def __init__(self, *_args, **_kwargs):
        raise AssertionError("unit tests should not load a YOLO model")


ultralytics_stub = ModuleType("ultralytics")
ultralytics_stub.YOLO = _UnusedYOLO
sys.modules["ultralytics"] = ultralytics_stub
