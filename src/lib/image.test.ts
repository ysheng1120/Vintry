import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_MAX_EDGE,
  ImageError,
  prepareLabelImage,
  scaledSize,
  THUMBNAIL_EDGE,
  UNSUPPORTED_IMAGE_MESSAGE,
} from "./image";

describe("scaledSize", () => {
  it("shrinks a landscape photo so the long edge is the limit", () => {
    expect(scaledSize(4000, 3000, 1568)).toEqual({ width: 1568, height: 1176 });
    expect(scaledSize(4000, 3000, 256)).toEqual({ width: 256, height: 192 });
  });

  it("shrinks a portrait photo by its height", () => {
    expect(scaledSize(3000, 4000, 1568)).toEqual({ width: 1176, height: 1568 });
  });

  it("never enlarges a small photo", () => {
    expect(scaledSize(800, 600, 1568)).toEqual({ width: 800, height: 600 });
  });
});

// jsdom has no image decoder or canvas: stand in for both and record what gets encoded.
interface Encoded {
  width: number;
  height: number;
  type: string | undefined;
  quality: unknown;
}

let encoded: Encoded[];

function installCanvasFake(bitmap: { width: number; height: number }) {
  encoded = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ ...bitmap, close: () => {} })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage: () => {} }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
    this: HTMLCanvasElement,
    type?: string,
    quality?: unknown,
  ) {
    encoded.push({ width: this.width, height: this.height, type, quality });
    return `data:image/jpeg;base64,${btoa(`${this.width}x${this.height}`)}`;
  });
}

describe("prepareLabelImage", () => {
  beforeEach(() => installCanvasFake({ width: 4000, height: 3000 }));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("turns a 4000 × 3000 photo into a 1568 px JPEG and a 256 px thumbnail", async () => {
    const image = await prepareLabelImage(new Blob(["x"], { type: "image/jpeg" }));

    expect(image.mediaType).toBe("image/jpeg");
    expect({ width: image.width, height: image.height }).toEqual({ width: 1568, height: 1176 });
    expect(atob(image.base64)).toBe("1568x1176");
    expect(image.thumbnail).toBe(`data:image/jpeg;base64,${btoa("256x192")}`);
    expect(Math.max(image.width, image.height)).toBe(IMAGE_MAX_EDGE);
    expect(encoded).toContainEqual({
      width: 1568,
      height: 1176,
      type: "image/jpeg",
      quality: 0.85,
    });
    expect(encoded.some((e) => Math.max(e.width, e.height) === THUMBNAIL_EDGE)).toBe(true);
  });

  it("decodes with the photo's own orientation", async () => {
    await prepareLabelImage(new Blob(["x"], { type: "image/jpeg" }));
    expect(createImageBitmap).toHaveBeenCalledWith(expect.anything(), {
      imageOrientation: "from-image",
    });
  });

  it("explains when the browser cannot decode the photo", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new DOMException("The source image could not be decoded.", "InvalidStateError");
      }),
    );
    const result = prepareLabelImage(new Blob(["heic"], { type: "image/heic" }));
    await expect(result).rejects.toBeInstanceOf(ImageError);
    await expect(result).rejects.toThrow(
      "This photo format isn't supported here. Try the camera button or a JPEG.",
    );
    expect(UNSUPPORTED_IMAGE_MESSAGE).toBe(
      "This photo format isn't supported here. Try the camera button or a JPEG.",
    );
  });

  it("gives the same message when the browser has no image decoder", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(prepareLabelImage(new Blob(["x"]))).rejects.toThrow(UNSUPPORTED_IMAGE_MESSAGE);
  });
});
