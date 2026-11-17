export interface CameraFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function getContainedFrame(
  containerWidth: number,
  containerHeight: number,
  aspect: number,
): CameraFrame {
  if (containerWidth <= 0 || containerHeight <= 0 || !Number.isFinite(aspect) || aspect <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const containerAspect = containerWidth / containerHeight;
  const width = containerAspect > aspect ? containerHeight * aspect : containerWidth;
  const height = containerAspect > aspect ? containerHeight : containerWidth / aspect;
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function cropToAspect(width: number, height: number, aspect: number): CameraFrame {
  if (width <= 0 || height <= 0 || !Number.isFinite(aspect) || aspect <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  if (Math.abs((width / height) / aspect - 1) <= 0.01) {
    return { left: 0, top: 0, width, height };
  }

  if (width / height > aspect) {
    const cropWidth = height * aspect;
    return { left: (width - cropWidth) / 2, top: 0, width: cropWidth, height };
  }

  const cropHeight = width / aspect;
  return { left: 0, top: (height - cropHeight) / 2, width, height: cropHeight };
}

export function streamSize(longSide: number) {
  return {
    width: { ideal: longSide },
    height: { ideal: longSide * 3 / 4 },
    resizeMode: { ideal: "none" },
  };
}
