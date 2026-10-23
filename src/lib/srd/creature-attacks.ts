// A creature's natural attack as the SRD 5.1 tables carry it
// (src/lib/srd/srd-creatures.ts): the hit's own dice and type, dice of
// another type riding it, and what a hit does besides its damage, a save
// and its cost or a grapple. Shared by every engine that rolls such an
// attack: a Wild Shape or Polymorph form (pc-attack-profile.ts), a summoned
// creature (summon-rules.ts), a familiar or companion (pet-tools.ts), and a
// creature polymorphed into a beast (enemy-polymorph-logic.ts). Pure and
// free of the table itself, so a module the browser loads may read it.

import type { EnemyAttack, OnHitRider } from "@/lib/bestiary/statblock";

export type CreatureAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";

// What a hit does besides its damage (scripts/lib/srd-creature-text.mjs
// reads it from the printed line).
export type CreatureOnHit = {
  // A save the target makes: failing it costs what the fields below say.
  save?: CreatureAbility;
  dc?: number;
  damage?: string;
  damageType?: string;
  // The damage halves on a success; without it a success takes none.
  halfOnSave?: boolean;
  // Laid on a failed save, or on every hit when there is no save.
  condition?: string;
  alsoCondition?: string;
  // How long the condition lasts, in rounds; absent until it is ended.
  rounds?: number;
  // The target saves again at the end of each of its turns.
  repeatSave?: boolean;
  // A grapple's escape DC, and the largest size it holds.
  escapeDc?: number;
  maxSize?: string;
  // The poisoned target also falls unconscious when it fails by this much
  // (a pseudodragon's sting) or rolls this or lower (a sprite's arrow).
  unconsciousFailBy?: number;
  unconsciousAtMost?: number;
  // Creatures the rider spares ("a creature other than an elf or undead").
  exempt?: string[];
  // Life Drain: the hit point maximum falls by the damage taken.
  drainMaxHp?: "all";
  // Sentences no field holds, word for word, for whoever runs it.
  manual?: string[];
};

export type CreatureRider = { dice: string; type: string };

export type CreatureAttack = {
  name: string;
  toHit: number;
  // A dice expression the dice engine accepts ("2d4+2", or a flat "1").
  damage: string;
  type: string;
  // Melee reach in feet (5 when absent); a ranged or thrown attack's range.
  reach?: number;
  range?: number;
  longRange?: number;
  thrown?: boolean;
  // "One prone creature": the hooves and stomps that trample the fallen.
  proneTargetsOnly?: boolean;
  riders?: CreatureRider[];
  onHit?: CreatureOnHit;
};

const ABILITY_NAMES: Record<CreatureAbility, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// "1 minute", "24 hours", "3 rounds".
export function roundsWords(rounds: number): string {
  if (rounds % 600 === 0) {
    return `${rounds / 600} hour${rounds === 600 ? "" : "s"}`;
  }
  if (rounds % 10 === 0) {
    return `${rounds / 10} minute${rounds === 10 ? "" : "s"}`;
  }
  return `${rounds} round${rounds === 1 ? "" : "s"}`;
}

// What a hit's rider does, in a few words: "DC 11 Constitution save, 3d6
// poison, half on a success".
export function onHitWords(onHit: CreatureOnHit): string {
  const conditions = [onHit.condition, onHit.alsoCondition].filter(Boolean).join(" and ");
  const lasting = conditions && onHit.rounds ? ` for ${roundsWords(onHit.rounds)}` : "";
  const cost = [
    onHit.damage ? `${onHit.damage} ${onHit.damageType ?? ""}`.trim() : "",
    conditions ? `${conditions}${lasting}` : "",
    onHit.drainMaxHp ? "its hit point maximum reduced by the damage" : "",
  ].filter(Boolean).join(" and ");
  const words = onHit.save && onHit.dc
    ? onHit.halfOnSave
      ? `DC ${onHit.dc} ${ABILITY_NAMES[onHit.save]} save, ${cost}, half on a success`
      : `DC ${onHit.dc} ${ABILITY_NAMES[onHit.save]} save or ${cost}`
    : cost;
  const extras = [
    onHit.escapeDc ? `escape DC ${onHit.escapeDc}` : "",
    onHit.maxSize ? `${onHit.maxSize} or smaller` : "",
    onHit.repeatSave ? "saving again at the end of each of its turns" : "",
    onHit.unconsciousFailBy ? `unconscious too if it fails by ${onHit.unconsciousFailBy} or more` : "",
    onHit.unconsciousAtMost ? `unconscious too on a save of ${onHit.unconsciousAtMost} or lower` : "",
    onHit.exempt?.length ? `not ${onHit.exempt.join(" or ")}` : "",
  ].filter(Boolean);
  return [words, ...extras].filter(Boolean).join("; ");
}

