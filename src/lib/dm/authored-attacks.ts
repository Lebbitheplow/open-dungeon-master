// What the authored subclass features do to a character's own attack, beyond
// the weapon a feature is (src/lib/dm/pc-attack-profile.ts reads that):
//
//   - Form of the Beast's claws: one more claw attack in the Attack action,
//     once a turn; its bite heals the proficiency bonus when it hits while the
//     barbarian is below half their hit points, once a turn.
//   - Rapid Strike (Samurai 15): an attack with advantage forgoes it for one
//     more attack of the action, once a turn.
//
// Called from pc-attack-plan.ts (the budget, before anything is spent) and
// from authored-hooks.ts authoredOnHit (the bite, after the hit).

import type { Campaign } from "@/lib/db/campaigns";
import { turnKey, type Encounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { Advantage } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { computeSheetDerived } from "@/lib/srd";
import { authoredNaturalWeapon, hasRapidStrike } from "@/lib/srd/authored-effects-more";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const CLAWS_EXTRA = "form of the beast:claws";
const RAPID_STRIKE = "rapid strike";
// The turn a bite last healed in, per barbarian (turnKey).
const BITE_HEALED = new Map<string, string>();

// The Attack action's budget after a claw attack: one more attack, the first
// time a turn.
export function withClawsExtra(
  sheet: CharacterSheet,
  weapon: string | undefined,
  budget: TurnBudget,
  notes: string[],
): TurnBudget {
  const natural = authoredNaturalWeapon(sheet, weapon);
  if (!natural?.weapon.extraAttack || budget.oncePerTurn.includes(CLAWS_EXTRA)) {
    return budget;
  }
  notes.push(`${natural.feature}: one more claw attack this turn as part of the Attack action`);
  return { ...budget, attacksAllowed: budget.attacksAllowed + 1, oncePerTurn: [...budget.oncePerTurn, CLAWS_EXTRA] };
}

// Rapid Strike on this attack: the budget with its extra attack, or the
// sentence that refuses it.
export function rapidStrike(input: {
  sheet: CharacterSheet;
  budget: TurnBudget | null;
  advantage: Advantage;
  weaponAttack: boolean;
  bonus: boolean;
}): { refused: string } | { budget: TurnBudget; note: string } {
  const { sheet, budget } = input;
  const feature = hasRapidStrike(sheet);
  if (!feature) {
    return { refused: `${sheet.name} does not have Rapid Strike (a Samurai's 15th level feature); attack without rapidStrike.` };
  }
  if (!budget || !input.weaponAttack || input.bonus) {
    return { refused: "Rapid Strike trades the advantage of one weapon attack of the Attack action, on the fighter's own turn." };
  }
  if (budget.oncePerTurn.includes(RAPID_STRIKE)) {
    return { refused: `${sheet.name} has used Rapid Strike this turn; it comes once a turn.` };
  }
  if (input.advantage !== "advantage") {
    return { refused: "Rapid Strike forgoes advantage on the attack, and this attack has none to forgo; attack without rapidStrike." };
  }
  return {
    budget: { ...budget, attacksAllowed: budget.attacksAllowed + 1, oncePerTurn: [...budget.oncePerTurn, RAPID_STRIKE] },
    note: `${feature}: the advantage is forgone for one more attack against this target`,
  };
}

// The bonus-action second attack a feature's weapon grants (the Soulknife's
// second psychic blade): made on the character's own turn, after attacking
// with the first. Null when it may be made; the weapon needs no second item
// in hand, so two-weapon fighting's carried-weapons rule does not apply.
export function secondWeaponProblem(sheet: CharacterSheet, weapon: string | undefined, budget: TurnBudget | null): string | null | undefined {
  const natural = authoredNaturalWeapon(sheet, weapon);
  if (!natural?.second) {
    return undefined;
  }
  if (!budget) {
    return `The second ${natural.weapon.name.toLowerCase()} is a bonus action on ${sheet.name}'s own turn; it is not their turn.`;
  }
  if (budget.attacksMade < 1 || !budget.lightMeleeAttack) {
    return `The second ${natural.weapon.name.toLowerCase()} follows an attack with the first on the same turn; ${sheet.name} attacks with it first.`;
  }
  return null;
}

// The bite's healing, after a hit with it.
export function naturalWeaponOnHit(
  campaign: Campaign,
  encounter: Encounter,
  stale: CharacterSheet,
  weaponName: string | undefined,
): string[] {
  const sheet = getSheetById(stale.id) ?? stale;
  const natural = authoredNaturalWeapon(sheet, weaponName);
  if (natural?.weapon.onHit !== "bite_heal") {
    return [];
  }
  const max = effectiveMaxHp(sheet);
  const stamp = `${encounter.id}:${turnKey(encounter)}`;
  if (sheet.currentHp <= 0 || sheet.currentHp >= max / 2 || BITE_HEALED.get(sheet.id) === stamp) {
    return [];
  }
  const heal = computeSheetDerived(sheet).proficiencyBonus;
  const currentHp = Math.min(max, sheet.currentHp + heal);
  const updated = patchSheet(sheet.id, { currentHp });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  BITE_HEALED.set(sheet.id, stamp);
  return [`${natural.feature}: the bite heals ${sheet.name} ${currentHp - sheet.currentHp} hit points.`];
}
