import { isValidExpression } from "@/lib/dice";
import { xpForCr } from "@/lib/srd/encounter-math";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import { crLabel, deriveCr, expectedFor, type DerivedCr } from "@/lib/bestiary/derive-cr";
import type {
  EnemyAttack,
  EnemySaveMods,
  EnemyStats,
  SaveAbility,
} from "@/lib/bestiary/statblock";

// The monster a person writes, and the rules for turning it into the stat
// block the engine fights with.
//
// A draft IS an EnemyStats with a name on it. That is the whole design: the
// engine snapshots EnemyStats into stat_json when a fight starts
// (src/lib/bestiary/statblock.ts), so a hand-built monster stored in that
// shape needs no translation to reach the table, and nothing here can invent
// a field the fight would ignore.
//
// Pure: no DB and no I/O. The homebrew_entries rim is
// src/lib/bestiary/homebrew-monsters.ts.

export const MONSTER_NAME_MAX = 80;
export const MAX_ATTACKS = 4;
// Six was room for a hand-typed monster. A boss assembled out of the
// catalogue (src/lib/bestiary/kit.ts) spends several on ancestry traits
// before it has said anything about itself, and still wants its legendary
// and lair actions, so the box is twice the size. Only an input cap: nothing
// stored gets longer on its own.
//
// The cost is prompt length, because every trait on a live enemy is printed
// into the DM's turn (src/lib/dm/prompt.ts). It is bounded and it is opt-in:
// a monster only carries twelve if somebody put twelve on it, and the
// Open5e side still stops at four (src/lib/bestiary/statblock.ts).
export const MAX_TRAITS = 12;
export const TRAIT_MAX = 200;
export const ATTACK_NAME_MAX = 40;
export const DAMAGE_TYPE_MAX = 40;
export const RESIST_MAX = 200;

export const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"] as const;

export const SAVE_ABILITIES: readonly SaveAbility[] = ["str", "dex", "con", "int", "wis", "cha"];

export type MonsterDraft = {
  name: string;
  stats: EnemyStats;
  // Damage the attack list cannot express, averaged per round: the breath
  // weapon, the round of spellcasting, the sneak attack. Kept beside the
  // stats rather than inside them because the ENGINE has no use for it (it
  // runs the attack list), while the RATING is wrong without it. The DMG
  // asks for the same number in the same place, as a by-hand step.
  extraDamagePerRound: number;
};

// null, undefined and "" all coerce to 0 in JavaScript, which at a boundary
// would silently turn a missing hit point count into a monster with one hit
// point. Only something that is actually a number counts as one.
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.round(number)))
    : fallback;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// ---- attacks ----

// An attack whose damage the dice engine cannot parse is not a weaker
// attack, it is an attack that throws mid-fight. Refused at the boundary,
// where a person can still fix it.
export function checkAttack(raw: unknown): { attack: EnemyAttack } | { error: string } {
  const source = (raw ?? {}) as Partial<EnemyAttack>;
  const name = text(source.name, ATTACK_NAME_MAX);
  if (!name) {
    return { error: "An attack needs a name." };
  }
  const damage = String(source.damage ?? "").replace(/\s+/g, "");
  if (!damage) {
    return { error: `${name} has no damage.` };
  }
  if (!isValidExpression(damage)) {
    return { error: `"${damage}" is not a dice expression the table can roll.` };
  }
  return {
    attack: {
      name,
      toHit: clamp(source.toHit, -5, 20, 0),
      damage,
      type: text(source.type, DAMAGE_TYPE_MAX) || "untyped",
    },
  };
}

function normalizeSaves(raw: unknown): EnemySaveMods {
  const source = (raw ?? {}) as Partial<Record<SaveAbility, unknown>>;
  return Object.fromEntries(
    SAVE_ABILITIES.map((ability) => [ability, clamp(source[ability], -5, 15, 0)]),
  ) as EnemySaveMods;
}

// ---- the draft ----

export type DraftCheck = { draft: MonsterDraft } | { error: string };

// Everything a client can send, checked. The one rule with teeth is the
// damage expression; the rest clamps, because a DM who types 900 hit points
// meant a tough monster and should get one, not an error.
export function checkMonsterDraft(raw: unknown): DraftCheck {
  const source = (raw ?? {}) as Record<string, unknown>;
  const name = text(source.name, MONSTER_NAME_MAX);
  if (!name) {
    return { error: "A monster needs a name." };
  }

  const attacks: EnemyAttack[] = [];
  const rawAttacks = Array.isArray(source.attacks) ? source.attacks.slice(0, MAX_ATTACKS) : [];
  for (const entry of rawAttacks) {
    const checked = checkAttack(entry);
    if ("error" in checked) {
      return checked;
    }
    attacks.push(checked.attack);
  }

  const cr = Math.min(30, Math.max(0, Number(source.cr) || 0));
  const size = SIZES.find((option) => option === text(source.size, 20)) ?? "Medium";
  const stats: EnemyStats = {
    ac: clamp(source.ac, 1, 30, 12),
    maxHp: clamp(source.maxHp, 1, 1000, 10),
    dexMod: clamp(source.dexMod, -5, 10, 0),
    saveMods: normalizeSaves(source.saveMods),
    speed: text(source.speed, 60) || "30",
    attacks,
    traits: (Array.isArray(source.traits) ? source.traits : [])
      .slice(0, MAX_TRAITS)
      .map((trait) => text(trait, TRAIT_MAX))
      .filter(Boolean),
    resist: text(source.resist, RESIST_MAX),
    immune: text(source.immune, RESIST_MAX),
    vulnerable: text(source.vulnerable, RESIST_MAX),
    conditionImmune: text(source.conditionImmune, RESIST_MAX),
    cr,
    // Never taken from the client: XP is a function of CR and a row where
    // they disagree would quietly break every encounter budget it appears in.
    xp: xpForCr(cr),
    attacksPerTurn: clamp(source.attacksPerTurn, 1, 3, 1),
    size,
  };

  return {
    draft: {
      name,
      stats,
      extraDamagePerRound: clamp(source.extraDamagePerRound, 0, 400, 0),
    },
  };
}

