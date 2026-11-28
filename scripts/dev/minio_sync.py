#!/usr/bin/env python3
"""Dump or restore the configured MinIO bucket to a directory tree."""

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath

import boto3
from botocore.exceptions import ClientError

ROOT_DIR = Path(__file__).resolve().parents[2]
MANIFEST = ".minio-sync.json"


def credentials() -> tuple[str, str, str]:
    values: dict[str, str] = {}
    env_file = ROOT_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, separator, raw_value = line.partition("=")
            if separator:
                key = key.removeprefix("export ").strip()
                raw_value = raw_value.strip()
                if len(raw_value) >= 2 and raw_value[0] == raw_value[-1] and raw_value[0] in "'\"":
                    raw_value = raw_value[1:-1]
                else:
                    raw_value = raw_value.split(" #", 1)[0].rstrip()
                values[key] = raw_value

    def value(name: str) -> str:
        result = os.environ.get(name, values.get(name, ""))
        if not result:
            raise ValueError(f"{name} must be set in .env or the environment")
        return result

    return value("MINIO_ROOT_USER"), value("MINIO_ROOT_PASSWORD"), value("MINIO_BUCKET")


def client_and_bucket():
    access_key, secret_key, bucket = credentials()
    client = boto3.client(
        "s3",
        endpoint_url="http://127.0.0.1:9000",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="us-east-1",
    )
    return client, bucket


def local_path(root: Path, key: str) -> Path:
    relative = PurePosixPath(key)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Unsafe MinIO object key: {key!r}")
    root = root.resolve()
    path = root.joinpath(*relative.parts)
    if not path.resolve().is_relative_to(root):
        raise ValueError(f"Unsafe MinIO object key: {key!r}")
    return path


def object_keys(client, bucket: str):
    pages = client.get_paginator("list_objects_v2").paginate(Bucket=bucket)
    for page in pages:
        for item in page.get("Contents", []):
            yield item["Key"]


def dump(directory: Path) -> None:
    client, bucket = client_and_bucket()
    if directory.is_symlink():
        raise ValueError(f"Refusing to replace symlink dump directory: {directory}")
    directory = directory.resolve()
    if directory in (Path("/"), ROOT_DIR, Path.home()):
        raise ValueError(f"Refusing to replace unsafe dump directory: {directory}")
    if directory.exists() and not directory.is_dir():
        raise ValueError(f"Dump destination is not a directory: {directory}")
    directory.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=f".{directory.name}.", dir=directory.parent) as temp:
        staging = Path(temp) / "dump"
        staging.mkdir()
        content_types: dict[str, str] = {}
        count = 0
        for key in object_keys(client, bucket):
            destination = local_path(staging, key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            client.download_file(bucket, key, str(destination))
            content_type = client.head_object(Bucket=bucket, Key=key).get("ContentType")
            if content_type:
                content_types[key] = content_type
            count += 1
        if count == 0:
            raise ValueError(f"MinIO bucket {bucket!r} is empty; refusing to write an empty fixture")
        (staging / MANIFEST).write_text(json.dumps({"content_types": content_types}, indent=2) + "\n")

        old_directory = directory.with_name(f".{directory.name}.old")
        if old_directory.exists():
            shutil.rmtree(old_directory)
        if directory.exists():
            directory.rename(old_directory)
        try:
            staging.rename(directory)
        except Exception:
            if old_directory.exists() and not directory.exists():
                old_directory.rename(directory)
            raise
        if old_directory.exists():
            shutil.rmtree(old_directory)
    print(f"Dumped {count} objects from bucket {bucket!r} to {directory}")


def ensure_bucket(client, bucket: str) -> None:
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in {"404", "NoSuchBucket", "NotFound"}:
            raise
        client.create_bucket(Bucket=bucket)


def clear_bucket(client, bucket: str) -> None:
    pending: list[dict[str, str]] = []
    for key in object_keys(client, bucket):
        pending.append({"Key": key})
        if len(pending) == 1000:
            response = client.delete_objects(Bucket=bucket, Delete={"Objects": pending, "Quiet": True})
            if response.get("Errors"):
                raise RuntimeError(f"Failed to clear MinIO bucket {bucket!r}: {response['Errors']}")
            pending.clear()
    if pending:
        response = client.delete_objects(Bucket=bucket, Delete={"Objects": pending, "Quiet": True})
        if response.get("Errors"):
            raise RuntimeError(f"Failed to clear MinIO bucket {bucket!r}: {response['Errors']}")


def restore(directory: Path) -> None:
    directory = directory.resolve()
    if not directory.is_dir():
        raise ValueError(f"MinIO fixture directory does not exist: {directory}")
    files = sorted(path for path in directory.rglob("*") if path.is_file() and path.name != MANIFEST)
    if not files:
        raise ValueError(f"MinIO fixture directory is empty: {directory}")
    if any(path.is_symlink() for path in directory.rglob("*")):
        raise ValueError("MinIO fixture must not contain symbolic links")

    manifest_path = directory / MANIFEST
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    content_types = manifest.get("content_types", {})
    client, bucket = client_and_bucket()
    ensure_bucket(client, bucket)
    clear_bucket(client, bucket)

    for path in files:
        key = path.relative_to(directory).as_posix()
        if key in content_types:
            client.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": content_types[key]})
        else:
            client.upload_file(str(path), bucket, key)
    print(f"Restored {len(files)} objects to bucket {bucket!r} from {directory}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("dump", "restore"))
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    (dump if args.mode == "dump" else restore)(args.directory)


if __name__ == "__main__":
    main()
