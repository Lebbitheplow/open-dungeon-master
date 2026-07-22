import { randomInt } from "node:crypto";

// Rolls one die: returns an integer in [1, sides]. Injectable for testing.
export type DieRng = (sides: number) => number;

export type Advantage = "none" | "advantage" | "disadvantage";

export type DieResult = {
  sides: number;
  value: number;
  kept: boolean;
  // The discarded face when a Great Weapon Fighting reroll replaced it, so
  // the dice card can show what happened.
  rerolledFrom?: number;
};

export type DiceTerm = {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: "highest" | "lowest"; count: number };
  dice: DieResult[];
  subtotal: number;
};

export type ModifierTerm = {
  kind: "modifier";
  sign: 1 | -1;
  value: number;
};

export type RollResult = {
  expression: string;
  total: number;
  terms: Array<DiceTerm | ModifierTerm>;
  // Set when the roll is a single kept d20 (1d20, 2d20kh1, 2d20kl1):
  // the natural face of the kept die, for crit detection.
  natural?: number;
  crit?: "nat20" | "nat1";
};

const MAX_DICE_PER_TERM = 100;
const MAX_SIDES = 100;
const MIN_SIDES = 2;
const MAX_TERMS = 20;

// XdY, optional khN/klN keep, optional fN floor (Reliable Talent: "1d20f10"
// treats a kept face below N as N), or a flat integer.
const TERM_PATTERN = /^(?:(\d{1,3})d(\d{1,3})(?:k([hl])(\d{1,3}))?(?:f(\d{1,3}))?|(\d{1,7}))$/i;

export function defaultRng(sides: number) {
  return randomInt(1, sides + 1);
}

export type RollOptions = {
  // Great Weapon Fighting: reroll damage dice landing at or below this
  // value, once each, and keep the new face even if it is worse. d20s are
  // exempt: this is a damage-dice rule, never an attack-roll one.
  rerollBelow?: number;
};

// Parses and rolls a dice expression: XdY terms with optional khN/klN keeps
// and integer modifiers, joined by + or -. Examples: "1d20+5", "4d6kh3",
// "2d20kl1+3", "8d6", "1d100-10".
export function rollExpression(
  expression: string,
  rng: DieRng = defaultRng,
  options: RollOptions = {},
): RollResult {
  const compact = expression.replace(/\s+/g, "").toLowerCase();
  if (!compact) {
    throw new Error("Empty dice expression.");
  }

  // Split into signed terms; a leading sign is optional.
  const rawTerms = compact.match(/[+-]?[^+-]+/g);
  if (!rawTerms || rawTerms.join("") !== compact) {
    throw new Error(`Invalid dice expression: ${expression}`);
  }
  if (rawTerms.length > MAX_TERMS) {
    throw new Error("Too many terms in dice expression.");
  }

  const terms: Array<DiceTerm | ModifierTerm> = [];
  for (const rawTerm of rawTerms) {
    const sign: 1 | -1 = rawTerm.startsWith("-") ? -1 : 1;
    const body = rawTerm.replace(/^[+-]/, "");
    const match = TERM_PATTERN.exec(body);
    if (!match) {
      throw new Error(`Invalid dice term: ${rawTerm}`);
    }

    if (match[6] !== undefined) {
      terms.push({ kind: "modifier", sign, value: Number(match[6]) });
      continue;
    }

    const count = Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || count > MAX_DICE_PER_TERM) {
      throw new Error(`Dice count out of range in: ${rawTerm}`);
    }
    if (sides < MIN_SIDES || sides > MAX_SIDES) {
      throw new Error(`Die size out of range in: ${rawTerm}`);
    }

    let keep: DiceTerm["keep"];
    if (match[3]) {
      const keepCount = Number(match[4]);
      if (keepCount < 1 || keepCount > count) {
        throw new Error(`Keep count out of range in: ${rawTerm}`);
      }
      keep = { mode: match[3] === "h" ? "highest" : "lowest", count: keepCount };
    }

    const roll = () => {
      const value = rng(sides);
      if (!Number.isInteger(value) || value < 1 || value > sides) {
        throw new Error(`RNG returned an invalid d${sides} value: ${value}`);
      }
      return value;
    };
    const rerollBelow = sides === 20 ? 0 : (options.rerollBelow ?? 0);
    const dice: DieResult[] = Array.from({ length: count }, () => {
      const value = roll();
      if (rerollBelow > 0 && value <= rerollBelow) {
        return { sides, value: roll(), kept: true, rerolledFrom: value };
      }
      return { sides, value, kept: true };
    });

    if (keep) {
      const order = dice
        .map((die, index) => ({ die, index }))
        .sort((a, b) =>
          keep.mode === "highest" ? b.die.value - a.die.value : a.die.value - b.die.value,
        );
      const keptIndexes = new Set(order.slice(0, keep.count).map((entry) => entry.index));
      dice.forEach((die, index) => {
        die.kept = keptIndexes.has(index);
      });
    }

    // The floor raises kept faces below it (Reliable Talent's 10), keeping
    // the original face visible on the card.
    const floorAt = match[5] ? Number(match[5]) : 0;
    if (floorAt > 0) {
      for (const die of dice) {
        if (die.kept && die.value < floorAt) {
          die.rerolledFrom = die.value;
          die.value = Math.min(sides, floorAt);
        }
      }
    }

    const subtotal = dice.reduce((sum, die) => sum + (die.kept ? die.value : 0), 0);
    terms.push({ kind: "dice", sign, count, sides, keep, dice, subtotal });
  }

  const total = terms.reduce(
    (sum, term) =>
      sum + term.sign * (term.kind === "dice" ? term.subtotal : term.value),
    0,
  );

  const result: RollResult = { expression: compact, total, terms };

  // Crit detection: the leading term is a d20 keeping a single die, and no
  // other d20 term competes. Rider dice from effect conditions ("1d20+5+1d4"
  // for a blessed attack) leave the natural face detectable.
  const diceTerms = terms.filter((term): term is DiceTerm => term.kind === "dice");
  const lead = terms[0];
  if (
    lead &&
    lead.kind === "dice" &&
    lead.sides === 20 &&
    lead.sign === 1 &&
    diceTerms.filter((term) => term.sides === 20).length === 1
  ) {
    const keptDice = lead.dice.filter((die) => die.kept);
    if (keptDice.length === 1) {
      result.natural = keptDice[0].value;
      if (result.natural === 20) {
        result.crit = "nat20";
      } else if (result.natural === 1) {
        result.crit = "nat1";
      }
    }
  }

  return result;
}

