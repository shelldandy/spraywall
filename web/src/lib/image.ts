const MAX_DIMENSION = 4096;
const JPEG_QUALITY = 0.85;

/**
 * Re-encode a picked photo as a JPEG no larger than MAX_DIMENSION on its longest side,
 * so full-resolution phone photos stay under the server's upload limit.
 * Falls back to the original file if the browser can't decode it (e.g. HEIC outside Safari);
 * the server converts HEIC itself.
 */
export async function prepareImageForUpload(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    // Keep the original if re-encoding failed or somehow made it bigger.
    return blob && blob.size < file.size ? blob : file;
  } finally {
    bitmap.close();
  }
}
