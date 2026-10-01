// A spell's hold a character can break with their action (SRD 5.1): Web and
// Entangle with a Strength check, Black Tentacles with Strength or Dexterity,
// each against the caster's spell save DC; Maze with an Intelligence check
// against DC 20; Irresistible Dance with a Wisdom saving throw. The engine's
// take_action escape resolves it (src/lib/dm/spell-escape.ts, which reads the
// same spell row); the Hand offers the Escape card for it and says what it
// rolls. Pure: the row comes from the spell table the Hand already reads.
import { spellMechFor } from "@/lib/srd/spell-mechanics";
import { computeSheetDerived } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", int: "Intelligence", wis: "Wisdom" } as const;

export type SpellHold = {
  // The condition on the sheet ("restrained", "mazed", "dancing") and the
  // spell that laid it.
  condition: string;
  spell: string;
  rules: string;
  dice: string;
  roll: "ability check" | "saving throw";
};

const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

export function spellHoldOf(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta"> & Parameters<typeof computeSheetDerived>[0]): SpellHold | null {
  const meta = (sheet.conditionMeta ?? {}) as Record<string, { spell?: string } | undefined>;
  for (const condition of sheet.conditions) {
    const spell = meta[condition]?.spell;
    const rule = spell ? spellMechFor([spell])?.condition : null;
    if (!spell || !rule || rule.name !== condition || !(rule.escape?.length || rule.escapeSave)) {
      continue;
    }
    const derived = computeSheetDerived(sheet);
    const against = rule.escapeDc ? `DC ${rule.escapeDc}` : "the caster's spell save DC";
    if (rule.escapeSave) {
      const ability = rule.escapeSave;
      return {
        condition,
        spell,
        rules: `${spell}: your action for a ${ABILITY_NAMES[ability]} saving throw against ${against}; a success ends it.`,
        dice: `${ABILITY_NAMES[ability]} save ${signed(derived.saves[ability])}`,
        roll: "saving throw",
      };
    }
    const abilities = rule.escape ?? [];
    const best = abilities.reduce((top, ability) => (derived.abilityMods[ability] > derived.abilityMods[top] ? ability : top), abilities[0]);
    return {
      condition,
      spell,
      rules: `${spell}: your action for a ${abilities.map((ability) => ABILITY_NAMES[ability]).join(" or ")} check against ${against}; a success frees you.`,
      dice: `${ABILITY_NAMES[best]} ${signed(derived.abilityMods[best])}`,
      roll: "ability check",
    };
  }
  return null;
}
