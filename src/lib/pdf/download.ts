// Browser-side trigger: build the fillable character-sheet PDF and hand it to
// the user as a download. Kept apart from the builder so the pdf-lib layout
// stays environment-agnostic while this half touches the DOM.

import { downloadBlob, filenameSlug } from "@/lib/download";
import { buildCharacterSheetPdf, type PdfCharacter } from "./character-sheet-pdf";

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// pdf-lib embeds PNG and JPEG only, and AvatarCropDialog saves WebP, so an
// uploaded portrait has to be redrawn through a canvas before it can travel
// in the sheet. Same-origin upload, so the canvas is never tainted.
async function transcodeToPng(blob: Blob): Promise<Uint8Array | undefined> {
  const source = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Portrait could not be decoded."));
      element.src = source;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png ? new Uint8Array(await png.arrayBuffer()) : undefined;
  } finally {
    URL.revokeObjectURL(source);
  }
}

// Fetches the portrait with the session cookie and returns bytes the
// builder can embed, or undefined when there is nothing usable. A portrait
// is optional, so every failure here means "blank box", never a thrown error.
async function portraitBytes(url: string | null | undefined): Promise<Uint8Array | undefined> {
  if (!url) {
    return undefined;
  }
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      return undefined;
    }
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (isPng(bytes) || isJpeg(bytes)) {
      return bytes;
    }
    return await transcodeToPng(blob);
  } catch {
    return undefined;
  }
}

export async function downloadCharacterSheetPdf(character: PdfCharacter): Promise<void> {
  const bytes = await buildCharacterSheetPdf(character, {
    portraitBytes: await portraitBytes(character.portrait?.url),
  });
  // Copy into a fresh ArrayBuffer so the Blob never sees a SharedArrayBuffer-backed view.
  const blob = new Blob([bytes.slice()], { type: "application/pdf" });
  downloadBlob(`${filenameSlug(character.name)}-character-sheet.pdf`, blob);
}
