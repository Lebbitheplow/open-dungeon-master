import { z } from "zod";
import { TERRAIN } from "@/lib/battlemap/types";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import { BACKDROP_LIMITS } from "@/lib/battlemap/backdrop";
import { viewDataProblem } from "@/lib/addons/view-data";

// The contract of each extension point: the arguments the server sends an
// addon's MCP tool, and the result it accepts back (docs/addons/
// extension-points.md is the same thing in prose, with examples).
//
// A result is read from the tool's structuredContent, or from a text block
// holding JSON when an SDK cannot send structured content. Anything a result
// names on disk is a plain file name inside the call's outputDir; the server
// resolves it there and refuses anything that leaves the folder.
//
// Client-safe (zod and pure modules only), so a test or a future in-browser
// preview reads the same rules.

// What every call carries besides its own arguments.
export type HostInfo = {
  serverVersion: string;
  apiVersion: number;
  platform: string;
};

export type OptionValues = Record<string, string | number | boolean>;

// A file name in the call's outputDir: no folders, nothing hidden.
const outputFileSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/, "A plain file name inside outputDir, with no folders.");

const notesSchema = z.array(z.string().trim().max(300)).max(50).default([]);

// ---- workshop importers ----

export type ImporterArguments = {
  // The file the DM picked, already on this computer's disk.
  input: { path: string; name: string; mime: string; bytes: number };
  // An empty folder for anything the addon writes; removed after the import.
  outputDir: string;
  options: OptionValues;
  host: HostInfo;
};

// Inline bundles are capped well below a file's ceiling: a large bundle
// belongs in a file, which is read without holding the whole reply line in
// memory twice.
export const MAX_INLINE_BUNDLE_BYTES = 8 * 1024 * 1024;

export const importerResultSchema = z
  .object({
    // A workshop bundle (src/lib/workshop/bundle-schema.ts) written to
    // outputDir, or the same object inline. Exactly one.
    bundleFile: outputFileSchema.optional(),
    bundle: z.record(z.string(), z.unknown()).optional(),
    // Shown to the DM beside the preview: pages skipped, entries it was
    // unsure of, anything they should check by hand.
    notes: notesSchema,
  })
  .refine((value) => Boolean(value.bundleFile) !== Boolean(value.bundle), {
    message: "Return either bundleFile or bundle, not both and not neither.",
  });

// ---- map generators ----

// The library's own limits: the board renderer, fog and pathfinding are
// sized for maps up to this, the same ceiling a bundle allows.
export const ADDON_MAP_LIMITS = { minSide: 4, maxSide: 200, maxTiles: 200 * 200 } as const;

const TERRAIN_CHARS = new Set<string>(Object.values(TERRAIN));

export type MapRequest = {
  name: string;
  width: number;
  height: number;
  theme: (typeof MAP_THEMES)[number];
  ambient: "bright" | "dim" | "dark";
  // What the DM asked for in their own words ("a flooded crypt with two
  // ways in"). May be empty.
  summary: string;
  seed: number;
};

export type MapGeneratorArguments = {
  request: MapRequest;
  outputDir: string;
  options: OptionValues;
  host: HostInfo;
};

export const MAX_VIEW_FILES = 8;
export const MAX_VIEW_FILE_BYTES = 64 * 1024 * 1024;
// Pictures under the grid go through the upload pipeline's own cap.
export const MAX_BACKDROP_BYTES = 8 * 1024 * 1024;
export const VIEW_FILE_TYPES = {
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
} as const;

const lightSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  brightRadius: z.number().min(0).max(30),
  dimRadius: z.number().min(0).max(60),
});

