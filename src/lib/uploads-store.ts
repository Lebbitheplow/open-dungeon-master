// The disk half of uploads: writing bytes into public/uploads under a fresh
// uuid, and reading one of our own files back. src/lib/uploads.ts stays a
// pure path check because client bundles import it through the battlemap
// backdrop; this module is Node-only and is what /api/upload and the
// character export/import routes call.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isUploadedImagePath } from "@/lib/uploads";

// The one size cap for anything that lands in public/uploads, whether it
// arrives by upload form or inside a character bundle.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

export function isUploadMimeType(value: unknown): value is UploadMimeType {
  return (UPLOAD_MIME_TYPES as readonly unknown[]).includes(value);
}

export function uploadExtension(type: UploadMimeType): "png" | "jpg" | "webp" {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

function mimeForExtension(extension: string): UploadMimeType {
  return extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
}

function uploadsDir(): string {
  return path.join(process.cwd(), "public", "uploads");
}

// Names the file itself, so every stored path has the shape
// isUploadedImagePath accepts. Callers validate size and type first.
export async function writeUploadedImage(
  bytes: Uint8Array,
  type: UploadMimeType,
): Promise<{ id: string; url: string }> {
  const id = crypto.randomUUID();
  const filename = `${id}.${uploadExtension(type)}`;
  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return { id, url: `/uploads/${filename}` };
}

// Reads back a file this app wrote. Anything that is not a /uploads/<id>.<ext>
// path is refused before the filesystem is consulted, which is the whole
// traversal guard: the path never reaches path.join unless it already
// matches the shape we generate.
export async function readUploadedImage(
  url: unknown,
): Promise<{ bytes: Buffer; type: UploadMimeType } | null> {
  if (!isUploadedImagePath(url)) {
    return null;
  }
  const filename = url.slice("/uploads/".length);
  const extension = filename.split(".").pop() ?? "";
  try {
    const bytes = await readFile(path.join(uploadsDir(), filename));
    return { bytes, type: mimeForExtension(extension === "jpeg" ? "jpg" : extension) };
  } catch {
    return null;
  }
}
