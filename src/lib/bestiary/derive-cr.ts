import { averageOf } from "@/lib/srd/odds";
import { xpForCr } from "@/lib/srd/encounter-math";
import type { EnemyStats } from "@/lib/bestiary/statblock";

// Stats to challenge rating: the inverse of synthesize.ts.
//
// synthesizeStats goes CR to stats, which is what the AI DM needs when it
// invents an enemy. A person building a monster works the other way: they
// write the thing they pictured and then have to know what it costs. Without
// this, a hand-built monster has no honest difficulty number, and every
// number the encounter workbench prints downstream would be resting on a CR
// the DM guessed.
//
// The method is the DMG's own (Dungeon Master's Guide, "Creating a Monster"):
// a defensive CR from effective hit points, nudged by armour class, an
// offensive CR from damage per round, nudged by attack bonus, and the two
// averaged. It is deliberately the published procedure rather than a better
// one, because a DM who disagrees with the number needs to be able to look up
// why it says what it says, and every part is reported for exactly that.
//
// Pure: no DB, no model, no dice.

export type CrRow = {
  cr: number;
  prof: number;
  // The armour class a monster of this rating is expected to have.
  ac: number;
  hpMin: number;
  hpMax: number;
  attack: number;
  damageMin: number;
  damageMax: number;
  saveDc: number;
};