// One attack for a tool result or GAME STATE: "Bite +6 (1 piercing plus
// 3d4 poison)", "Tentacles +5 (2d6+3 bludgeoning), reach 15 ft., on a hit
// grappled and restrained; escape DC 16".
export function attackSummary(attack: CreatureAttack): string {
  const riders = (attack.riders ?? []).map((rider) => ` plus ${rider.dice} ${rider.type}`).join("");
  const reach = attack.range
    ? `, range ${attack.range}/${attack.longRange ?? attack.range} ft.${attack.thrown ? " thrown" : ""}`
    : attack.reach && attack.reach !== 5
      ? `, reach ${attack.reach} ft.`
      : "";
  const prone = attack.proneTargetsOnly ? ", prone targets only" : "";
  const rider = attack.onHit ? onHitWords(attack.onHit) : "";
  return `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type}${riders})${reach}${prone}${rider ? `, on a hit ${rider}` : ""}`;
}

// The dice the attack rolls on a hit, riders included, and the typed riders
// kept apart so each meets its own resistance.
export function attackDamage(attack: Pick<CreatureAttack, "damage" | "riders">): { expression: string; typed: CreatureRider[] } {
  const riders = attack.riders ?? [];
  return {
    expression: [attack.damage, ...riders.map((rider) => rider.dice)].join("+"),
    typed: riders.map((rider) => ({ dice: rider.dice, type: rider.type })),
  };
}

// The rider in the shape an enemy's attack carries (src/lib/dm/enemy-hit.ts
// resolveOnHit), for a creature that turns on the party or a creature
// polymorphed into a beast. A rider that spares some targets is left to the
// DM entire, as that engine reads no such limit.
function enemyRider(onHit: CreatureOnHit): OnHitRider | undefined {
  const manual = [...(onHit.manual ?? [])];
  if (onHit.exempt?.length) {
    return { manual: [`On a hit: ${onHitWords(onHit)}.`, ...manual] };
  }
  if (onHit.unconsciousFailBy || onHit.unconsciousAtMost) {
    manual.unshift(onHit.unconsciousFailBy ? `The target falls unconscious too if it fails the save by ${onHit.unconsciousFailBy} or more.` : `The target falls unconscious too on a save of ${onHit.unconsciousAtMost} or lower.`);
  }
  const rider: OnHitRider = {
    ...(onHit.save ? { save: onHit.save } : {}),
    ...(onHit.dc ? { dc: onHit.dc } : {}),
    ...(onHit.condition ? { condition: onHit.condition } : {}),
    ...(onHit.alsoCondition ? { alsoCondition: onHit.alsoCondition } : {}),
    ...(onHit.damage ? { damage: onHit.damage, damageType: onHit.damageType } : {}),
    ...(onHit.halfOnSave ? { halfOnSave: true } : {}),
    ...(onHit.escapeDc ? { escapeDc: onHit.escapeDc } : {}),
    ...(onHit.rounds ? { rounds: onHit.rounds } : {}),
    ...(onHit.repeatSave ? { repeatSave: true } : {}),
    ...(onHit.maxSize ? { maxSize: onHit.maxSize } : {}),
    ...(onHit.drainMaxHp ? { drainMaxHp: onHit.drainMaxHp } : {}),
    ...(manual.length ? { manual } : {}),
  };
  return Object.keys(rider).length ? rider : undefined;
}

// The attack as an enemy's stat block holds it.
export function enemyAttackOf(attack: CreatureAttack): EnemyAttack {
  const { expression } = attackDamage(attack);
  const rider = attack.onHit ? enemyRider(attack.onHit) : undefined;
  return {
    name: attack.name,
    toHit: attack.toHit,
    damage: expression,
    type: [attack.type, ...(attack.riders ?? []).map((entry) => entry.type)].join("/"),
    mode: attack.thrown ? "both" : attack.range ? "ranged" : "melee",
    ...(attack.range ? { range: { normal: attack.range, long: attack.longRange ?? attack.range * 4 } } : {}),
    ...(!attack.range || attack.thrown ? { reach: attack.reach ?? 5 } : {}),
    ...(attack.riders?.length ? { riders: attack.riders.map((entry) => ({ dice: entry.dice, type: entry.type })) } : {}),
    ...(rider ? { onHit: rider } : {}),
  };
}
