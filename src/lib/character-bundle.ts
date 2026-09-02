// The portable character file: one JSON document a player can download from
// one server and hand to another, or keep as a backup. It carries the same
// CreateSheetInput the builder saves, plus the portrait inlined as a data
// URL so the picture survives the trip (a bare /uploads/ path means nothing
// on a different host).
//
// Pure: schema, size arithmetic and the two directions of the format. The
// disk is reached only through the reader and writer the routes pass in,
// which is what lets scripts/test-character-bundle.mjs drive the whole
// thing without a filesystem or a database.
import { z } from "zod";
import { createSheetSchema, type CreateSheetInput, type SheetAttachment } from "@/lib/schemas/sheet";
import { isUploadedImagePath } from "@/lib/uploads";

export const CHARACTER_BUNDLE_KIND = "odm.character";
export const CHARACTER_BUNDLE_VERSION = 1;

// Same binary cap as /api/upload (src/lib/uploads-store.ts): nothing may
// arrive inside a bundle that could not have been uploaded by hand.
export const MAX_BUNDLE_PORTRAIT_BYTES = 8 * 1024 * 1024;

// The whole document. A sheet is a few kilobytes; the budget is the portrait
// plus base64 overhead with room to spare.
export const MAX_BUNDLE_BYTES = 12 * 1024 * 1024;

// A little over MAX_BUNDLE_PORTRAIT_BYTES * 4/3: base64 overhead plus header.
const MAX_PORTRAIT_DATA_URL_CHARS = 11_300_000;

const PORTRAIT_DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/;

export const PORTRAIT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type PortraitType = (typeof PORTRAIT_TYPES)[number];

// Decoded byte count of a base64 payload, from its length alone, so the cap
// can be checked before anything is allocated.
export function decodedBase64Bytes(encoded: string): number {
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

export function dataUrlBytes(dataUrl: string): number {
  const match = dataUrl.match(PORTRAIT_DATA_URL);
  return match ? decodedBase64Bytes(match[2]) : 0;
}

const bundlePortraitSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(PORTRAIT_TYPES),
    dataUrl: z
      .string()
      .max(MAX_PORTRAIT_DATA_URL_CHARS, "Portrait is larger than 8MB.")
      .regex(PORTRAIT_DATA_URL, "Portrait must be a PNG, JPEG or WebP data URL."),
  })
  .refine((portrait) => portrait.dataUrl.startsWith(`data:${portrait.type};`), {
    message: "Portrait type does not match its data.",
  })
  .refine(
    (portrait) => {
      const bytes = dataUrlBytes(portrait.dataUrl);
      return bytes > 0 && bytes <= MAX_BUNDLE_PORTRAIT_BYTES;
    },
    { message: "Portrait is empty or larger than 8MB." },
  );

export const characterBundleSchema = z.object({
  kind: z.literal(CHARACTER_BUNDLE_KIND),
  version: z.literal(CHARACTER_BUNDLE_VERSION),
  exportedAt: z.string().max(40),
  name: z.string().trim().min(1).max(60),
  level: z.number().int().min(1).max(20),
  sheet: createSheetSchema,
  portrait: bundlePortraitSchema.optional(),
});
export type CharacterBundle = z.infer<typeof characterBundleSchema>;
export type BundlePortrait = NonNullable<CharacterBundle["portrait"]>;

// What the export route reads off disk for us: the bytes behind a
// /uploads/ path, or null when the file is gone.
export type PortraitReader = (
  url: string,
) => Promise<{ bytes: Uint8Array; type: PortraitType } | null>;

// What the import route writes for us: bytes into public/uploads under a
// name of its own choosing.
export type PortraitWriter = (
  bytes: Uint8Array,
  type: PortraitType,
) => Promise<{ id: string; url: string }>;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, "base64"));
}

// Export direction. The stored portrait path is only consulted when it has
// the exact shape this app writes; anything else is dropped rather than
// read, so a tampered row can never turn the export into a file reader.
export async function buildCharacterBundle(
  character: { name: string; level: number; sheet: CreateSheetInput },
  readPortrait: PortraitReader,
  now: Date = new Date(),
): Promise<CharacterBundle> {
  const sheet: CreateSheetInput = { ...character.sheet, portrait: null };
  const bundle: CharacterBundle = {
    kind: CHARACTER_BUNDLE_KIND,
    version: CHARACTER_BUNDLE_VERSION,
    exportedAt: now.toISOString(),
    name: character.name,
    level: character.level,
    sheet,
  };
  const stored = character.sheet.portrait;
  if (stored && isUploadedImagePath(stored.url)) {
    const file = await readPortrait(stored.url);
    if (file && file.bytes.length > 0 && file.bytes.length <= MAX_BUNDLE_PORTRAIT_BYTES) {
      bundle.portrait = {
        name: stored.name?.trim() || `${character.name} portrait`,
        type: file.type,
        dataUrl: `data:${file.type};base64,${toBase64(file.bytes)}`,
      };
    }
  }
  return bundle;
}

export type ParsedBundle = { ok: true; bundle: CharacterBundle } | { ok: false; error: string };

// Import direction, step one: is this a character file we accept? The size
// is judged first so an oversized document is refused by its length, not
// by exhausting memory proving it malformed.
export function parseCharacterBundle(raw: unknown, byteLength?: number): ParsedBundle {
  if (byteLength !== undefined && byteLength > MAX_BUNDLE_BYTES) {
    return { ok: false, error: "Character file is larger than 12MB." };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Not a character file." };
  }
  const record = raw as Record<string, unknown>;
  if (record.kind !== CHARACTER_BUNDLE_KIND) {
    return { ok: false, error: "Not an Open Dungeon Master character file." };
  }
  if (record.version !== CHARACTER_BUNDLE_VERSION) {
    return { ok: false, error: `Unsupported character file version (${String(record.version)}).` };
  }
  const parsed = characterBundleSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${where}${issue?.message || "Invalid character file."}` };
  }
  return { ok: true, bundle: parsed.data };
}

export type UnpackedBundle = {
  level: number;
  sheet: CreateSheetInput;
  // True when the file brought its own picture, so the caller knows not to
  // queue a painted one.
  carriedPortrait: boolean;
};

// Import direction, step two: the inlined portrait becomes a fresh file in
// public/uploads and the sheet points at that; whatever path the sheet
// carried from its old home is discarded.
export async function unpackCharacterBundle(
  bundle: CharacterBundle,
  writePortrait: PortraitWriter,
): Promise<UnpackedBundle> {
  let portrait: SheetAttachment | null = null;
  if (bundle.portrait) {
    const match = bundle.portrait.dataUrl.match(PORTRAIT_DATA_URL);
    const bytes = fromBase64(match?.[2] ?? "");
    if (bytes.length > 0 && bytes.length <= MAX_BUNDLE_PORTRAIT_BYTES) {
      const written = await writePortrait(bytes, bundle.portrait.type);
      portrait = {
        id: written.id,
        name: bundle.portrait.name,
        type: bundle.portrait.type,
        url: written.url,
      };
    }
  }
  return {
    level: bundle.level,
    sheet: { ...bundle.sheet, name: bundle.sheet.name || bundle.name, portrait },
    carriedPortrait: portrait !== null,
  };
}

// Download name for an exported bundle.
export function characterBundleFilename(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "character";
  return `${slug}.odm-character.json`;
}
