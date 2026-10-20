import type { Campaign } from "@/lib/db/campaigns";
import { admitLibraryCharacter, type LibraryCharacter } from "@/lib/db/characters";
import { oweSkippedImprovements } from "@/lib/characters/adapt";
import { admitSheet } from "@/lib/characters/admit";
import { joinChanges, type JoinPreview } from "@/lib/characters/join-changes";

export type { JoinPreview };
import { createSheetSchema, type CreateSheetInput } from "@/lib/schemas/sheet";
import type { Pregen } from "@/lib/starter/pregens";

// The two ways a hero that already exists takes a seat, each written once:
// the join itself (POST /sheet, POST /sheet/pregen) and the confirm sheet a
// player reads before it (POST /sheet/preview, backlog F6) both come here,
// so what the sheet promises is what the join does.

export type PregenAdmitted =
  | { ok: true; built: CreateSheetInput; sheet: CreateSheetInput; rolledHp?: number[]; settle: () => void }
  | { ok: false; problems: string[] };

// A ready-made hero (src/lib/starter/pregens.ts) through the table door: the
// same door as a character the builder made, judged by the table's rules.
// Every hero is a level 1 build: at a higher table the improvements its
// level earned were never offered, so they are owed, not taken (backlog B6,
// the rule a library hero joining above its level follows).
export function admitPregen(pregen: Pregen, campaign: Campaign, userId: string): PregenAdmitted {
  const built = createSheetSchema.parse(pregen.sheet);
  const admitted = admitSheet({ door: "table", level: campaign.startingLevel, sheet: built, userId, campaign });
  if (!admitted.ok) {
    return admitted;
  }
  return {
    ok: true,
    built,
    sheet: oweSkippedImprovements(admitted.sheet, built, 1, campaign.startingLevel),
    ...(admitted.rolledHp ? { rolledHp: admitted.rolledHp } : {}),
    settle: admitted.settle,
  };
}


function preview(
  name: string,
  stored: CreateSheetInput,
  fromLevel: number,
  toLevel: number,
  admitted: { ok: true; sheet: CreateSheetInput; rolledHp?: number[] } | { ok: false; problems: string[] },
): JoinPreview {
  if (!admitted.ok) {
    return { name, fromLevel, toLevel, ok: false, problems: admitted.problems, rollsHp: false, changes: [], owed: [] };
  }
  return {
    name,
    fromLevel,
    toLevel,
    ok: true,
    problems: [],
    rollsHp: Boolean(admitted.rolledHp),
    ...joinChanges(stored, fromLevel, admitted.sheet, toLevel),
  };
}

export function previewLibraryJoin(character: LibraryCharacter, campaign: Campaign, userId: string): JoinPreview {
  const level = Math.max(1, Math.min(20, campaign.startingLevel));
  const admitted = admitLibraryCharacter(character, campaign, userId, level);
  return preview(character.name, character.sheet, character.level, level, admitted);
}

export function previewPregenJoin(pregen: Pregen, campaign: Campaign, userId: string): JoinPreview {
  const admitted = admitPregen(pregen, campaign, userId);
  const built = createSheetSchema.parse(pregen.sheet);
  return preview(built.name, built, 1, campaign.startingLevel, admitted);
}
