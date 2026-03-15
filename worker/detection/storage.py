"""MinIO/S3 storage client for downloading images."""
import os
import tempfile
import boto3
from botocore.client import Config

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


def download_image(storage_key: str) -> str:
    """Download image from MinIO and return local temp file path."""
    client = get_s3_client()
    suffix = os.path.splitext(storage_key)[1] or ".jpg"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    client.download_fileobj(MINIO_BUCKET, storage_key, tmp)
    tmp.close()
    return tmp.name