// ---- where a draft starts ----

// From a challenge rating: the DMG baseline the AI DM already uses for
// enemies it invents, so a monster started this way begins life at exactly
// the numbers its rating expects and every edit is a visible departure.
export function draftFromCr(name: string, cr: number): MonsterDraft {
  return {
    name,
    stats: { ...synthesizeStats(cr), size: "Medium" },
    extraDamagePerRound: 0,
  };
}

// From something that already exists: any of the Open5e monsters, or another
// homebrew one. The stats travel verbatim, because the point of starting
// from an owlbear is to have an owlbear on the screen before changing it.
export function draftFromStats(name: string, stats: EnemyStats): MonsterDraft {
  return {
    name,
    stats: { ...stats, size: stats.size ?? "Medium" },
    extraDamagePerRound: 0,
  };
}

export function blankDraft(): MonsterDraft {
  return draftFromCr("", 1);
}

// ---- what the editor shows back ----

export type MonsterReadout = {
  derived: DerivedCr;
  // The rating written on the block against the rating the numbers support.
  // A DM is allowed to disagree with the calculator; they are not allowed to
  // do it by accident.
  statedCr: number;
  agrees: boolean;
  // How the block compares to the DMG row for the rating it claims.
  against: {
    label: string;
    stat: string;
    expected: string;
    verdict: "under" | "as expected" | "over";
  }[];
};

function compare(value: number, expected: number, tolerance: number) {
  if (value < expected - tolerance) {
    return "under" as const;
  }
  return value > expected + tolerance ? ("over" as const) : ("as expected" as const);
}

export function readMonster(draft: MonsterDraft): MonsterReadout {
  const derived = deriveCr(draft.stats, {
    extraDamagePerRound: draft.extraDamagePerRound,
  });
  const row = expectedFor(draft.stats.cr);
  const hpMid = Math.round((row.hpMin + row.hpMax) / 2);
  const damageMid = Math.round((row.damageMin + row.damageMax) / 2);
  return {
    derived,
    statedCr: draft.stats.cr,
    agrees: derived.cr === draft.stats.cr,
    against: [
      {
        label: "Hit points",
        stat: String(draft.stats.maxHp),
        expected: `${row.hpMin} to ${row.hpMax}`,
        verdict: compare(draft.stats.maxHp, hpMid, hpMid - row.hpMin),
      },
      {
        label: "Armour class",
        stat: String(draft.stats.ac),
        expected: String(row.ac),
        verdict: compare(draft.stats.ac, row.ac, 0),
      },
      {
        label: "Damage per round",
        stat: derived.damage.perRound.toFixed(1),
        expected: `${row.damageMin} to ${row.damageMax}`,
        verdict: compare(derived.damage.perRound, damageMid, damageMid - row.damageMin),
      },
      {
        label: "Attack bonus",
        stat: derived.damage.attackName ? `+${derived.damage.attackBonus}` : "none",
        expected: `+${row.attack}`,
        verdict: compare(derived.damage.attackBonus, row.attack, 0),
      },
    ],
  };
}

// A one-line summary for the list, so a roster of thirty monsters reads
// without opening any of them.
export function describeMonster(draft: MonsterDraft): string {
  const readout = readMonster(draft);
  const claimed = `CR ${crLabel(draft.stats.cr)}`;
  const suffix = readout.agrees
    ? ""
    : `, the numbers say CR ${crLabel(readout.derived.cr)}`;
  return `${claimed}, AC ${draft.stats.ac}, ${draft.stats.maxHp} hp${suffix}`;
}

// ---- storage ----

// homebrew_entries.data is a loose JSON blob shared by seven kinds
// (src/lib/schemas/homebrew.ts), so a monster stores its stat block under
// one key rather than spreading EnemyStats fields across a bag that spells
// and magic items also live in.
export type MonsterData = {
  desc: string;
  stats: EnemyStats;
  extraDamagePerRound: number;
};

export function draftToData(draft: MonsterDraft, desc: string): MonsterData {
  return {
    desc: desc.slice(0, 8_000),
    stats: draft.stats,
    extraDamagePerRound: draft.extraDamagePerRound,
  };
}

// Reads a stored row back. Anything unreadable falls back to a CR 1 baseline
// rather than throwing, because a monster that cannot be opened cannot be
// fixed either.
export function draftFromData(name: string, data: unknown): MonsterDraft {
  const source = (data ?? {}) as Partial<MonsterData>;
  const checked = checkMonsterDraft({
    name,
    ...(source.stats ?? {}),
    extraDamagePerRound: source.extraDamagePerRound,
  });
  return "error" in checked ? draftFromCr(name || "Monster", 1) : checked.draft;
}
