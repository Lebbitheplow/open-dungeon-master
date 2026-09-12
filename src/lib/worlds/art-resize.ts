"use client";

import { MAX_PACK_ART_BYTES, PACK_ART_ASPECT, type PackArtKind } from "@/lib/worlds/art";

// A picture a person chose, made into pack art in the browser.
//
// Pack art has a shape (256 px squares, 704x400 landscapes, the same sizes
// as the placeholder plates) and a weight (256 KB a picture). A phone photo
// is neither, so rather than upload it and refuse it, the file is drawn
// onto a canvas at the slot's size, cropped to cover, and encoded as WebP
// at a quality that fits under the cap. The result is a data URL the draft
// stores directly: no /api/upload round trip, nothing on disk until the
// pack is installed.
//
// Works the same in the desktop and Android shells, which render these
// pages in a WebView with canvas and WebP encoding; a browser that cannot
// encode WebP (toDataURL answers with PNG) falls back to JPEG, which every
// engine writes and the pack schema accepts.

export const ART_SIZES: Record<"square" | "landscape", { width: number; height: number }> = {
  square: { width: 256, height: 256 },
  landscape: { width: 704, height: 400 },
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a picture this browser can read."));
    };
    image.src = url;
  });
}

function dataUrlBytes(dataUrl: string): number {
  return Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
}

function encode(canvas: HTMLCanvasElement, mime: "image/webp" | "image/jpeg", quality: number): string {
  return canvas.toDataURL(mime, quality);
}

export async function resizePackArt(file: File, kind: PackArtKind): Promise<string> {
  const image = await loadImage(file);
  const { width, height } = ART_SIZES[PACK_ART_ASPECT[kind]];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser cannot draw pictures.");
  }
  // Cover: scale so the shorter side fills, then centre the overflow.
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  const webp = encode(canvas, "image/webp", 0.82);
  const mime: "image/webp" | "image/jpeg" = webp.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
  let quality = 0.82;
  let out = mime === "image/webp" ? webp : encode(canvas, mime, quality);
  // At these sizes the first encode is usually a tenth of the cap; the loop
  // is for a noisy photo that is not.
  while (dataUrlBytes(out) > MAX_PACK_ART_BYTES && quality > 0.3) {
    quality -= 0.12;
    out = encode(canvas, mime, quality);
  }
  if (dataUrlBytes(out) > MAX_PACK_ART_BYTES) {
    throw new Error("That picture would not fit under the pack's size cap even at low quality.");
  }
  return out;
}
