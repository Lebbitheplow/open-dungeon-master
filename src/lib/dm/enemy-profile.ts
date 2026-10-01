import type { EnemyAttack, EnemyStats, RoutineStep } from "@/lib/bestiary/statblock";

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

const nameKey = (name: string) => name.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();

function findAttack(attacks: EnemyAttack[], wanted: string): EnemyAttack | null {
  const key = wanted.trim().toLowerCase();
  if (!key) {
    return null;
  }
  return (
    attacks.find((attack) => attack.name.toLowerCase() === key) ??
    attacks.find((attack) => nameKey(attack.name) === nameKey(key)) ??
    attacks.find((attack) => attack.name.toLowerCase().includes(key)) ??
    attacks.find((attack) => key.includes(nameKey(attack.name))) ??
    null
  );
}

// A step that follows only a hit (the grick's beak) is marked on the swing,
// and enemy-attack.ts skips it after a miss.
function expand(routine: RoutineStep[], attacks: EnemyAttack[]): EnemyAttack[] {
  return routine.flatMap((step) => {
    const found = findAttack(attacks, step.attack);
    const attack = found && step.ifHit ? { ...found, onlyIfHit: true } : found;
    return attack ? new Array<EnemyAttack>(Math.max(1, Math.min(10, step.count))).fill(attack) : [];
  });
}

// The attacks one enemy_attack call makes, in order. A block with a
// routine walks the routine that holds the attack asked for (the first when
// none is asked for); an attack no routine names is one swing of it, as a
// legendary action's attack is. A block with only a count repeats the
// attack asked for (or its first) that many times.
export function plannedSwings(
  stats: Pick<EnemyStats, "attacks" | "attacksPerTurn" | "routines">,
  attacks: EnemyAttack[],
  requested: string | undefined,
  options: { single?: boolean } = {},
): EnemyAttack[] {
  if (!attacks.length) {
    return [];
  }
  const asked = requested ? findAttack(attacks, requested) : null;
  if (options.single) {
    return [asked ?? attacks[0]];
  }
  const routines = (stats.routines ?? []).map((routine) => expand(routine, attacks)).filter((swings) => swings.length);
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
