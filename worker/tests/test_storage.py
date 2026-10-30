from io import BytesIO

import pytest
from PIL import Image

from detection import storage


class FakeS3:
    def __init__(self, payload=b"raw-image", error=None):
        self.payload = payload
        self.error = error

    def download_fileobj(self, _bucket, _key, destination):
        destination.write(self.payload)
        if self.error:
            raise self.error


def use_temp_dir(monkeypatch, tmp_path):
    original = storage.tempfile.NamedTemporaryFile

    def named_temp(*args, **kwargs):
        return original(*args, dir=tmp_path, **kwargs)

    monkeypatch.setattr(storage.tempfile, "NamedTemporaryFile", named_temp)


def test_download_failure_removes_raw_temp_file(monkeypatch, tmp_path):
    use_temp_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(storage, "get_s3_client", lambda: FakeS3(error=OSError("download failed")))

    with pytest.raises(OSError, match="download failed"):
        storage.download_image("walls/test.jpg")

    assert list(tmp_path.iterdir()) == []


def test_conversion_failure_removes_raw_and_jpeg_temp_files(monkeypatch, tmp_path):
    use_temp_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(storage, "get_s3_client", lambda: FakeS3())

    def fail_open(_path):
        raise OSError("decode failed")

    monkeypatch.setattr(storage.Image, "open", fail_open)
    with pytest.raises(OSError, match="decode failed"):
        storage.download_image("walls/test.jpg")

    assert list(tmp_path.iterdir()) == []


def test_success_returns_jpeg_and_removes_raw_file(monkeypatch, tmp_path):
    use_temp_dir(monkeypatch, tmp_path)
    image_bytes = BytesIO()
    Image.new("RGB", (2, 2), "red").save(image_bytes, "PNG")
    monkeypatch.setattr(storage, "get_s3_client", lambda: FakeS3(image_bytes.getvalue()))

    jpeg_path = storage.download_image("walls/test.png")
    try:
        assert jpeg_path.endswith(".jpg")
        assert open(jpeg_path, "rb").read(2) == b"\xff\xd8"
        assert [path.name for path in tmp_path.iterdir()] == [jpeg_path.split("/")[-1]]
    finally:
        storage.os.unlink(jpeg_path)
