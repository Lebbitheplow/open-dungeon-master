// Spell damage the server derives instead of trusting the model for.
//
// pc_attack and cast_at_enemy used to take the damage dice as a plain
// argument, so a level-1 wizard's Fire Bolt was whatever the model typed and
// a level-11 one never grew. The Open5e content pack already carries the
// answer in prose: every cantrip states its tier list and every levelled
// spell states its per-slot increase, in a form regular enough to parse.
//
// Pure text in, dice out, no database, so scripts/test-spell-scaling.mjs can
// exercise every pattern. A string the parsers do not recognize returns null
// and the caller falls back to the model's dice rather than inventing any.

// The base payload stated in a description. SRD spells word it two ways
// round ("takes 8d6 fire damage", "damage equal to 12d6"), and often with a
// clause in between, so both orders are tried within the same sentence.
export function baseDamageDice(desc: string): string | null {
  const patterns = [
    /(\d+d\d+)(?:\s*\+\s*\d+)?[^.]{0,40}?\bdamage\b/i,
    /\bdamage\b[^.]{0,40}?(\d+d\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(desc);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export function baseHealingDice(desc: string): string | null {
  const match = /(?:regains?|restores?|heals?)[^.]{0,60}?(\d+d\d+)/i.exec(desc);
  return match ? match[1] : null;
}

// Cantrip tiers: "This spell's damage increases by 1d10 when you reach 5th
// level (2d10), 11th level (3d10), and 17th level (4d10)." The parenthesised
// expressions are the whole answer, so they are read directly rather than
// recomputed.
export function cantripTiers(higherLevel: string): string[] | null {
  if (!/when you reach/i.test(higherLevel)) {
    return null;
  }
  const tiers = [...higherLevel.matchAll(/\((\d+d\d+)\)/g)].map((match) => match[1]);
  return tiers.length >= 2 ? tiers : null;
}

// A cantrip's damage at a character level: the base until 5th, then each
// tier at 5th, 11th, and 17th.
export function cantripDamage(
  desc: string,
  higherLevel: string,
  casterLevel: number,
): { dice: string; note: string } | null {
  const base = baseDamageDice(desc);
  const tiers = cantripTiers(higherLevel);
  if (!base || !tiers) {
    return null;
  }
  const level = Math.max(1, Math.min(20, Math.floor(casterLevel)));
  const thresholds = [5, 11, 17];
  let dice = base;
  let reached = 0;
  for (let index = 0; index < thresholds.length && index < tiers.length; index += 1) {
    if (level >= thresholds[index]) {
      dice = tiers[index];
      reached = thresholds[index];
    }
  }
  return {
    dice,
    note: reached
      ? `cantrip scaling at level ${level}: ${dice}`
      : `cantrip base damage: ${dice}`,
  };
}

// "the damage increases by 1d6 for each slot level above 3rd" -> the extra
// dice, the level they are counted from, and how many slot levels buy one.
// The SRD phrases this loosely ("the damage done by your attack increases
// by", "the base damage increases by", "for every 2 slot levels above"), so
// a bounded run of filler is allowed inside the sentence. Where the text
// omits the threshold entirely, the "slot of Nth level or higher" clause
// supplies it.
export function upcastStep(
  higherLevel: string,
): { dice: string; baseLevel: number; kind: "damage" | "healing"; per: number } | null {
  const match = /(damage|healing)[^.]{0,60}?increases\s+by\s+(\d+)d(\d+)/i.exec(higherLevel);
  if (!match) {
    return null;
  }
  const above = /above\s+(\d+)(?:st|nd|rd|th)/i.exec(higherLevel);
  // "a spell slot of 4th level or higher" means the spell's own level is 3.
  const slotClause = /slot\s+of\s+(\d+)(?:st|nd|rd|th)\s+level\s+or\s+higher/i.exec(higherLevel);
  const baseLevel = above
    ? Number(above[1])
    : slotClause
      ? Math.max(1, Number(slotClause[1]) - 1)
      : null;
  if (baseLevel === null) {
    return null;
  }
  const every = /for\s+every\s+(\d+)\s+slot\s+levels?\s+above/i.exec(higherLevel);
  return {
    dice: `${match[2]}d${match[3]}`,
    baseLevel,
    kind: match[1].toLowerCase() === "healing" ? "healing" : "damage",
    per: every ? Math.max(1, Number(every[1])) : 1,
  };
}

// Adds two dice expressions of the same size: "8d6" + 2 x "1d6" = "10d6".
// Different sizes stay separate terms, which rollExpression handles fine.
function addDice(base: string, extra: string, times: number): string {
  if (times <= 0) {
    return base;
  }
  const baseMatch = /^(\d+)d(\d+)$/.exec(base);
  const extraMatch = /^(\d+)d(\d+)$/.exec(extra);
  if (baseMatch && extraMatch && baseMatch[2] === extraMatch[2]) {
    return `${Number(baseMatch[1]) + Number(extraMatch[1]) * times}d${baseMatch[2]}`;
  }
  return `${base}${`+${extra}`.repeat(times)}`;
}

// The dice a levelled spell rolls when cast from a given slot.
export function upcastDamage(
  desc: string,
  higherLevel: string,
  slotLevel: number,
): { dice: string; note: string } | null {
  const step = upcastStep(higherLevel);
  const base = step?.kind === "healing" ? baseHealingDice(desc) : baseDamageDice(desc);
  if (!step || !base) {
    return null;
  }
  const levelsAbove = Math.max(0, Math.floor(slotLevel) - step.baseLevel);
  const above = Math.floor(levelsAbove / step.per);
  const dice = addDice(base, step.dice, above);
  return {
    dice,
    note: above
      ? `upcast to level ${slotLevel}: ${dice} (+${step.dice} per ${step.per > 1 ? `${step.per} levels` : "level"} above ${step.baseLevel})`
      : `${dice} at its base level`,
  };
}

// ---- Mechanics parsers ----
//
// The same regular SRD phrasing that yields the damage dice also states the
// save, the half-on-save rule, the damage type, and the condition applied.
// Each parser returns null rather than guess; the caller falls back to an
// authored mechanics row or, failing that, the model's own arguments.

const ABILITY_BY_WORD = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
} as const;

export type ParsedSaveAbility = (typeof ABILITY_BY_WORD)[keyof typeof ABILITY_BY_WORD];

// "must succeed on a Dexterity saving throw", "must make a Wisdom saving
// throw". The first save named is the spell's save.
export function saveAbilityFor(desc: string): ParsedSaveAbility | null {
  const match =
    /(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving\s+throw/i.exec(desc);
  return match ? ABILITY_BY_WORD[match[1].toLowerCase() as keyof typeof ABILITY_BY_WORD] : null;
}

// "or half as much damage on a successful one/save", "half as much on a
// success", "taking ... on a failure and half on a success".
export function halfOnSaveFor(desc: string): boolean {
  return (
    /half\s+as\s+much\s+damage/i.test(desc) ||
    /half\s+as\s+much[^.]{0,40}?success/i.test(desc) ||
    /success[^.]{0,40}?\bhalf\b/i.test(desc) ||
    /failure\s+and\s+half\b/i.test(desc)
  );
}

const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

// The type attached to the spell's damage clause ("8d6 fire damage").
export function damageTypeFor(desc: string): string | null {
  const pattern = new RegExp(
    `(?:\\dd\\d+|damage)[^.]{0,30}?\\b(${DAMAGE_TYPES.join("|")})\\b\\s+damage`,
    "i",
  );
  const match = pattern.exec(desc);
  if (match) {
    return match[1].toLowerCase();
  }
  const loose = new RegExp(`\\b(${DAMAGE_TYPES.join("|")})\\b\\s+damage`, "i").exec(desc);
  return loose ? loose[1].toLowerCase() : null;
}

const APPLIED_CONDITIONS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "paralyzed", "petrified", "poisoned", "restrained", "stunned", "unconscious",
  "prone",
];

// The condition a failed save applies: "or be frightened", "is knocked
// prone", "becomes poisoned". Bounded to the standard list so prose about
// e.g. "charmed allies" elsewhere in a long description cannot misfire.
export function conditionAppliedFor(desc: string): string | null {
  const list = APPLIED_CONDITIONS.join("|");
  const patterns = [
    new RegExp(`\\bor\\s+(?:be(?:come)?s?\\s+|is\\s+)?(?:knocked\\s+|pushed\\s+)?(${list})\\b`, "i"),
    new RegExp(`failed\\s+save[^.]{0,80}?\\b(${list})\\b`, "i"),
    new RegExp(`\\bis\\s+(?:knocked\\s+)?(${list})\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(desc);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

// "Make a ranged/melee spell attack against ...".
export function attackKindFor(desc: string): "melee" | "ranged" | null {
  const match = /make\s+a\s+(ranged|melee)\s+spell\s+attack/i.exec(desc);
  return match ? (match[1].toLowerCase() as "melee" | "ranged") : null;
}

// The single entry point the tools use: what this spell rolls for this
// caster and slot. `slotLevel` is undefined for cantrips.
export function scaledSpellDice(input: {
  spellLevel: number;
  desc: string;
  higherLevel: string;
  casterLevel: number;
  slotLevel?: number;
}): { dice: string; note: string } | null {
  if (input.spellLevel === 0) {
    return cantripDamage(input.desc, input.higherLevel, input.casterLevel);
  }
  return upcastDamage(input.desc, input.higherLevel, input.slotLevel ?? input.spellLevel);
}
