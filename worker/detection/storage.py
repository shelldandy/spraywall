"""MinIO/S3 storage client for downloading images."""

import logging
import os
import tempfile

import boto3
import pillow_heif
from botocore.client import Config
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

logger = logging.getLogger(__name__)
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ROOT_USER", "minioadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_ROOT_PASSWORD", "minioadmin")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "spraywall")


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{MINIO_ENDPOINT}",
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def _remove_temp_file(path: str | None):
    if not path:
        return
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    except OSError:
        # Cleanup must not replace a more useful download/conversion exception.
        logger.warning("Could not remove temporary image file %s", path, exc_info=True)


def download_image(storage_key: str) -> str:
    """Download image from MinIO and return a JPEG temp file path.

    Converts HEIC/WebP/PNG/etc. to JPEG so OpenCV and YOLO can read it. The
    returned JPEG belongs to the caller, which must remove it after inference.
    """
    client = get_s3_client()
    raw_path = None
    output_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False) as raw:
            raw_path = raw.name
            client.download_fileobj(MINIO_BUCKET, storage_key, raw)

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as output:
            output_path = output.name

        with Image.open(raw_path) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            img.save(output_path, "JPEG", quality=95)

        result = output_path
        output_path = None
        return result
    finally:
        _remove_temp_file(raw_path)
        _remove_temp_file(output_path)
