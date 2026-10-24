import type { Campaign } from "@/lib/db/campaigns";
import { companionDeparture } from "@/lib/db/companion-departures";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { moveToSide } from "@/lib/dm/combat-sides";
import { fieldReturning, returningByName } from "@/lib/dm/companion-return";
import { sheetStatBlock } from "@/lib/dm/companion-statblock";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The characters a fight's roster can name as foes (issue 503, Phase 6):
// a departed companion come back against the party, and a companion who
// turned on it where no fight was running (src/lib/dm/turncoat.ts). Each
// fights as its own sheet on the foes' side, never as a stat block: the
// block here is only what the fight is budgeted on (companion-statblock.ts).
// start_encounter and add_enemies resolve a name to one of these through
// src/lib/dm/encounter-spawn.ts and field it with fieldSheetFoes once the
// fight exists.

export type SheetFoe =
  | { kind: "returning"; npcId: string; name: string }
  | { kind: "turned"; sheetId: string; name: string };

export type SheetFoeEntry = { foe: SheetFoe; name: string; stats: EnemyStats; currentHp: number };

// By name key, the characters a roster may name as foes now.
export function sheetFoesByName(campaignId: string): Map<string, SheetFoeEntry> {
  const found = new Map<string, SheetFoeEntry>();
  for (const [key, back] of returningByName(campaignId)) {
    found.set(key, { foe: { kind: "returning", npcId: back.npcId, name: back.name }, name: back.name, stats: back.stats, currentHp: back.currentHp });
  }
  for (const sheet of listSheets(campaignId)) {
    const npc = sheet.isCompanion ? companionNpcFor(sheet) : null;
    const departure = npc ? companionDeparture(npc.id) : null;
    if (!departure?.turned && !departure?.gone) {
      continue;
    }
    // Rated as it stands: the wounds and slots it turned with.
    const { stats } = sheetStatBlock(sheet, { open: true, asItStands: true });
    found.set(textKey(sheet.name), { foe: { kind: "turned", sheetId: sheet.id, name: sheet.name }, name: sheet.name, stats, currentHp: sheet.currentHp });
  }
  return found;
}

// The fight exists: each named character takes its place on the foes' side,
// rolled into the order and put on the board near them (combat-sides.ts).
// Returns the sheets fielded; one that can no longer be fielded is left out.
export function fieldSheetFoes(campaign: Campaign, foes: readonly SheetFoe[]): CharacterSheet[] {
  const fielded: CharacterSheet[] = [];
  for (const foe of foes) {
    const sheet = foe.kind === "returning" ? fieldReturning(campaign, foe.npcId, foe.name) : getSheetById(foe.sheetId);
    if (!sheet || fielded.some((entry) => entry.id === sheet.id)) {
      continue;
    }
    const moved = moveToSide(campaign, sheet.id, "foe", { quiet: true });
    if ("error" in moved) {
      continue;
    }
    fielded.push(getSheetById(sheet.id) ?? sheet);
  }
  return fielded;
}

// Every companion at the table set against the party (turned on it, or
// fielded for a return and still here): a foe in any fight that starts,
// named or not.
export function turnedFoes(campaignId: string): SheetFoe[] {
  return listSheets(campaignId).flatMap((sheet) => {
    const npc = sheet.isCompanion ? companionNpcFor(sheet) : null;
    const departure = npc ? companionDeparture(npc.id) : null;
    return departure?.turned || departure?.gone ? [{ kind: "turned" as const, sheetId: sheet.id, name: sheet.name }] : [];
  });
}

// The ids a roster's resolved entries name as sheet foes.
export function sheetFoeIds(foes: readonly SheetFoe[]): Set<string> {
  return new Set(foes.flatMap((foe) => (foe.kind === "turned" ? [foe.sheetId] : [])));
}
