// The numbers read off a stored block wherever a rule needs one: its size
// against another's, a save's modifier, the passive Perception a hider has
// to beat. Apart from the stat block reader (statblock.ts), so the table's
// own pages load these lines and not the reader of a whole pack row.

import type { EnemyStats, SaveAbility } from "@/lib/bestiary/statblock";

// Size comparison for the grapple/shove cap: a creature can only grab or
// push a target at most one size larger than itself. Unknown sizes read as
// Medium so old stat snapshots stay grabbable.
const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

export function sizeRank(size: string | undefined): number {
  const index = SIZE_ORDER.indexOf((size ?? "").trim().toLowerCase());
  return index === -1 ? SIZE_ORDER.indexOf("medium") : index;
}

// Save modifier for an enemy, with a fallback for stat snapshots taken
// before saveMods existed: dex maps to the stored dexMod, everything else
// scales with CR.
export function saveModFor(stats: EnemyStats, ability: SaveAbility): number {
  const explicit = stats.saveMods?.[ability];
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  if (ability === "dex") {
    return stats.dexMod;
  }
  return Math.min(5, Math.round(stats.cr * 0.3));
}

// An enemy's passive Perception: the 5e formula against its Wisdom. Used by
// the Hide action so a stealth roll is compared to something real rather
// than left to the model's judgement.
// The number a hiding character has to beat. The block's own printed
// passive Perception wins; then its Perception skill; then, for a block
// that says nothing, the Wisdom modifier as before.
export function passivePerceptionFor(stats: EnemyStats): number {
  const printed = stats.senses?.passivePerception;
  if (typeof printed === "number" && Number.isFinite(printed)) {
    return printed;
  }
  const perception = stats.skills?.perception;
  if (typeof perception === "number" && Number.isFinite(perception)) {
    return 10 + perception;
  }
  return 10 + saveModFor(stats, "wis");
}

// The senses a block's Keen trait sharpens ("Keen Hearing and Smell", "Keen
// Sight", "Keen Senses": all three). SRD 5.1: advantage on Wisdom
// (Perception) checks that rely on them.
export function keenSensesOf(stats: Pick<EnemyStats, "traits">): Array<"sight" | "hearing" | "smell"> {
  const senses = new Set<"sight" | "hearing" | "smell">();
  for (const line of stats.traits ?? []) {
    const name = /^keen ([a-z ,]+?)\s*[:.]/i.exec(line.trim())?.[1]?.toLowerCase() ?? "";
    for (const sense of ["sight", "hearing", "smell"] as const) {
      // Tome of Beasts 2 calls smell "scent" ("Keen Scent").
      if (name.includes(sense) || name.startsWith("senses") || (sense === "smell" && name.includes("scent"))) {
        senses.add(sense);
      }
    }
  }
  return [...senses];
}

// The passive Perception a creature watches with when something tries to
// slip past it (a hider, an ambush): advantage is +5 on a passive score
// (SRD 5.1, Passive Checks), and a Keen sense gives it, since sight, sound
// and scent all give a hidden creature away.
export function watchfulPassivePerception(stats: EnemyStats): number {
  return passivePerceptionFor(stats) + (keenSensesOf(stats).length ? 5 : 0);
}
