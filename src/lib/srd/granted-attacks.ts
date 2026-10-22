// The attacks a condition grants its holder (Starry Form's Archer, Spiritual
// Weapon, Flame Blade): found by the name pc_attack is given, and their dice
// at a character level and from the slot the spell was cast with. Split from
// the registry file (src/lib/srd/condition-effects.ts), whose rows carry
// them. Pure and database-free.

import { activeConditionEffects } from "@/lib/srd/condition-effects";
import type { GrantedAttack } from "@/lib/srd/condition-effect-types";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

// Attack options the holder's conditions grant, resolved for pc_attack: a
// term names one by the attack's whole name or its condition's ("Starry
// Form: Archer", "starry form (archer)"); the form's option alone
// ("archer") is no name of it, and pc_attack's refusal lists the conditions
// that grant one.
export function grantedAttackFor(
  conditions: string[],
  ...terms: string[]
): { attack: GrantedAttack; condition: string } | null {
  const wanted = terms.filter((term) => textKey(term));
  for (const { row, condition } of activeConditionEffects(conditions)) {
    const attack = row.grantedAttack;
    if (attack && wanted.some((term) => textKey(attack.name) === textKey(term) || isConditionNamed(condition, term))) {
      return { attack, condition };
    }
  }
  return null;
}

// The conditions held that grant an attack, as written, for a refusal's list.
export function grantedAttackConditions(conditions: string[]): string[] {
  return activeConditionEffects(conditions).flatMap(({ row, condition }) => (row.grantedAttack ? [condition] : []));
}

// The granted attack's damage dice at a character level, and from the slot
// the spell was cast from when it scales with one.
export function grantedAttackDice(attack: GrantedAttack, level: number, slotLevel?: number | null): string {
  const clamped = Math.max(1, Math.min(20, Math.floor(level)));
  let dice = attack.diceByLevel[0]?.[1] ?? "1d8";
  for (const [atLevel, expression] of attack.diceByLevel) {
    if (clamped >= atLevel) {
      dice = expression;
    }
  }
  const steps = attack.upcast && slotLevel
    ? Math.floor(Math.max(0, slotLevel - attack.upcast.baseLevel) / attack.upcast.every)
    : 0;
  const base = /^(\d+)d(\d+)$/.exec(dice);
  const extra = attack.upcast ? /^(\d+)d(\d+)$/.exec(attack.upcast.dice) : null;
  if (steps > 0 && base && extra && base[2] === extra[2]) {
    return `${Number(base[1]) + steps * Number(extra[1])}d${base[2]}`;
  }
  return steps > 0 && attack.upcast ? `${dice}+${steps * Number(extra?.[1] ?? 1)}d${extra?.[2] ?? "8"}` : dice;
}