// "Monster Statistics by Challenge Rating". The hit point and damage bands
// are the table's own; everything else is the expected value for that row.
export const CR_TABLE: readonly CrRow[] = [
  { cr: 0, prof: 2, ac: 13, hpMin: 1, hpMax: 6, attack: 3, damageMin: 0, damageMax: 1, saveDc: 13 },
  { cr: 0.125, prof: 2, ac: 13, hpMin: 7, hpMax: 35, attack: 3, damageMin: 2, damageMax: 3, saveDc: 13 },
  { cr: 0.25, prof: 2, ac: 13, hpMin: 36, hpMax: 49, attack: 3, damageMin: 4, damageMax: 5, saveDc: 13 },
  { cr: 0.5, prof: 2, ac: 13, hpMin: 50, hpMax: 70, attack: 3, damageMin: 6, damageMax: 8, saveDc: 13 },
  { cr: 1, prof: 2, ac: 13, hpMin: 71, hpMax: 85, attack: 3, damageMin: 9, damageMax: 14, saveDc: 13 },
  { cr: 2, prof: 2, ac: 13, hpMin: 86, hpMax: 100, attack: 3, damageMin: 15, damageMax: 20, saveDc: 13 },
  { cr: 3, prof: 2, ac: 13, hpMin: 101, hpMax: 115, attack: 4, damageMin: 21, damageMax: 26, saveDc: 13 },
  { cr: 4, prof: 2, ac: 14, hpMin: 116, hpMax: 130, attack: 5, damageMin: 27, damageMax: 32, saveDc: 14 },
  { cr: 5, prof: 3, ac: 15, hpMin: 131, hpMax: 145, attack: 6, damageMin: 33, damageMax: 38, saveDc: 15 },
  { cr: 6, prof: 3, ac: 15, hpMin: 146, hpMax: 160, attack: 6, damageMin: 39, damageMax: 44, saveDc: 15 },
  { cr: 7, prof: 3, ac: 15, hpMin: 161, hpMax: 175, attack: 6, damageMin: 45, damageMax: 50, saveDc: 15 },
  { cr: 8, prof: 3, ac: 16, hpMin: 176, hpMax: 190, attack: 7, damageMin: 51, damageMax: 56, saveDc: 16 },
  { cr: 9, prof: 4, ac: 16, hpMin: 191, hpMax: 205, attack: 7, damageMin: 57, damageMax: 62, saveDc: 16 },
  { cr: 10, prof: 4, ac: 17, hpMin: 206, hpMax: 220, attack: 7, damageMin: 63, damageMax: 68, saveDc: 16 },
  { cr: 11, prof: 4, ac: 17, hpMin: 221, hpMax: 235, attack: 8, damageMin: 69, damageMax: 74, saveDc: 17 },
  { cr: 12, prof: 4, ac: 17, hpMin: 236, hpMax: 250, attack: 8, damageMin: 75, damageMax: 80, saveDc: 17 },
  { cr: 13, prof: 5, ac: 18, hpMin: 251, hpMax: 265, attack: 8, damageMin: 81, damageMax: 86, saveDc: 18 },
  { cr: 14, prof: 5, ac: 18, hpMin: 266, hpMax: 280, attack: 8, damageMin: 87, damageMax: 92, saveDc: 18 },
  { cr: 15, prof: 5, ac: 18, hpMin: 281, hpMax: 295, attack: 8, damageMin: 93, damageMax: 98, saveDc: 18 },
  { cr: 16, prof: 5, ac: 18, hpMin: 296, hpMax: 310, attack: 9, damageMin: 99, damageMax: 104, saveDc: 18 },
  { cr: 17, prof: 6, ac: 19, hpMin: 311, hpMax: 325, attack: 10, damageMin: 105, damageMax: 110, saveDc: 19 },
  { cr: 18, prof: 6, ac: 19, hpMin: 326, hpMax: 340, attack: 10, damageMin: 111, damageMax: 116, saveDc: 19 },
  { cr: 19, prof: 6, ac: 19, hpMin: 341, hpMax: 355, attack: 10, damageMin: 117, damageMax: 122, saveDc: 19 },
  { cr: 20, prof: 6, ac: 19, hpMin: 356, hpMax: 400, attack: 10, damageMin: 123, damageMax: 140, saveDc: 19 },
  { cr: 21, prof: 7, ac: 19, hpMin: 401, hpMax: 445, attack: 11, damageMin: 141, damageMax: 158, saveDc: 20 },
  { cr: 22, prof: 7, ac: 19, hpMin: 446, hpMax: 490, attack: 11, damageMin: 159, damageMax: 176, saveDc: 20 },
  { cr: 23, prof: 7, ac: 19, hpMin: 491, hpMax: 535, attack: 11, damageMin: 177, damageMax: 194, saveDc: 20 },
  { cr: 24, prof: 7, ac: 19, hpMin: 536, hpMax: 580, attack: 12, damageMin: 195, damageMax: 212, saveDc: 21 },
  { cr: 25, prof: 8, ac: 19, hpMin: 581, hpMax: 625, attack: 12, damageMin: 213, damageMax: 230, saveDc: 21 },
  { cr: 26, prof: 8, ac: 19, hpMin: 626, hpMax: 670, attack: 12, damageMin: 231, damageMax: 248, saveDc: 21 },
  { cr: 27, prof: 8, ac: 19, hpMin: 671, hpMax: 715, attack: 13, damageMin: 249, damageMax: 266, saveDc: 22 },
  { cr: 28, prof: 8, ac: 19, hpMin: 716, hpMax: 760, attack: 13, damageMin: 267, damageMax: 284, saveDc: 22 },
  { cr: 29, prof: 9, ac: 19, hpMin: 761, hpMax: 805, attack: 13, damageMin: 285, damageMax: 302, saveDc: 22 },
  { cr: 30, prof: 9, ac: 19, hpMin: 806, hpMax: 850, attack: 14, damageMin: 303, damageMax: 320, saveDc: 23 },
];

// The CR ladder is not the number line: the four steps below CR 1 are an
// eighth of a rating apart and everything above is a whole one. Averaging
// two ratings therefore has to happen in ROW POSITIONS, or a defensive CR of
// 1/8 and an offensive CR of 2 would average to 1.06 and land nowhere.
function rowAt(index: number): CrRow {
  return CR_TABLE[Math.min(CR_TABLE.length - 1, Math.max(0, index))];
}

// The row a stated CR sits on. Third-party monsters carry ratings the table
// does not list, so the nearest row wins, the same way xpForCr does.
export function crRowIndex(cr: number): number {
  let best = 0;
  for (let index = 0; index < CR_TABLE.length; index += 1) {
    if (Math.abs(CR_TABLE[index].cr - cr) < Math.abs(CR_TABLE[best].cr - cr)) {
      best = index;
    }
  }
  return best;
}

// The whole DMG row for a rating: what the monster editor shows a DM who
// asked to start from a CR rather than from an existing creature.
export function expectedFor(cr: number): CrRow {
  return CR_TABLE[crRowIndex(cr)];
}

