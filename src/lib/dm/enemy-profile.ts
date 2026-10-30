import type { EnemyAttack, EnemyStats, RoutineStep } from "@/lib/bestiary/statblock";
import { textKey } from "@/lib/language/text-logic";

// How an enemy's attack reaches (SRD 5.1, Monsters: melee or ranged, reach,
// normal and long range) and which attacks a turn of it makes (its
// Multiattack routine). Pure: enemy-attack.ts and enemy-approach.ts read it,
// and opportunity.ts asks it for an enemy's reach.
//
// A block parsed from its printed text carries mode, reach and range. One
// written by hand or snapshotted before those fields keeps the old reading:
// ranged by the attack's name, 60 feet, reach from a "reach 10 ft" anywhere
// in its name or traits.

const TILE_FEET = 5;

const RANGED_ATTACK_RE =
  /bow|crossbow|sling|dart|javelin|thrown|spit|spine|rifle|pistol|gun|blast|bolt|ray|breath|web|rock|spear of|longarm/i;
const FALLBACK_RANGE_TILES = 12;

// Whether an enemy attack name reads as a ranged attack: the reading for a
// block that does not say.
export function isRangedAttackName(attackName: string): boolean {
  return RANGED_ATTACK_RE.test(attackName);
}

export type EnemyAttackProfile = {
  melee: boolean;
  ranged: boolean;
  reachTiles: number;
  rangeTiles: number;
  longRangeTiles: number;
};

export function enemyAttackProfile(attack: EnemyAttack, traits: string[] = []): EnemyAttackProfile {
  if (!attack.mode) {
    const ranged = isRangedAttackName(attack.name);
    const reach = /reach 1[05] ft/i.test(`${attack.name} ${traits.join(" ")}`) ? 2 : 1;
    return {
      melee: !ranged,
      ranged,
      reachTiles: reach,
      rangeTiles: FALLBACK_RANGE_TILES,
      longRangeTiles: FALLBACK_RANGE_TILES,
    };
  }
  const melee = attack.mode !== "ranged";
  const ranged = attack.mode !== "melee";
  const normal = attack.range ? Math.max(1, Math.floor(attack.range.normal / TILE_FEET)) : FALLBACK_RANGE_TILES;
  const long = attack.range ? Math.max(normal, Math.floor(attack.range.long / TILE_FEET)) : normal;
  return {
    melee,
    ranged,
    reachTiles: melee ? Math.max(1, Math.floor((attack.reach ?? TILE_FEET) / TILE_FEET)) : 0,
    rangeTiles: ranged ? normal : 0,
    longRangeTiles: ranged ? long : 0,
  };
}

// The first melee attack of a block, the one an opportunity attack is made
// with, and its reach in squares. Null when the block has no melee attack.
export function opportunityWeapon(stats: Pick<EnemyStats, "attacks" | "traits">): { attack: EnemyAttack; reachTiles: number } | null {
  for (const attack of stats.attacks ?? []) {
    const profile = enemyAttackProfile(attack, stats.traits ?? []);
    if (profile.melee) {
      return { attack, reachTiles: profile.reachTiles };
    }
  }
  return null;
}

// How one swing is made from `distance` squares away: in melee within
// reach, ranged within long range (at disadvantage past normal range), or
// not at all. Null distance means no board: the attack's own kind decides.
export function swingMode(
  profile: EnemyAttackProfile,
  distance: number | null,
): { ranged: boolean; longRange: boolean } | null {
  if (distance === null) {
    return { ranged: !profile.melee, longRange: false };
  }
  if (profile.melee && distance <= profile.reachTiles) {
    return { ranged: false, longRange: false };
  }
  if (profile.ranged && distance <= profile.longRangeTiles) {
    return { ranged: true, longRange: distance > profile.rangeTiles };
  }
  return null;
}

const attackKey = (name: string) => textKey(name.replace(/\([^)]*\)/g, ""));

