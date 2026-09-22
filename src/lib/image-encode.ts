"use client";

// A picture made ready in the page before it goes to /api/upload.
//
// Phone photos and screenshots arrive at 4000 px and several megabytes; the
// table draws them at a fraction of that. So the file is drawn onto a
// canvas at no more than 1536 px on the long edge and encoded as WebP,
// which every WebView and browser this app runs in can write and which
// keeps transparency. An engine that cannot write WebP (toBlob hands back
// a PNG instead) gets JPEG, or PNG when the source may carry an alpha
// channel, and the server keeps accepting all three for older clients.
//
// Nothing is ever made worse: a picture already under the size cap is not
// scaled up, an existing WebP is sent as it is, and when the re-encode
// would come out bigger than the original the original goes instead. A
// file the browser cannot decode at all goes through untouched for the
// server to judge.

export const UPLOAD_MAX_EDGE = 1536;
export const UPLOAD_QUALITY = 0.85;

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export type EncodedImage = {
  dataUrl: string;
  type: string;
  width: number;
  height: number;
};

export function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const release = () => {
      if (typeof source !== "string") {
        URL.revokeObjectURL(url);
      }
    };
    const image = new Image();
    image.onload = () => {
      release();
      resolve(image);
    };
    image.onerror = () => {
      release();
      reject(new Error("That file is not a picture this browser can read."));
    };
    image.src = url;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: ImageMime, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

// WebP where the engine writes it; otherwise JPEG, or PNG when the picture
// may be transparent and losing that would show.
export async function exportCanvas(
  canvas: HTMLCanvasElement,
  options: { quality?: number; keepAlpha?: boolean } = {},
): Promise<{ blob: Blob; type: ImageMime }> {
  const quality = options.quality ?? UPLOAD_QUALITY;
  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") {
    return { blob: webp, type: "image/webp" };
  }
  const type: ImageMime = options.keepAlpha ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(canvas, type, quality);
  if (!blob) {
    throw new Error("This browser cannot encode pictures.");
  }
  return { blob, type };
}

function describe(source: Blob | string): { type: string; bytes: number } {
  if (typeof source === "string") {
    const comma = source.indexOf(",");
    const header = source.slice(5, source.indexOf(";") > 0 ? source.indexOf(";") : comma);
    return { type: header, bytes: Math.floor((source.length - comma - 1) * 0.75) };
  }
  return { type: source.type, bytes: source.size };
}

async function passthrough(source: Blob | string, type: string, width: number, height: number): Promise<EncodedImage> {
  return {
    dataUrl: typeof source === "string" ? source : await blobToDataUrl(source),
    type,
    width,
    height,
  };
}

export async function encodeImageForUpload(
  source: Blob | string,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<EncodedImage> {
  const maxEdge = options.maxEdge ?? UPLOAD_MAX_EDGE;
  const original = describe(source);
  let image: HTMLImageElement;
  try {
    image = await loadImage(source);
  } catch {
    return passthrough(source, original.type, 0, 0);
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) {
    return passthrough(source, original.type, 0, 0);
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (scale === 1 && original.type === "image/webp") {
    return passthrough(source, original.type, width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    return passthrough(source, original.type, width, height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { blob, type } = await exportCanvas(canvas, {
    quality: options.quality ?? UPLOAD_QUALITY,
    keepAlpha: original.type === "image/png",
  });
  if (scale === 1 && blob.size >= original.bytes) {
    return passthrough(source, original.type, width, height);
  }
  return { dataUrl: await blobToDataUrl(blob), type, width: canvas.width, height: canvas.height };
}