export type CrPart = {
  label: string;
  value: string;
  // Where the number came from, in a sentence a DM can check.
  detail: string;
};

export type HalfCr = {
  // The rating this half of the calculation arrived at.
  cr: number;
  rowIndex: number;
  // The row the raw number landed in, before the second stat adjusted it.
  baseCr: number;
  // Rows moved by the armour class or attack bonus, signed.
  adjustment: number;
  parts: CrPart[];
};

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function crLabel(cr: number): string {
  if (cr === 0.125) {
    return "1/8";
  }
  if (cr === 0.25) {
    return "1/4";
  }
  if (cr === 0.5) {
    return "1/2";
  }
  return String(cr);
}

export { crLabel };

// Defensive CR: which hit point band the monster falls in, then one rating
// per 2 points its armour class differs from what that band expects.
export function defensiveCr(effectiveHp: number, ac: number): HalfCr {
  const hp = Math.max(1, Math.round(effectiveHp));
  let index = CR_TABLE.length - 1;
  for (let row = 0; row < CR_TABLE.length; row += 1) {
    if (hp <= CR_TABLE[row].hpMax) {
      index = row;
      break;
    }
  }
  const base = rowAt(index);
  const adjustment = Math.round((ac - base.ac) / 2);
  const final = rowAt(index + adjustment);
  return {
    cr: final.cr,
    rowIndex: crRowIndex(final.cr),
    baseCr: base.cr,
    adjustment,
    parts: [
      {
        label: "Hit points",
        value: `${hp}`,
        detail: `${hp} hit points is the CR ${crLabel(base.cr)} band (${base.hpMin} to ${base.hpMax}).`,
      },
      {
        label: "Armour class",
        value: `${ac}`,
        detail:
          adjustment === 0
            ? `AC ${ac} is what CR ${crLabel(base.cr)} expects, so it moves nothing.`
            : `AC ${ac} against the expected ${base.ac} is ${signed(adjustment)} rating${
                Math.abs(adjustment) === 1 ? "" : "s"
              }, one per 2 points.`,
      },
    ],
  };
}

// Offensive CR: which damage-per-round band, then one rating per 2 points the
// attack bonus differs from what that band expects.
export function offensiveCr(damagePerRound: number, attackBonus: number): HalfCr {
  const dpr = Math.max(0, Math.round(damagePerRound));
  let index = CR_TABLE.length - 1;
  for (let row = 0; row < CR_TABLE.length; row += 1) {
    if (dpr <= CR_TABLE[row].damageMax) {
      index = row;
      break;
    }
  }
  const base = rowAt(index);
  const adjustment = Math.round((attackBonus - base.attack) / 2);
  const final = rowAt(index + adjustment);
  return {
    cr: final.cr,
    rowIndex: crRowIndex(final.cr),
    baseCr: base.cr,
    adjustment,
    parts: [
      {
        label: "Damage per round",
        value: `${dpr}`,
        detail: `${dpr} damage a round is the CR ${crLabel(base.cr)} band (${base.damageMin} to ${base.damageMax}).`,
      },
      {
        label: "Attack bonus",
        value: signed(attackBonus),
        detail:
          adjustment === 0
            ? `${signed(attackBonus)} is what CR ${crLabel(base.cr)} expects, so it moves nothing.`
            : `${signed(attackBonus)} against the expected ${signed(base.attack)} is ${signed(
                adjustment,
              )} rating${Math.abs(adjustment) === 1 ? "" : "s"}, one per 2 points.`,
      },
    ],
  };
}

// ---- effective hit points ----

// The damage types the DMG calls common enough that resisting them is worth
// hit points. A monster resistant to psychic alone is not tougher in any
// fight the party will actually have.
const COMMON_TYPES = [
  "bludgeoning",
  "piercing",
  "slashing",
  "fire",
  "cold",
  "acid",
  "lightning",
  "thunder",
  "poison",
  "necrotic",
  "radiant",
  "force",
];

export function countCommonTypes(text: string): number {
  const lowered = (text ?? "").toLowerCase();
  return COMMON_TYPES.filter((type) => lowered.includes(type)).length;
}