export const mapResultSchema = z
  .object({
    map: z.object({
      name: z.string().trim().max(120).optional(),
      width: z.number().int().min(ADDON_MAP_LIMITS.minSide).max(ADDON_MAP_LIMITS.maxSide),
      height: z.number().int().min(ADDON_MAP_LIMITS.minSide).max(ADDON_MAP_LIMITS.maxSide),
      // One character per tile, row by row, from the terrain alphabet
      // (src/lib/battlemap/types.ts TERRAIN). This is what movement, sight
      // and cover read; everything else is how it looks.
      terrain: z.string().max(ADDON_MAP_LIMITS.maxTiles),
      theme: z.enum(MAP_THEMES as [string, ...string[]]).optional(),
      ambient: z.enum(["bright", "dim", "dark"]).optional(),
      outdoors: z.boolean().nullable().optional(),
      lights: z.array(lightSchema).max(200).default([]),
      notes: z.string().max(4_000).default(""),
      tags: z.array(z.string().trim().max(24)).max(8).default([]),
    }),
    // The picture under the grid, top-down, covering the whole map.
    backdrop: z
      .object({
        file: outputFileSchema,
        transform: z
          .object({
            offsetX: z.number().min(-BACKDROP_LIMITS.maxOffset).max(BACKDROP_LIMITS.maxOffset).default(0),
            offsetY: z.number().min(-BACKDROP_LIMITS.maxOffset).max(BACKDROP_LIMITS.maxOffset).default(0),
            scale: z.number().min(BACKDROP_LIMITS.minScale).max(BACKDROP_LIMITS.maxScale).default(1),
            opacity: z.number().min(0).max(1).default(1),
          })
          .optional(),
      })
      .optional(),
    // What this addon's board view draws from: free-form data (a scene
    // description, heights, camera hints) and files (a .glb model, textures).
    // Stored with the map, travels with it into play, and reaches only this
    // addon's board view.
    view: z
      .object({
        data: z.unknown().optional(),
        files: z.array(outputFileSchema).max(MAX_VIEW_FILES).default([]),
      })
      .optional(),
    notes: notesSchema,
  })
  .superRefine((value, context) => {
    const { width, height, terrain, lights } = value.map;
    if (terrain.length !== width * height) {
      context.addIssue({
        code: "custom",
        path: ["map", "terrain"],
        message: `The terrain has ${terrain.length} characters; a ${width} by ${height} map needs ${width * height}.`,
      });
      return;
    }
    for (let index = 0; index < terrain.length; index += 1) {
      if (!TERRAIN_CHARS.has(terrain[index])) {
        context.addIssue({
          code: "custom",
          path: ["map", "terrain"],
          message: `"${terrain[index]}" at tile ${index % width},${Math.floor(index / width)} is not a terrain character. Use ${[...TERRAIN_CHARS].join(" ")}.`,
        });
        return;
      }
    }
    for (const light of lights) {
      if (light.x >= width || light.y >= height) {
        context.addIssue({ code: "custom", path: ["map", "lights"], message: `A light at ${light.x},${light.y} is off the map.` });
        return;
      }
    }
    const dataProblem = value.view ? viewDataProblem(value.view.data) : null;
    if (dataProblem) {
      context.addIssue({ code: "custom", path: ["view", "data"], message: dataProblem });
      return;
    }
    for (const file of value.view?.files ?? []) {
      if (!viewFileType(file)) {
        context.addIssue({
          code: "custom",
          path: ["view", "files"],
          message: `${file}: a board view's files are ${Object.keys(VIEW_FILE_TYPES).join(", ")}.`,
        });
        return;
      }
    }
  });

export type MapResult = z.infer<typeof mapResultSchema>;

export function viewFileType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot).toLowerCase();
  return (VIEW_FILE_TYPES as Record<string, string>)[extension] ?? null;
}

// ---- reading a tool result ----

// An MCP tools/call result: structured content first, else the first text
// block parsed as JSON. isError results carry the addon's own message.
export function toolPayload(result: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const text = Array.isArray(record.content)
    ? (record.content as Array<Record<string, unknown>>).find((part) => part?.type === "text" && typeof part.text === "string")
    : undefined;
  if (record.isError === true) {
    const message = typeof text?.text === "string" ? text.text.trim() : "";
    return { ok: false, error: message ? message.slice(0, 600) : "The addon reported an error without saying what went wrong." };
  }
  if (record.structuredContent && typeof record.structuredContent === "object") {
    return { ok: true, value: record.structuredContent };
  }
  if (typeof text?.text === "string") {
    try {
      return { ok: true, value: JSON.parse(text.text) };
    } catch {
      return { ok: false, error: "The addon's reply was not JSON. Return structuredContent, or a text block holding JSON." };
    }
  }
  return { ok: false, error: "The addon returned nothing the server could read." };
}

// Option values held to the fields that asked for them: unknown keys
// dropped, every value coerced to its field's type and clamped, missing ones
// filled with the default. What reaches an addon is always what its manifest
// promised it.
export function normalizeOptionValues(
  fields: ReadonlyArray<
    | { key: string; type: "text" | "textarea"; default: string; maxLength: number }
    | { key: string; type: "number"; default: number; min: number; max: number }
    | { key: string; type: "boolean"; default: boolean }
    | { key: string; type: "select"; default: string; choices: ReadonlyArray<{ value: string }> }
  >,
  raw: unknown,
): OptionValues {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const values: OptionValues = {};
  for (const field of fields) {
    const value = input[field.key];
    if (field.type === "number") {
      const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
      values[field.key] = Number.isFinite(number) ? Math.min(field.max, Math.max(field.min, number)) : field.default;
    } else if (field.type === "boolean") {
      values[field.key] = typeof value === "boolean" ? value : field.default;
    } else if (field.type === "select") {
      const allowed = field.choices.map((choice) => choice.value);
      values[field.key] =
        typeof value === "string" && allowed.includes(value) ? value : allowed.includes(field.default) ? field.default : allowed[0];
    } else {
      values[field.key] = (typeof value === "string" ? value : field.default).slice(0, field.maxLength);
    }
  }
  return values;
}
