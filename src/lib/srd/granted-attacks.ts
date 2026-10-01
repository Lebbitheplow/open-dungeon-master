// The attacks a condition grants its holder (Starry Form's Archer, Spiritual
// Weapon, Flame Blade): found by the name pc_attack is given, and their dice
// at a character level and from the slot the spell was cast with. Split from
// the registry file (src/lib/srd/condition-effects.ts), whose rows carry
// them. Pure and database-free.

import { activeConditionEffects } from "@/lib/srd/condition-effects";
import type { GrantedAttack } from "@/lib/srd/condition-effect-types";

// Names compared as the registry compares them.
function normalize(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Attack options the holder's conditions grant, resolved for pc_attack:
// the named term matches loosely so "starry form" or "archer" finds it.
export function grantedAttackFor(
  conditions: string[],
  term: string,
): { attack: GrantedAttack; condition: string } | null {
  const wanted = normalize(term);
  if (!wanted) {
    return null;
  }
  for (const { row, condition } of activeConditionEffects(conditions)) {
    const attack = row.grantedAttack;
    if (!attack) {
      continue;
    }
    const name = normalize(attack.name);
    if (
      name === wanted ||
      name.includes(wanted) ||
      wanted.includes(name) ||
      normalize(condition).includes(wanted)
    ) {
      return { attack, condition };
    }
  }
  return null;
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
