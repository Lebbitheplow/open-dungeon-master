// A creature's natural attack as pc_attack rolls it: a beast form's (Wild
// Shape, Polymorph) or a summoned creature's, with its stat block's own
// to-hit and dice, its reach or range, rider dice of another type kept
// apart so each meets its own resistance, and the rider its hit carries,
// which src/lib/dm/natural-onhit.ts lands once the hit does. Pure.

import type { AttackProfile } from "@/lib/dm/attack-logic";
import { textKey } from "@/lib/language/text-logic";
import { attackDamage, type CreatureAttack } from "@/lib/srd/creature-attacks";

const TILE = 5;

export function naturalAttackProfile(
  attack: CreatureAttack,
  label: { weapon: string; note: string; magical?: boolean },
): AttackProfile {
  const { expression, typed } = attackDamage(attack);
  return {
    weapon: label.weapon,
    toHit: attack.toHit,
    damageExpression: expression,
    damageType: attack.type,
    ranged: Boolean(attack.range) && !attack.thrown,
    thrown: Boolean(attack.thrown),
    reachTiles: Math.max(1, Math.floor((attack.reach ?? TILE) / TILE)),
    rangeTiles: attack.range ? Math.max(1, Math.floor(attack.range / TILE)) : 1,
    ...(attack.range && attack.longRange ? { longRangeTiles: Math.floor(attack.longRange / TILE) } : {}),
    proficient: true,
    improvised: false,
    ability: "str",
    magicBonus: 0,
    twoHanded: false,
    sneakEligible: false,
    heavy: false,
    riderNotes: [label.note],
    // Magic Weapons (a couatl, a unicorn): its attacks are magical.
    ...(label.magical ? { magicWeapon: true } : {}),
    ...(typed.length ? { gearTyped: typed } : {}),
    ...(attack.onHit ? { creatureOnHit: attack.onHit } : {}),
    ...(attack.proneTargetsOnly ? { proneTargetsOnly: true } : {}),
  };
}

// The attack a call names by its whole name, or the only one there is.
export function pickNaturalAttack<T extends { name: string }>(attacks: T[], weapon: string | undefined): T | undefined {
  const wanted = textKey(weapon ?? "");
  return wanted ? attacks.find((attack) => textKey(attack.name) === wanted) : attacks.length === 1 ? attacks[0] : undefined;
}
