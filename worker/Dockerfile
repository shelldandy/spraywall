FROM python:3.12-slim

WORKDIR /app

# Install system deps for OpenCV (needed by ultralytics)
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libheif-dev && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
ARG INSTALL_SAM=false
ARG INSTALL_MODAL=false
RUN pip install --no-cache-dir . && \
    if [ "$INSTALL_SAM" = "true" ]; then pip install --no-cache-dir ".[sam]"; fi && \
    if [ "$INSTALL_MODAL" = "true" ]; then pip install --no-cache-dir ".[modal]"; fi

COPY . .

RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
