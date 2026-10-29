FROM python:3.12-slim

WORKDIR /app

# Install system deps for OpenCV (needed by ultralytics)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 libheif-dev && \
    rm -rf /var/lib/apt/lists/*

# "cpu" installs CPU-only torch wheels (much smaller image); "cuda" uses the default PyPI build.
ARG TORCH_VARIANT=cpu
RUN if [ "$TORCH_VARIANT" = "cpu" ]; then \
        pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu; \
    fi

COPY pyproject.toml .
ARG INSTALL_SAM=true
ARG INSTALL_MODAL=false
RUN pip install --no-cache-dir . && \
    if [ "$INSTALL_SAM" = "true" ]; then SAM2_BUILD_CUDA=0 pip install --no-cache-dir ".[sam]"; fi && \
    if [ "$INSTALL_MODAL" = "true" ]; then pip install --no-cache-dir ".[modal]"; fi

# Bake the detection model into the image so first start works offline.
RUN python -c "\
from huggingface_hub import hf_hub_download; \
hf_hub_download(repo_id='jwlarocque/yolov8n-freeclimbs-detect-2', \
filename='yolov8n-freeclimbs-detect-2.pt', local_dir='/app/models')"

# SAM builds also bake the checkpoint (models/ is excluded from the build context).
RUN if [ "$INSTALL_SAM" = "true" ]; then \
        python -c "from huggingface_hub import hf_hub_download; \
 hf_hub_download(repo_id='facebook/sam2.1-hiera-small', \
 filename='sam2.1_hiera_small.pt', local_dir='/app/models')"; \
    fi

COPY . .

RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