// The DMG's own multipliers, which depend on the rating the monster is
// heading for: resistance is worth a great deal at low level and almost
// nothing at high, because by then the party is dealing damage it cannot
// resist anyway.
function resistanceMultiplier(cr: number, immune: boolean): number {
  if (cr <= 4) {
    return 2;
  }
  if (cr <= 10) {
    return immune ? 2 : 1.5;
  }
  if (cr <= 16) {
    return immune ? 1.5 : 1.25;
  }
  return immune ? 1.25 : 1;
}

// Three or more common types is the DMG's threshold for the multiplier
// applying at all. Below that the resistance is situational and the rating
// stays where the raw hit points put it.
const RESIST_THRESHOLD = 3;

export type EffectiveHp = {
  hp: number;
  multiplier: number;
  note: string;
};

// Hit points as they will actually feel, given what the monster shrugs off.
// `assumedCr` is the rating the multiplier is chosen for, which is circular
// by the DMG's own construction: it tells you to use the rating you expect.
// deriveCr resolves that by running the whole calculation twice.
export function effectiveHp(stats: EnemyStats, assumedCr: number): EffectiveHp {
  const immuneTypes = countCommonTypes(stats.immune ?? "");
  const resistTypes = countCommonTypes(stats.resist ?? "");
  if (immuneTypes >= RESIST_THRESHOLD) {
    const multiplier = resistanceMultiplier(assumedCr, true);
    return {
      hp: Math.round(stats.maxHp * multiplier),
      multiplier,
      note: `Immune to ${immuneTypes} common damage types, worth x${multiplier} hit points around CR ${crLabel(
        expectedFor(assumedCr).cr,
      )}.`,
    };
  }
  if (resistTypes >= RESIST_THRESHOLD) {
    const multiplier = resistanceMultiplier(assumedCr, false);
    return {
      hp: Math.round(stats.maxHp * multiplier),
      multiplier,
      note: `Resistant to ${resistTypes} common damage types, worth x${multiplier} hit points around CR ${crLabel(
        expectedFor(assumedCr).cr,
      )}.`,
    };
  }
  return { hp: stats.maxHp, multiplier: 1, note: "" };
}

// ---- damage per round ----

export type DamageOutput = {
  perRound: number;
  attackName: string;
  swings: number;
  perSwing: number;
  attackBonus: number;
  // Damage the DM added by hand for something the attack list cannot hold.
  extra: number;
  // What the number could not account for, said out loud.
  notes: string[];
};

// Everything a stat block can do that its attack list does not express. The
// DMG's procedure says to fold these in by hand, and this is the detection
// that tells a DM WHICH hand-folding this particular monster needs. Checked
// against the SRD: the ratings this method misses by more than one step are
// almost entirely spellcasters, breath weapons and sneak attacks, and they
// all announce themselves here.
function uncountedDamage(stats: EnemyStats): string[] {
  const notes: string[] = [];
  const traits = stats.traits ?? [];
  if (traits.some((trait) => /spellcasting|innate spell/i.test(trait))) {
    notes.push(
      "This one casts spells, and spell damage is not in the attack list. Add its usual round of casting as extra damage or the rating will read low.",
    );
  }
  // Dice in a trait are the obvious case. The wording is the less obvious
  // one: a stat block's traits are stored truncated
  // (src/lib/bestiary/statblock.ts keeps 140 characters), and a dragon's
  // breath weapon buries its dice well past the cut, so half the SRD dragons
  // would otherwise pass this silently.
  if (traits.some((trait) => /\d+d\d+|recharge|breath/i.test(trait))) {
    notes.push(
      "There are dice in the traits (a breath weapon, a save-for-half effect, a sneak attack). The DMG averages those over the first three rounds and adds them by hand.",
    );
  }
  return notes;
}

