// What a picture file is, and how its smaller copies are named and asked
// for. Pure: no Node imports beyond Buffer, no "@/" imports, so the same
// module serves the page components, the serve routes, the variant writer
// and the test scripts.
//
// Generated and uploaded pictures are saved at full size under the path the
// campaign data stores (/generated/<name>.png, /uploads/<id>.jpg). Beside
// each one the server writes WebP copies at 256 and 1024 px on the long
// edge, named <stem>.w256.webp and <stem>.w1024.webp. Nothing ever stores a
// variant path (src/lib/uploads.ts refuses dotted names); a client asks for
// the size it needs with ?w= and the serve route answers with the variant
// when it exists, else the original.

export const VARIANT_WIDTHS = [256, 1024] as const;
export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

const VARIANT_ROOTS = ["/generated/", "/uploads/"];
const VARIANT_NAME = /\.w(256|1024)\.webp$/i;

export type ImageFormat = "png" | "jpeg" | "webp";

// Magic bytes, not a declared type: nothing that hands the server a picture
// is trusted to name what it wrote.
export function sniffImage(bytes: Buffer): { mime: string; ext: string; format: ImageFormat } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png", format: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg", format: "jpeg" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", ext: "webp", format: "webp" };
  }
  return null;
}

// Width and height from the header, so a picture is sized honestly without
// a decoder. Returns 0x0 when the header is not one we read.
export function imageSize(bytes: Buffer): { width: number; height: number } {
  const kind = sniffImage(bytes);
  if (kind?.format === "png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (kind?.format === "jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        break;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  if (kind?.format === "webp" && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    }
    if (chunk === "VP8 ") {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L") {
      // Lossless: 14 bits each, packed after the 0x2f signature byte.
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  }
  return { width: 0, height: 0 };
}

// The ?w= value a serve route accepts. Anything but the two sizes the
// server writes means the original.
export function variantWidth(value: string | null | undefined): VariantWidth | null {
  const parsed = Number(value);
  return (VARIANT_WIDTHS as readonly number[]).includes(parsed) ? (parsed as VariantWidth) : null;
}

// The sibling file for one size: the original's stem plus .w<width>.webp.
export function variantFileName(fileName: string, width: VariantWidth): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem}.w${width}.webp`;
}

// Whether a file in public/generated or public/uploads is one of the
// server's own copies rather than an original (the backfill skips these).
export function isVariantFileName(fileName: string): boolean {
  return VARIANT_NAME.test(fileName);
}

// A picture address with the size a consumer wants. Only the server's own
// generated and uploaded pictures have variants, so anything else (data:,
// blob:, built-in art, another origin, an address that already carries a
// query) comes back untouched. The form is a query, never a path suffix,
// because the apps route these to the host by path prefix and pass the
// query through.
export function variantUrl(src: string, width: VariantWidth): string {
  if (!VARIANT_ROOTS.some((root) => src.startsWith(root))) {
    return src;
  }
  if (src.includes("?") || src.includes("#")) {
    return src;
  }
  return `${src}?w=${width}`;
}