// The attack a name is, whole, with or without a tag in brackets ("Fire
// Breath (Recharge 5-6)"). Null for any other name: never the attack whose
// name holds it, nor the first.
export function attackNamed(attacks: EnemyAttack[], wanted: string): EnemyAttack | null {
  const key = textKey(wanted);
  if (!key) {
    return null;
  }
  return attacks.find((attack) => textKey(attack.name) === key || attackKey(attack.name) === attackKey(wanted)) ?? null;
}

// A step that follows only a hit (the grick's beak) is marked on the swing,
// and enemy-attack.ts skips it after a miss. A step whose count is rolled
// (a violet fungus's 1d4 Rotting Touches) is rolled by `rollCount` when the
// caller makes the swings, and is its average count for a caller that only
// shows them.
function expand(routine: RoutineStep[], attacks: EnemyAttack[], rollCount?: (dice: string) => number): EnemyAttack[] {
  return routine.flatMap((step) => {
    const found = attackNamed(attacks, step.attack);
    const attack = found && step.ifHit ? { ...found, onlyIfHit: true } : found;
    const count = step.dice && rollCount ? rollCount(step.dice) : step.count;
    return attack ? new Array<EnemyAttack>(Math.max(1, Math.min(10, count))).fill(attack) : [];
  });
}

// The attacks one enemy_attack call makes, in order, for the attack asked
// for (attackNamed: the caller refuses a name it is not). A block with a
// routine walks the routine that holds the attack asked for (the first when
// none is asked for); an attack no routine names is one swing of it, as a
// legendary action's attack is. A block with only a count repeats the
// attack asked for (or its first) that many times. A single swing is the
// one asked for, which the caller requires of a block with several.
// The blow a swing deals: the block's own, or what it prints instead at half
// its hit points or fewer ("or 5 (2d4) piercing damage if the swarm has half
// of its hit points or fewer") or at range ("in melee or 5 (1d6 + 2)
// piercing damage at range"). The bloodied blow wins when both apply.
export function alternativeBlow(attack: EnemyAttack, when: { ranged: boolean; bloodied: boolean }): EnemyAttack {
  const alternatives = attack.alternatives ?? [];
  const chosen =
    (when.bloodied ? alternatives.find((entry) => entry.when === "bloodied") : undefined) ??
    (when.ranged ? alternatives.find((entry) => entry.when === "ranged") : undefined);
  if (!chosen) {
    return attack;
  }
  const blow: EnemyAttack = { ...attack, damage: chosen.damage, type: chosen.type };
  if (chosen.riders?.length) {
    blow.riders = chosen.riders;
  } else {
    delete blow.riders;
  }
  return blow;
}

export function plannedSwings(
  stats: Pick<EnemyStats, "attacks" | "attacksPerTurn" | "routines">,
  attacks: EnemyAttack[],
  asked: EnemyAttack | null,
  options: { single?: boolean; rollCount?: (dice: string) => number } = {},
): EnemyAttack[] {
  if (!attacks.length) {
    return [];
  }
  if (options.single) {
    return [asked ?? attacks[0]];
  }
  const routines = (stats.routines ?? []).map((routine) => expand(routine, attacks, options.rollCount)).filter((swings) => swings.length);
  if (routines.length) {
    if (!asked) {
      return routines[0];
    }
    const holding = routines.find((swings) => swings.includes(asked));
    return holding ?? [asked];
  }
  const count = Math.max(1, Math.min(10, Math.floor(stats.attacksPerTurn ?? 1)));
  return new Array<EnemyAttack>(count).fill(asked ?? attacks[0]);
}

// Whether a creature is charmed by `sourceId`: a charmed creature cannot
// attack its charmer or target it with harmful abilities or magic (SRD 5.1,
// Charmed). Only a charm that names its source binds.
export function charmedBy(
  conditions: string[],
  meta: Record<string, { source?: string } | undefined> | undefined,
  sourceId: string,
): boolean {
  const charmed = conditions.find((entry) => entry.toLowerCase() === "charmed");
  return Boolean(charmed && meta?.[charmed]?.source && meta[charmed]?.source === sourceId);
}
