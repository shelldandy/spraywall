#!/usr/bin/env bash
# Regenerate every web icon from the source artwork at the repo root.
#
# Usage: npm run icons   (or: bash scripts/generate-icons.sh)
#
# The Docker build context is web/, so the root icon.png is not available at
# build time. Generated files are committed to web/public/ and served as-is.
# icon.svg stays at the repo root as source art only; the 650 KB trace is far
# too heavy for a favicon or an in-app logo, so everything here is a PNG.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
SRC="${1:-$WEB_DIR/../icon.png}"
OUT="$WEB_DIR/public"
# Matches --bg in src/index.css. The web app is dark-only, so flattened icons
# blend with it instead of showing a white ring on the home screen.
BG='#21182f'

if ! command -v magick >/dev/null 2>&1; then
  echo "error: ImageMagick ('magick') is required" >&2
  exit 1
fi

if [[ ! -f "$SRC" ]]; then
  echo "error: source icon not found: $SRC" >&2
  exit 1
fi

mkdir -p "$OUT"

# Keep the alpha channel: these are composited by the browser on any background.
resize() {
  local size=$1 dest=$2
  magick "$SRC" -filter Lanczos -resize "${size}x${size}" \
    -define png:compression-level=9 -strip "$OUT/$dest"
}

# Crop inside the artwork's opaque bounds so iOS's own mask hides its corners.
fullbleed() {
  local size=$1 dest=$2
  magick "$SRC" -gravity center -crop 1080x1080+0+0 +repage \
    -filter Lanczos -resize "${size}x${size}" \
    -background "$BG" -alpha remove -alpha off \
    -define png:compression-level=9 -strip "$OUT/$dest"
}

# Flatten onto the app background and centre the art at `pct` of the canvas.
# Android crops maskable icons to a shape, so they cannot keep an alpha channel.
flatten() {
  local size=$1 pct=$2 dest=$3
  local art=$(( size * pct / 100 ))
  magick "$SRC" -filter Lanczos -resize "${art}x${art}" \
    -background "$BG" -gravity center -extent "${size}x${size}" \
    -alpha remove -alpha off -define png:compression-level=9 -strip "$OUT/$dest"
}

echo "Generating icons from $SRC"

# Browser tab + crawlers that still request /favicon.ico directly.
resize 48 favicon.png
magick "$SRC" -filter Lanczos -define icon:auto-resize=48,32,16 \
  -define png:compression-level=9 -strip "$OUT/favicon.ico"

# PWA icons with purpose "any".
resize 192 pwa-192x192.png
resize 512 pwa-512x512.png

# iOS masks corners itself; fill the tile edge-to-edge.
fullbleed 180 apple-touch-icon.png

# Android adaptive icons crop to a circle/squircle; keep the art inside the
# central 80% safe zone.
flatten 512 70 maskable-512x512.png

# In-app logo (1x and 2x), transparent so it works on either theme.
resize 128 logo-128.png
resize 256 logo-256.png

echo "Wrote:"
file "$OUT"/favicon.png "$OUT"/favicon.ico "$OUT"/pwa-192x192.png \
  "$OUT"/pwa-512x512.png "$OUT"/apple-touch-icon.png \
  "$OUT"/maskable-512x512.png "$OUT"/logo-128.png "$OUT"/logo-256.png
