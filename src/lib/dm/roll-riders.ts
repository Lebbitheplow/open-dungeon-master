// Small pure readers the roll resolver (src/lib/dm/rolls.ts) uses for the
// riders that are the sheet's and not a condition's: a tool the character is
// trained in, the Inspiration the DM awarded, and a score after its items.
// Kept apart so rolls.ts stays about composing the expression.

import { effectiveAbilities } from "@/lib/srd/magic-items";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

// Inspiration lives in the resources map as a one-use counter, so it keeps
// the counters' rules: a player may spend it (raise `used`), only the DM or
// the party lead gives it back. { max: 1, used: 0 } is held; used 1, or no
// entry at all, is none. Old sheets have no entry and hold none.
export const INSPIRATION_ID = "inspiration";

// The token a roll that spent Inspiration hands back in spendInspiration;
// spendRollCarriers (src/lib/dm/forced-save.ts) marks the counter used.
export const INSPIRATION_SPEND = "@inspiration";
// A luck point folded into the roll (Lucky, src/lib/srd/feat-combat.ts).
export const LUCK_SPEND = "@luck";

export function heldInspiration(sheet: Pick<CharacterSheet, "resources">): boolean {
  const state = sheet.resources?.[INSPIRATION_ID];
  return Boolean(state && state.used < state.max);
}

// The resources map with Inspiration held (the DM's award). Having it twice
// is having it once (SRD 5.1: a character either has Inspiration or not).
export function awardInspirationCounter(
  resources: CharacterSheet["resources"] | undefined,
): CharacterSheet["resources"] {
  return { ...(resources ?? {}), [INSPIRATION_ID]: { max: 1, used: 0 } };
}

// The resources map with Inspiration spent.
export function spendInspirationCounter(
  resources: CharacterSheet["resources"] | undefined,
): CharacterSheet["resources"] {
  return { ...(resources ?? {}), [INSPIRATION_ID]: { max: 1, used: 1 } };
}

// "Thieves' tools", "thieves tools" and "Thieves' Tools (lockpicks)" are one
// tool: compared without case, punctuation, or a trailing note.
function toolKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The proficiency a check with this tool adds: the bonus when the sheet lists
// the tool among its proficiencies, twice that when it also lists expertise in
// it (a rogue's thieves' tools). Null when they are not trained in it.
export function toolProficiencyBonus(
  sheet: Pick<CharacterSheet, "proficiencies"> & Partial<Pick<CharacterSheet, "class" | "level" | "classes">>,
  tool: string,
  proficiencyBonus: number,
): { bonus: number; note: string } | null {
  const wanted = toolKey(tool);
  if (!wanted) {
    return null;
  }
  const matches = (entry: string) => {
    const held = toolKey(entry);
    return held === wanted || held === `${wanted}s` || `${held}s` === wanted;
  };
  if (!(sheet.proficiencies.tools ?? []).some(matches)) {
    return null;
  }
  // Tool Expertise (Artificer 6th): every tool the artificer is proficient
  // with doubles.
  const artificer = sheet.classes?.length
    ? (sheet.classes.find((entry) => entry.id.toLowerCase() === "artificer")?.level ?? 0)
    : (sheet.class ?? "").toLowerCase() === "artificer"
      ? (sheet.level ?? 0)
      : 0;
  const expert = (sheet.proficiencies.expertise ?? []).some(matches) || artificer >= 6;
  const bonus = expert ? proficiencyBonus * 2 : proficiencyBonus;
  return {
    bonus,
    note: `${expert ? "expertise" : "proficiency"} with ${tool}: +${bonus}`,
  };
}

// An ability score after the items that set it (Gauntlets of Ogre Power).
export function computeAbilityScore(
  sheet: Pick<CharacterSheet, "abilities" | "equipment"> & Partial<CharacterSheet>,
  ability: Ability,
): number {
  const scores = sheet.equipment
    ? effectiveAbilities(sheet.abilities, sheet.equipment, sheet)
    : sheet.abilities;
  return scores[ability];
}