// A monster's routine, read the way the engine actually runs it: ONE attack,
// swung `attacksPerTurn` times, capped at three
// (src/lib/dm/encounter-tools.ts). Mirroring the engine rather than the
// stat block matters, because a rating derived from a routine the table will
// never execute is a rating about a different monster.
export function damagePerRound(stats: EnemyStats, extra = 0): DamageOutput {
  const added = Math.max(0, Math.round(extra));
  const notes = added > 0 ? [] : uncountedDamage(stats);
  const attacks = stats.attacks ?? [];
  if (!attacks.length) {
    return {
      perRound: added,
      attackName: "",
      swings: 0,
      perSwing: 0,
      attackBonus: 0,
      extra: added,
      notes: added
        ? notes
        : [...notes, "No attacks, so the offensive rating rests on nothing."],
    };
  }
  // The best attack, because that is the one a monster uses.
  let best = attacks[0];
  let bestAverage = averageOf(best.damage);
  for (const attack of attacks.slice(1)) {
    const average = averageOf(attack.damage);
    if (average > bestAverage) {
      best = attack;
      bestAverage = average;
    }
  }
  const swings = Math.max(1, Math.min(3, stats.attacksPerTurn ?? 1));
  if ((stats.attacksPerTurn ?? 1) > 3) {
    notes.push("The engine caps a multiattack at three swings, so that is what this counts.");
  }
  return {
    perRound: bestAverage * swings + added,
    attackName: best.name,
    swings,
    perSwing: bestAverage,
    attackBonus: best.toHit,
    extra: added,
    notes,
  };
}

// ---- the whole thing ----

export type DerivedCr = {
  cr: number;
  xp: number;
  defensive: HalfCr;
  offensive: HalfCr;
  damage: DamageOutput;
  effectiveHp: EffectiveHp;
  parts: CrPart[];
  notes: string[];
  // How far the derived rating sits from the one written on the stat block,
  // in table rows. Zero means they agree.
  statedCr: number;
  drift: number;
};

function combine(defensive: HalfCr, offensive: HalfCr): CrRow {
  // Rounding half up, so a monster between two ratings is priced as the
  // harder one. A fight that turns out easier than the budget said is a
  // disappointment; one that turns out harder is a dead character.
  return rowAt(Math.round((defensive.rowIndex + offensive.rowIndex) / 2));
}

// `extraDamagePerRound` is the DMG's own by-hand step, made explicit: the
// breath weapon averaged over three rounds, the round of spellcasting, the
// sneak attack. Left at zero the rating is what the attack list alone is
// worth, and `notes` says which of those the monster has.
export function deriveCr(
  stats: EnemyStats,
  options: { extraDamagePerRound?: number } = {},
): DerivedCr {
  const damage = damagePerRound(stats, options.extraDamagePerRound ?? 0);

  // Pass one prices the monster with its raw hit points, only to learn which
  // band its resistances should be valued in. Pass two is the answer. The
  // DMG has the same loop in it and resolves it by eye.
  const firstHp = effectiveHp(stats, stats.cr ?? 0);
  const first = combine(
    defensiveCr(firstHp.hp, stats.ac),
    offensiveCr(damage.perRound, damage.attackBonus),
  );

  const hp = effectiveHp(stats, first.cr);
  const defensive = defensiveCr(hp.hp, stats.ac);
  const offensive = offensiveCr(damage.perRound, damage.attackBonus);
  const final = combine(defensive, offensive);

  const statedCr = stats.cr ?? 0;
  const parts: CrPart[] = [
    ...defensive.parts,
    ...(hp.multiplier !== 1
      ? [{ label: "Toughness", value: `x${hp.multiplier}`, detail: hp.note }]
      : []),
    ...(damage.attackName
      ? [
          {
            label: "The routine",
            value: `${damage.swings} x ${damage.perSwing.toFixed(1)}`,
            detail: `${damage.swings} swing${damage.swings === 1 ? "" : "s"} of ${
              damage.attackName
            } at ${damage.perSwing.toFixed(1)} average${
              damage.extra ? `, plus ${damage.extra} added by hand` : ""
            }.`,
          },
        ]
      : []),
    ...offensive.parts,
    {
      label: "The average",
      value: `CR ${crLabel(final.cr)}`,
      detail: `Defensive CR ${crLabel(defensive.cr)} and offensive CR ${crLabel(
        offensive.cr,
      )}, averaged and rounded up.`,
    },
  ];

  return {
    cr: final.cr,
    xp: xpForCr(final.cr),
    defensive,
    offensive,
    damage,
    effectiveHp: hp,
    parts,
    notes: damage.notes,
    statedCr,
    drift: crRowIndex(final.cr) - crRowIndex(statedCr),
  };
}