// Canonical d20 test expression for checks, saves, and attacks.
// Advantage rolls 2d20 keep highest; disadvantage keeps lowest.
export function d20Expression(modifier: number, advantage: Advantage = "none") {
  const base =
    advantage === "advantage" ? "2d20kh1" : advantage === "disadvantage" ? "2d20kl1" : "1d20";
  if (modifier > 0) {
    return `${base}+${modifier}`;
  }
  if (modifier < 0) {
    return `${base}-${Math.abs(modifier)}`;
  }
  return base;
}

export function rollD20(
  modifier: number,
  advantage: Advantage = "none",
  rng: DieRng = defaultRng,
): RollResult {
  return rollExpression(d20Expression(modifier, advantage), rng);
}

// The die faces an expression will roll, in roll order. Lets the UI render
// one input per physical die (e.g. "2d20kh1+4" -> [20, 20]).
export function expressionDice(expression: string): number[] {
  const faces: number[] = [];
  rollExpression(expression, (sides) => {
    faces.push(sides);
    return 1;
  });
  return faces;
}

// Scores an expression using player-supplied physical die values instead of
// the RNG. Values are consumed in roll order; keep rules, modifiers, and
// crit detection all apply exactly as in a digital roll.
export function rollExpressionWithDice(expression: string, values: number[]): RollResult {
  let index = 0;
  const result = rollExpression(expression, (sides) => {
    if (index >= values.length) {
      throw new Error("Not enough die values for this roll.");
    }
    const value = values[index];
    if (!Number.isInteger(value) || value < 1 || value > sides) {
      throw new Error(`Die ${index + 1} must be a whole number from 1 to ${sides}.`);
    }
    index += 1;
    return value;
  });
  if (index !== values.length) {
    throw new Error("Too many die values for this roll.");
  }
  return result;
}

export function isValidExpression(expression: string) {
  try {
    // Roll with a constant RNG; only the parse can throw for a valid grammar.
    rollExpression(expression, () => 1);
    return true;
  } catch {
    return false;
  }
}
