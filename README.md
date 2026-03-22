# Spraywall

AI-assisted spray wall route setting and climbing app.

## Prerequisites

- Docker & Docker Compose
- Node.js ≥ 18 (for Expo)
- Go ≥ 1.22 (optional, for local dev outside Docker)

## Quick Start

```bash
# Clone and configure
git clone https://github.com/bowlinedandy/spraywall.git
cd spraywall
cp .env.example .env

# Start backend services (Postgres, MinIO, Go server, Python worker)
make dev

# In another terminal — start the Expo app
make expo
```

## Services (dev)

| Service  | URL                    |
| -------- | ---------------------- |
| Server   | http://localhost:8080   |
| Postgres | localhost:5433         |
| MinIO    | http://localhost:9000   |
| MinIO UI | http://localhost:9001   |
| Expo     | http://localhost:8081   |

## Useful Commands

| Command         | Description                                      |
| --------------- | ------------------------------------------------ |
| `make dev`      | Start all backend services (SAM enabled)         |
| `make expo`     | Start Expo dev server                            |
| `make migrate`  | Run database migrations                          |
| `make sqlc`     | Generate Go code from SQL queries                |
| `make apiclient`| Generate TypeScript API client types             |
| `make lint`     | Run Go, TypeScript, and Python linters           |
| `make test`     | Run Go and Python tests                          |
| `make clean`    | Stop services and remove volumes                 |

> **Note:** `docker compose down -v` (or `make clean`) is required to re-run `infra/postgres/init.sql`.

## SAM Segmentation

Hold detection uses YOLOv8 for bounding boxes and [Segment Anything Model (SAM)](https://github.com/facebookresearch/segment-anything) to refine each box into a polygon outline.

### Setup

Download a SAM checkpoint into the worker models directory:

```bash
wget -P worker/models https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
```

The worker installs `segment-anything` automatically. Upload a new wall image to trigger detection with polygon output.

### How it works

- After YOLOv8 detects bounding boxes, SAM refines each box into a polygon mask
- OpenCV post-processing (erode/dilate/contour/simplify) cleans the masks
- Polygons are stored in the `holds.polygon` column and rendered as SVG polygons in the app
- Holds without polygon data fall back to rectangle rendering

### Environment variables

| Variable         | Default                              | Description              |
| ---------------- | ------------------------------------ | ------------------------ |
| `SAM_ENABLED`    | `false`                              | Enable SAM segmentation  |
| `SAM_MODEL_TYPE` | `vit_b`                              | SAM model variant        |
| `SAM_CHECKPOINT` | `./models/sam_vit_b_01ec64.pth`      | Path to checkpoint file  |
