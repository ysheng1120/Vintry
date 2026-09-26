/**
 * Label photos are shrunk before they go to Claude (KTD14): decoded with the photo's own
 * orientation, scaled so the long edge is at most 1568 px, and re-encoded as JPEG 0.85.
 * A 256 px thumbnail is kept with the wine.
 */

export const IMAGE_MAX_EDGE = 1568;
export const THUMBNAIL_EDGE = 256;
export const JPEG_QUALITY = 0.85;

export const UNSUPPORTED_IMAGE_MESSAGE =
  "This photo format isn't supported here. Try the camera button or a JPEG.";

/** A photo the browser could not decode or re-encode. The message is shown as is. */
export class ImageError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(UNSUPPORTED_IMAGE_MESSAGE, options);
    this.name = "ImageError";
  }
}

export interface PreparedImage {
  /** JPEG bytes as base64 (no data-URL prefix), ready for the API. */
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  /** Small JPEG as a data URL, stored on the wine. */
  thumbnail: string;
}

/** The size that fits `maxEdge` on the long side, keeping the shape. Never enlarges. */
export function scaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function encodeJpeg(
  bitmap: ImageBitmap,
  maxEdge: number,
): { dataUrl: string; width: number; height: number } {
  const size = scaledSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageError();
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (!dataUrl.startsWith("data:image/jpeg;base64,")) throw new ImageError();
  return { dataUrl, ...size };
}

/**
 * Prepares a label photo (a file, or the current frame of the camera preview) for scanning.
 * Throws ImageError with a plain message when the browser cannot read it (for example HEIC).
 */
export async function prepareLabelImage(source: Blob | HTMLVideoElement): Promise<PreparedImage> {
  if (typeof createImageBitmap !== "function") throw new ImageError();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch (cause) {
    throw new ImageError({ cause });
  }
  try {
    const full = encodeJpeg(bitmap, IMAGE_MAX_EDGE);
    const thumbnail = encodeJpeg(bitmap, THUMBNAIL_EDGE);
    return {
      base64: full.dataUrl.slice(full.dataUrl.indexOf(",") + 1),
      mediaType: "image/jpeg",
      width: full.width,
      height: full.height,
      thumbnail: thumbnail.dataUrl,
    };
  } catch (cause) {
    throw cause instanceof ImageError ? cause : new ImageError({ cause });
  } finally {
    bitmap.close();
  }
}
