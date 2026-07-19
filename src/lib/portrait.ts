import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { generateComfyImage } from "@/lib/comfyui";
import type { LibraryCharacter } from "@/lib/db/characters";
import { updateCharacterPortrait } from "@/lib/db/characters";
import { listSheetsForLibraryCharacter, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { enqueueMediaJob } from "@/lib/media-queue";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import type { CreateSheetInput, SheetAttachment } from "@/lib/schemas/sheet";

// One-shot portrait render at character creation. Status lives in memory
// only: a restart mid-job simply drops the entry and the UI falls back to
// the plain icon (the durable truth stays derivable from sheet.portrait).
// Lives on globalThis so dev-mode HMR cannot fork the map.

export type PortraitState = "queued" | "generating" | "failed";

declare global {
  var __odmPortraitStatus: Map<string, PortraitState> | undefined;
}

function statusMap(): Map<string, PortraitState> {
  globalThis.__odmPortraitStatus ??= new Map();
  return globalThis.__odmPortraitStatus;
}

export function portraitStatus(characterId: string): PortraitState | null {
  return statusMap().get(characterId) ?? null;
}

function deslug(value: string) {
  return value.replace(/[-_]/g, " ").trim();
}

// Deterministic prompt from the sheet's identity fields; genre-neutral
// because classes span all six genre catalogs.
function buildPortraitPrompt(sheet: CreateSheetInput): string {
  const identity = [sheet.gender, deslug(sheet.race), deslug(sheet.class)]
    .filter(Boolean)
    .join(" ");
  const parts = [
    "Tabletop RPG character portrait, head and shoulders, centered, looking at viewer",
    identity,
    sheet.background ? `${deslug(sheet.background)} background` : "",
    sheet.appearance,
    (sheet.backstory || "").slice(0, 200),
    "Detailed digital painting, dramatic lighting, plain dark background",
  ];
  return parts.filter(Boolean).join(". ");
}

// Copy the render into public/uploads/: attachmentSchema pins portrait urls
// to /uploads/ so full-sheet edits keep validating.
function copyIntoUploads(generatedUrl: string): { id: string; url: string } {
  const source = path.join(process.cwd(), "public", ...generatedUrl.replace(/^\//, "").split("/"));
  const id = crypto.randomUUID();
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  copyFileSync(source, path.join(uploadsDir, `${id}.png`));
  return { id, url: `/uploads/${id}.png` };
}

// Campaign sheets are copied from the library at join time, so a sheet
// cloned before the render finished has no portrait yet; fill those in and
// let their campaigns re-render. A manual upload from the library page is
// authoritative and overwrites campaign copies.
export function mirrorToCampaignSheets(
  libraryCharacterId: string,
  portrait: SheetAttachment | null,
  { overwrite = false }: { overwrite?: boolean } = {},
) {
  for (const sheet of listSheetsForLibraryCharacter(libraryCharacterId)) {
    if (!overwrite && sheet.portrait) {
      continue;
    }
    const updated = patchSheet(sheet.id, { portrait });
    if (updated) {
      publishPersisted(sheet.campaignId, "sheet_updated", { sheet: updated });
    }
  }
}

// Fire-and-forget from the creation routes: renders on the serial media
// queue (single iGPU shared with the DM model) and applies the finished
// portrait to the library character plus any campaign clones.
export function queueLibraryPortrait(character: LibraryCharacter): void {
  if (character.sheet.portrait) {
    return;
  }
  const map = statusMap();
  map.set(character.id, "queued");
  const prompt = buildPortraitPrompt(character.sheet);
  void enqueueMediaJob(`portrait ${character.id}`, async () => {
    map.set(character.id, "generating");
    try {
      const settings = configuredDefaultStorySettings();
      const image = await generateComfyImage({
        url: settings.comfyUrl || undefined,
        checkpoint: settings.comfyCheckpoint || undefined,
        prompt,
        mode: "fast",
        aspect: "square",
      });
      const copied = copyIntoUploads(image.url);
      const portrait: SheetAttachment = {
        id: copied.id,
        name: `${character.name} portrait`,
        type: "image/png",
        url: copied.url,
      };
      if (!updateCharacterPortrait(character.userId, character.id, portrait)) {
        map.delete(character.id);
        return;
      }
      mirrorToCampaignSheets(character.id, portrait);
      map.delete(character.id);
    } catch (error) {
      map.set(character.id, "failed");
      console.error(`[portrait] generation failed for ${character.id}:`, error);
    }
  });
}
