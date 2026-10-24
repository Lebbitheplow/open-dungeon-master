// A spell the engine casts on characters as a buff, cast at a character on
// the other side of the fight (issue 503, Phase 6): a turncoat polymorphed
// into a toad, a companion turned on the party shrunk by Enlarge/Reduce. The
// spell takes its own path on the target's sheet (cast-buff.ts: the form's
// statistics, the condition and its end), and the target first makes the
// save the spell's text gives an unwilling creature (SRD 5.1): Polymorph and
// True Polymorph a Wisdom save ("An unwilling creature must make a Wisdom
// saving throw, and if it succeeds, it isn't affected"), Enlarge/Reduce a
// Constitution save ("If the target is unwilling, it can make a
// Constitution saving throw. On a success, the spell has no effect"). The
// save is the character's own (forced-save.ts rollCharacterSave: proficiency,
// auras, conditions), against the caster's spell save DC; a success leaves
// the slot spent and the target as it was.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { hostileTo } from "@/lib/dm/combatant";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { textKey } from "@/lib/language/text-logic";
import { spellSaveDcFor, type CastingSheet } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The save each such spell's text gives an unwilling target, by the spell's
// rule (a workshop copy runs as its published spell).
const UNWILLING_SAVES: Record<string, SaveAbility> = {
  polymorph: "wis",
  "true polymorph": "wis",
  "enlarge/reduce": "con",
};

const BY_KEY = new Map(Object.entries(UNWILLING_SAVES).map(([name, ability]) => [textKey(name), ability]));

export function unwillingSaveFor(engine: string): SaveAbility | null {
  return BY_KEY.get(textKey(engine)) ?? null;
}

// Rolls the save of every target fighting against the caster; returns the
// line for each one who made it, by id (cast-buff.ts skips them, as it
// skips a target a ward kept the spell from).
export function unwillingResist(
  campaign: Campaign,
  turn: DmTurn,
  caster: CastingSheet<CharacterSheet>,
  spell: { name: string; engine: string },
  targets: readonly CharacterSheet[],
): Map<string, string> {
  const resisted = new Map<string, string>();
  const ability = unwillingSaveFor(spell.engine);
  const encounter = getActiveEncounter(campaign.id);
  if (!ability || !encounter) {
    return resisted;
  }
  const dc = spellSaveDcFor(caster, spell.name);
  for (const target of targets) {
    if (target.id === caster.id || !hostileTo(encounter, { kind: "sheet", id: caster.id }, { kind: "sheet", id: target.id })) {
      continue;
    }
    const save = rollCharacterSave(campaign, turn, target, ability, dc, `${target.name}: ${ability.toUpperCase()} save against ${spell.name}`);
    if (save.success) {
      resisted.set(target.id, `${target.name} resists ${spell.name} (${ability.toUpperCase()} save ${save.total ?? "made"} vs DC ${dc}): the spell has no effect on them.`);
    }
  }
  return resisted;
}
