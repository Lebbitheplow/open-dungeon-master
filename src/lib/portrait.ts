import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { imagesAvailable } from "@/lib/capabilities";
import { generateStoryImage } from "@/lib/image-generate";
import type { LibraryCharacter } from "@/lib/db/characters";
import { updateCharacterPortrait } from "@/lib/db/characters";
import { listSheetsForLibraryCharacter, patchSheet } from "@/lib/db/sheets";
import { setNpcPortrait } from "@/lib/db/npcs";
import { publishPersisted } from "@/lib/events";
import { enqueueMediaJob } from "@/lib/media-queue";
import { presetFor } from "@/lib/worlds/preset";
import type { Genre } from "@/lib/schemas/game-settings";
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

// Deterministic prompt from the sheet's identity fields. Genre-neutral by
// default because classes span all six genre catalogs; callers that know the
// campaign's genre pass its art style so the render matches the world.
function buildPortraitPrompt(sheet: CreateSheetInput, style = ""): string {
  const identity = [sheet.gender, deslug(sheet.race), deslug(sheet.class)]
    .filter(Boolean)
    .join(" ");
  const parts = [
    "Tabletop RPG character portrait, head and shoulders, centered, looking at viewer",
    identity,
    style,
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

// Fire-and-forget for AI companions: campaign sheets with no library row,
// so the render patches the sheet directly. Same serial media queue.
export function queueCompanionPortrait(sheet: {
  id: string;
  campaignId: string;
  name: string;
  race: string;
  class: string;
  background: string;
  personality: string;
  genre: Genre;
  // The campaign's selected world pack, so a companion is painted in the
  // world's own style rather than its base genre's.
  worldPack?: string;
}): void {
  const map = statusMap();
  const prompt = buildPortraitPrompt(
    {
      gender: "",
      race: sheet.race,
      class: sheet.class,
      background: sheet.background,
      appearance: sheet.personality.slice(0, 160),
      backstory: "",
    } as CreateSheetInput,
    presetFor({ genre: sheet.genre, worldPack: sheet.worldPack }).portraitStyle,
  );
  void whenImagesAvailable(() => {
    map.set(sheet.id, "queued");
    return enqueueMediaJob(`portrait ${sheet.id}`, async () => {
    map.set(sheet.id, "generating");
    try {
      const settings = configuredDefaultStorySettings();
      const image = await generateStoryImage(settings, {
        prompt,
        mode: "fast",
        aspect: "square",
      });
      const copied = copyIntoUploads(image.url);
      const portrait: SheetAttachment = {
        id: copied.id,
        name: `${sheet.name} portrait`,
        type: "image/png",
        url: copied.url,
      };
      const updated = patchSheet(sheet.id, { portrait });
      if (updated) {
        publishPersisted(sheet.campaignId, "sheet_updated", { sheet: updated });
      }
      map.delete(sheet.id);
    } catch (error) {
      map.set(sheet.id, "failed");
      console.error(`[portrait] companion generation failed for ${sheet.id}:`, error);
    }
    });
  });
}

// A face for an NPC the DM wrote. Same serial media queue as every other
// render (one iGPU, shared with the DM model), and the same copy into
// public/uploads so the stored path is one /api/upload could have written.
//
// Status is not tracked here the way a character portrait's is: an NPC has
// no creation flow waiting on it, so the panel simply shows the face when
// the row next reports one.
export function queueNpcPortrait(npc: {
  id: string;
  campaignId: string;
  // Their distinguishing trait and their personality in words, which is all
  // a face needs. The name is deliberately absent: a render prompt is not
  // improved by a proper noun the model has never seen.
  trait: string;
  personality: string;
  genre: Genre;
  worldPack?: string;
}): void {
  const style = presetFor({ genre: npc.genre, worldPack: npc.worldPack }).portraitStyle;
  const prompt = [
    "Tabletop RPG character portrait, head and shoulders, centered, looking at viewer",
    style,
    npc.trait,
    npc.personality,
    "Detailed digital painting, dramatic lighting, plain dark background",
  ]
    .filter(Boolean)
    .join(". ");
  void whenImagesAvailable(() =>
    enqueueMediaJob(`npc portrait ${npc.id}`, async () => {
      try {
        const settings = configuredDefaultStorySettings();
        const image = await generateStoryImage(settings, {
          prompt,
          mode: "fast",
          aspect: "square",
        });
        const copied = copyIntoUploads(image.url);
        if (setNpcPortrait(npc.id, copied.url)) {
          publishPersisted(npc.campaignId, "npc_updated", { npcId: npc.id, portraitUrl: copied.url });
        }
      } catch (error) {
        console.error(`[portrait] npc generation failed for ${npc.id}:`, error);
      }
    }),
  );
}

// Fire-and-forget from the creation routes: renders on the serial media
// queue (single iGPU shared with the DM model) and applies the finished
// portrait to the library character plus any campaign clones.
export function queueLibraryPortrait(character: LibraryCharacter): void {
  if (character.sheet.portrait) {
    return;
  }
  const map = statusMap();
  const prompt = buildPortraitPrompt(character.sheet);
  void whenImagesAvailable(() => {
    map.set(character.id, "queued");
    return enqueueMediaJob(`portrait ${character.id}`, async () => {
      map.set(character.id, "generating");
      try {
        const settings = configuredDefaultStorySettings();
        const image = await generateStoryImage(settings, {
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
  });
}

// Every render above is a promise the UI makes on the creator's behalf ("a
// portrait is painted after you save"). On a host with no image backend the
// promise is never made: nothing is queued, no status is recorded, and the
// sheet simply keeps its icon until the owner uploads a picture. This is what
// keeps a no-AI server from showing "portrait failed" on every new character.
async function whenImagesAvailable(start: () => Promise<unknown> | void): Promise<void> {
  if (!(await imagesAvailable())) {
    return;
  }
  await start();
}
