// Every combatant in a fight, whichever kind it is, and the one resolver for
// a target (issue 503, Phase 6): resolveCombatant takes the id or name a tool
// call names and finds the enemy row or the character sheet behind it, with
// the side it is on now. Every tool that targets a creature in a fight asks
// it (scripts/test-combatant-targets.mjs keeps them to it), so a companion
// who turns on the party, a dominated ogre and a summon gone wild are all
// targets like any foe, and a sheet can be struck by another sheet.
//
// Sides: src/lib/dm/combat-sides-logic.ts. Who moves a combatant to the
// other side: src/lib/dm/combat-sides.ts. A sheet seen through the foe paths:
// src/lib/dm/sheet-foe.ts.
//
// Database reads only; nothing here publishes or writes, so the engine's
// lowest layers (summon-store, companion-command, the damage paths) may ask.

import {
  getEnemy,
  listEnemies,
  type Encounter,
  type EncounterEnemy,
  type OrderEntry,
} from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import {
  dominatorOf,
  opposed,
  sheetOutOfFight,
  storedSide,
  type CombatSide,
  type CombatantKind,
} from "@/lib/dm/combat-sides-logic";
import { isDefeated } from "@/lib/dm/knockout";
import { unknownRef, type ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type CombatantRef = { kind: CombatantKind; id: string };

export type Combatant =
  | { kind: "sheet"; id: string; name: string; side: CombatSide; sheet: CharacterSheet }
  | { kind: "enemy"; id: string; name: string; side: CombatSide; enemy: EncounterEnemy };

type SidedEncounter = Pick<Encounter, "id" | "sides">;
type Holder = { conditions: string[]; conditionMeta: unknown };

// Which kind of combatant an id is: an enemy row of this fight, else a sheet.
export function kindOfId(encounterId: string, id: string): CombatantKind | null {
  const enemy = getEnemy(id);
  if (enemy && enemy.encounterId === encounterId) {
    return "enemy";
  }
  return getSheetById(id) ? "sheet" : null;
}

// The side a combatant is on now: its dominator's while a Dominate spell
// holds it, else the encounter's exception, else its kind's default. The
// dominator's own side is its stored one (a chain of dominations is read
// one link deep, so two creatures dominating each other cannot loop).
export function sideOf(encounter: SidedEncounter, kind: CombatantKind, id: string, holder?: Holder | null): CombatSide {
  const fresh: Holder | null = holder ?? (kind === "sheet" ? getSheetById(id) : getEnemy(id));
  const dominator = fresh ? dominatorOf(fresh.conditions, fresh.conditionMeta as Record<string, { spell?: unknown; source?: unknown }>) : null;
  if (dominator && dominator !== id) {
    const dominatorKind = kindOfId(encounter.id, dominator);
    if (dominatorKind) {
      return storedSide(encounter.sides, dominatorKind, dominator);
    }
  }
  return storedSide(encounter.sides, kind, id);
}

// An order entry's side; a DM's hand-added slot (an "npc" entry) has none.
export function entrySide(encounter: SidedEncounter, entry: OrderEntry): CombatSide | null {
  if (entry.kind === "pc") {
    return sideOf(encounter, "sheet", entry.characterId);
  }
  return entry.kind === "enemy" ? sideOf(encounter, "enemy", entry.enemyId) : null;
}

export function sheetSide(encounter: SidedEncounter | null, sheetId: string): CombatSide {
  return encounter ? sideOf(encounter, "sheet", sheetId) : "party";
}

export function enemySide(encounter: SidedEncounter | null, enemyId: string): CombatSide {
  return encounter ? sideOf(encounter, "enemy", enemyId) : "foe";
}

// Whether two combatants fight on opposite sides.
export function hostileTo(encounter: SidedEncounter, a: CombatantRef, b: CombatantRef): boolean {
  return opposed(sideOf(encounter, a.kind, a.id), sideOf(encounter, b.kind, b.id));
}

function sheetCombatant(encounter: SidedEncounter | null, sheet: CharacterSheet): Combatant {
  return { kind: "sheet", id: sheet.id, name: sheet.name, side: encounter ? sideOf(encounter, "sheet", sheet.id, sheet) : "party", sheet };
}

function enemyCombatant(encounter: SidedEncounter, enemy: EncounterEnemy): Combatant {
  return { kind: "enemy", id: enemy.id, name: enemy.displayName, side: sideOf(encounter, "enemy", enemy.id, enemy), enemy };
}

// The combatant an id or a name names in this campaign's fight: an enemy row
// of the fight, or a character sheet of the campaign, read fresh. An exact id
// wins over a name; among names, the living enemies come first, then the
// sheets, then the fallen. Null when nothing matches.
export function resolveCombatant(campaignId: string, encounter: Encounter | null, ref: string | null | undefined): Combatant | null {
  const trimmed = (ref ?? "").trim();
  if (!trimmed) {
    return null;
  }
  if (encounter) {
    const enemy = getEnemy(trimmed);
    if (enemy && enemy.encounterId === encounter.id) {
      return enemyCombatant(encounter, enemy);
    }
  }
  const sheet = getSheetById(trimmed);
  if (sheet && sheet.campaignId === campaignId) {
    return sheetCombatant(encounter, sheet);
  }
  const wanted = textKey(trimmed);
  const enemies = encounter ? listEnemies(encounter.id) : [];
  const living = enemies.find((entry) => entry.status === "alive" && textKey(entry.displayName) === wanted);
  if (living && encounter) {
    return enemyCombatant(encounter, living);
  }
  const named = listSheets(campaignId).find((entry) => textKey(entry.name) === wanted);
  if (named) {
    return sheetCombatant(encounter, getSheetById(named.id) ?? named);
  }
  const fallen = enemies.find((entry) => textKey(entry.displayName) === wanted);
  return fallen && encounter ? enemyCombatant(encounter, fallen) : null;
}

// Everyone in the fight's order, each once (a Thief's Reflexes second turn
// is the same combatant), read fresh with their side. A DM's hand-added slot
// is no combatant the engine runs.
export function combatantsOf(campaignId: string, encounter: Encounter): Combatant[] {
  const enemies = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const seen = new Set<string>();
  const out: Combatant[] = [];
  for (const entry of encounter.order) {
    const id = entry.kind === "pc" ? entry.characterId : entry.kind === "enemy" ? entry.enemyId : null;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (entry.kind === "enemy") {
      const enemy = enemies.get(id);
      if (enemy) {
        out.push(enemyCombatant(encounter, enemy));
      }
      continue;
    }
    const sheet = getSheetById(id);
    if (sheet && sheet.campaignId === campaignId) {
      out.push(sheetCombatant(encounter, sheet));
    }
  }
  // An enemy the order does not list yet (initiative still being collected,
  // a late arrival) is in the fight all the same.
  for (const enemy of enemies.values()) {
    if (!seen.has(enemy.id)) {
      out.push(enemyCombatant(encounter, enemy));
    }
  }
  return out;
}

// Out of the fight: an enemy dead, fled or knocked out; a character at 0 hit
// points or dead (combat-sides-logic.ts sheetOutOfFight, the rule for a
// sheet on the foes' side).
export function combatantDefeated(combatant: Combatant): boolean {
  return combatant.kind === "enemy" ? isDefeated(combatant.enemy) : sheetOutOfFight(combatant.sheet);
}

// The combatants on a side who are still in the fight.
export function standingOn(campaignId: string, encounter: Encounter, side: CombatSide): Combatant[] {
  return combatantsOf(campaignId, encounter).filter((combatant) => combatant.side === side && !combatantDefeated(combatant));
}

// The character sheets fighting on a side, in order (party: the characters a
// fight's party-down and XP count; foe: a companion turned on them).
export function sheetsOnSide(campaignId: string, encounter: Encounter, side: CombatSide): CharacterSheet[] {
  return combatantsOf(campaignId, encounter)
    .filter((combatant): combatant is Extract<Combatant, { kind: "sheet" }> => combatant.kind === "sheet" && combatant.side === side)
    .map((combatant) => combatant.sheet);
}

// The refusal of a target nothing matched, listing who could be meant: the
// enemies standing and, when any fight on the foes' side, those sheets too.
export function unknownCombatantRef(campaignId: string, encounter: Encounter | null, field: string, ref: string | undefined, tail = ""): ToolError {
  const records = encounter
    ? combatantsOf(campaignId, encounter)
        .filter((combatant) => !combatantDefeated(combatant) && (combatant.kind === "enemy" || combatant.side === "foe"))
        .map((combatant) => ({ id: combatant.id, name: combatant.name }))
    : [];
  return unknownRef(field, ref, records, tail);
}

// The side each board token's creature fights on, for the board's passage
// (battlemap/passage.ts): a character's and an enemy's by this fight, a
// DM's hand-placed figure with the party, a prop as a thing.
export function tokenSides(encounter: SidedEncounter | null): (token: { kind: string; refId: string }) => string {
  return (token) => {
    if (token.kind === "prop") {
      return "prop";
    }
    if (!encounter) {
      return token.kind === "enemy" ? "foe" : "party";
    }
    if (token.kind === "enemy") {
      return sideOf(encounter, "enemy", token.refId);
    }
    return token.kind === "pc" ? sideOf(encounter, "sheet", token.refId) : "party";
  };
}
