import { isValidExpression } from "@/lib/dice";
import { averageOf, diceTermsOf, readAttackText, type AttackText } from "@/lib/bestiary/attack-text";
import type { EnemyAttack } from "@/lib/bestiary/statblock";

// One attack action of a pack row read into the attack an encounter stores:
// its bonus, its damage (the row's fields checked against the numbers the
// line prints), its types, reach, range, riders and on-hit effect. Split
// from statblock.ts, which calls it for every action a block lists. Pure.

export type RawAttackRow = {
  name?: unknown;
  desc?: unknown;
  attack_bonus?: unknown;
  damage_dice?: unknown;
  damage_bonus?: unknown;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The damage the row's fields give: damage_dice and damage_bonus, with each
// rider the text prints added unless damage_dice already holds it. The
// hit's own dice are taken out of damage_dice first, so a rider whose dice
// match them ("1d8 + 3 piercing plus 1d8 poison") is still counted.
function damageFromFields(dice: string, bonus: number, text: AttackText): string | null {
  if (!dice) {
    return null;
  }
  let damage = bonus > 0 ? `${dice}+${bonus}` : bonus < 0 ? `${dice}-${Math.abs(bonus)}` : dice;
  const terms = dice.toLowerCase().split(/(?=[+-])/).map((term) => term.replace(/^\+/, ""));
  const base = text.baseDice ? diceTermsOf(text.baseDice).toLowerCase() : "";
  if (base && terms.indexOf(base) >= 0) {
    terms.splice(terms.indexOf(base), 1);
  }
  for (const rider of text.riders) {
    const at = terms.indexOf(diceTermsOf(rider.dice).toLowerCase());
    if (at >= 0) {
      terms.splice(at, 1);
    } else {
      damage = `${damage}+${rider.dice}`;
    }
  }
  return damage;
}

// A blow's rolled average against the one its line prints: within a point
// (the printed number is the average rounded down).
const matchesPrinted = (damage: string, printed: number) => Math.abs(Math.floor(averageOf(damage)) - printed) <= 1;

// The bonus the line itself prints ("+6 to hit"), which is the SRD's: the
// pack's attack_bonus field misprints it on a handful of rows (a vampire
// spawn's bite at +61, a purple worm's at +9 for +14, a rug of smothering's
// at 0, which left it no attack at all).
function printedBonus(desc: string): number | null {
  const match = /([+-])\s?(\d{1,2}) to hit/i.exec(desc);
  return match ? Number(match[2]) * (match[1] === "-" ? -1 : 1) : null;
}

export function parseAttack(action: RawAttackRow): EnemyAttack | null {
  const toHit = printedBonus(asString(action.desc)) ?? asNumber(action.attack_bonus);
  const dice = asString(action.damage_dice).replace(/\s+/g, "");
  if (toHit === null || toHit <= 0) {
    return null;
  }
  const bonus = asNumber(action.damage_bonus) ?? 0;
  const desc = asString(action.desc);
  const text = readAttackText(desc);
  let damage = damageFromFields(dice, bonus, text);
  // The numbers the block prints decide when the row's fields disagree with
  // them: a pack row can misprint its dice (a giant hyena's 1d6 for 2d6), and
  // the line's own "N (XdY + Z)" beside the average is the SRD's.
  if (text.baseDice && text.printedAverage !== undefined) {
    const printed = [text.baseDice, ...text.riders.map((rider) => rider.dice)].join("+");
    if ((!damage || !matchesPrinted(damage, text.printedAverage)) && matchesPrinted(printed, text.printedAverage)) {
      damage = printed;
    }
  }
  // An attack whose hit only grapples or restrains (a roper's tendril) is
  // still an attack: no damage, its rider does the work.
  if (!damage && !text.baseDice && text.onHit?.condition && !text.onHit.damage) {
    damage = "0";
  }
  if (!damage || !isValidExpression(damage)) {
    return null;
  }
  return {
    name: asString(action.name) || "Attack",
    toHit,
    damage,
    type: text.types.join("/") || "untyped",
    ...(text.mode ? { mode: text.mode } : {}),
    ...(text.spellAttack ? { spellAttack: true } : {}),
    ...(text.reach ? { reach: text.reach } : {}),
    ...(text.range ? { range: text.range } : {}),
    ...(text.riders.length ? { riders: text.riders } : {}),
    ...(text.onHit ? { onHit: text.onHit } : {}),
  };
}
