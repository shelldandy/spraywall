#!/bin/sh
set -e

echo "Waiting for MinIO to be ready..."
until mc alias set local http://minio:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" 2>/dev/null; do
  sleep 1
done

echo "Creating bucket..."
mc mb --ignore-existing local/spraywall

echo "MinIO bootstrap complete."
