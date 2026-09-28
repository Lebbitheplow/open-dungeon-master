// What the player's own counter route (POST /sheet/usage) may and may not
// write, as pure decisions over the stored sheet and the request.
//
// The rule the table's owner settled: a PLAYER spends, and only whoever
// corrects the table (the DM, human or assistant, and the party lead) puts a
// use back. Uses return at rests, which the engine runs; a used count that
// went down any other way is a correction, never a player's own move.
//
// Database-free like the other *-logic modules, so the route stays a thin
// shell and scripts can exercise every branch.
import { matchArmor } from "@/lib/srd/armor";
import { attunementProblem } from "@/lib/srd/magic-items";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type UsageAsk = {
  slots?: Record<string, number>;
  hitDiceSpent?: number;
  resources?: Record<string, number>;
  gear?: Record<string, { equipped?: boolean; attuned?: boolean }>;
};

type CounterSheet = Pick<CharacterSheet, "spellcasting" | "hitDice" | "resources">;

// True when the request would hand anything back: a slot, a hit die or a
// class resource whose used count would end lower than it is stored.
export function usageLowers(sheet: CounterSheet, ask: UsageAsk): boolean {
  const slotBack = Object.entries(ask.slots ?? {}).some(([level, used]) => {
    const existing = sheet.spellcasting?.slots[level];
    return existing !== undefined && used < existing.used;
  });
  const dieBack = ask.hitDiceSpent !== undefined && ask.hitDiceSpent < sheet.hitDice.spent;
  const useBack = Object.entries(ask.resources ?? {}).some(([id, used]) => {
    const existing = sheet.resources[id];
    return existing !== undefined && used < existing.used;
  });
  return slotBack || dieBack || useBack;
}

// True when the request marks more hit dice spent than are stored. Hit dice
// are spent at the end of a short rest, which take_rest runs, so a player's
// own counter never spends one; the DM and the lead may correct it.
export function usageSpendsHitDice(sheet: CounterSheet, ask: UsageAsk): boolean {
  return ask.hitDiceSpent !== undefined && ask.hitDiceSpent > sheet.hitDice.spent;
}

export type GearChanges = {
  // Body armor put on or taken off: minutes of work (SRD donning times).
  armor: string[];
  // A shield put on or taken off: one action.
  shields: string[];
  // Attunement begun or ended: a short rest.
  attunement: string[];
};

// Which of the named items would really change state. Until a sheet has its
// first explicit toggle every carried piece counts as worn (the armor engine
// reads it that way), so asking to wear what is already worn changes nothing.
export function gearChanges(
  sheet: Pick<CharacterSheet, "equipment">,
  gear: NonNullable<UsageAsk["gear"]>,
): GearChanges {
  const anyExplicit = sheet.equipment.some((item) => item.equipped);
  const changes: GearChanges = { armor: [], shields: [], attunement: [] };
  for (const item of sheet.equipment) {
    const entry = gear[item.name];
    if (!entry) {
      continue;
    }
    if (entry.attuned !== undefined && entry.attuned !== Boolean(item.attuned)) {
      changes.attunement.push(item.name);
    }
    const worn = item.equipped ?? !anyExplicit;
    if (entry.equipped === undefined || entry.equipped === worn) {
      continue;
    }
    const armor = item.gear?.armor ?? matchArmor(item.name);
    if (!armor) {
      // Weapons and everything else: drawing or stowing is free.
      continue;
    }
    if (armor.category === "shield") {
      changes.shields.push(item.name);
    } else {
      changes.armor.push(item.name);
    }
  }
  return changes;
}

// Why the attunements this request begins are not allowed, or null. Each
// item switched on is judged against the pack as it would stand with the
// ones before it already attuned, so two rings in one request meet the same
// cap and the same one-copy rule as two requests would. Who may attune comes
// from the item's own "requires attunement by ..." line.
export function attunementRefusal(
  sheet: Pick<CharacterSheet, "name" | "equipment" | "class" | "classes" | "race" | "alignment" | "spellcasting">,
  gear: NonNullable<UsageAsk["gear"]>,
): string | null {
  let pack = sheet.equipment.map((item) =>
    gear[item.name]?.attuned === false ? { ...item, attuned: false } : item,
  );
  for (let index = 0; index < pack.length; index += 1) {
    const item = pack[index];
    if (gear[item.name]?.attuned !== true || item.attuned) {
      continue;
    }
    const problem = attunementProblem(item, pack, sheet);
    if (problem) {
      return problem;
    }
    pack = pack.map((entry, at) => (at === index ? { ...entry, attuned: true } : entry));
  }
  return null;
}
