import { parseSaveEffect } from "@/lib/dm/monster-abilities";
import type { SaveAbility } from "@/lib/bestiary/statblock";

// What an attack's printed line says beyond its bonus and dice (SRD 5.1,
// Monsters: Actions): melee or ranged, its reach and range, the typed dice
// that ride the hit ("plus 7 (2d6) fire damage"), and what else a hit does
// (a save against poison, knocked prone, grappled with an escape DC). And the
// Multiattack routine that names which attacks a creature makes. Pure; read
// by statblock.ts when a pack row becomes a stored block.

const DAMAGE_WORDS = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

export type TypedDice = { dice: string; type: string };

export type OnHitRider = {
  save?: SaveAbility;
  dc?: number;
  // Applied on a failed save, or on every hit when there is no save.
  condition?: string;
  // A second condition the first brings: a constrictor's grapple restrains.
  alsoCondition?: string;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  escapeDc?: number;
  rounds?: number;
  // No count and no repeat save: a long rest ends it, or a cure does.
  untilLongRest?: boolean;
  lasting?: boolean;
  repeatSave?: boolean;
  // "If the target is Medium or smaller": the largest size it works on.
  maxSize?: string;
  // "Its hit point maximum is reduced by an amount equal to the (necrotic)
  // damage taken" until a long rest (a wight, a wraith, a specter, a
  // vampire's bite); `drainHeals` when the creature regains that much.
  drainMaxHp?: "necrotic" | "all";
  drainHeals?: boolean;
  // Swallowed whole (a purple worm, a kraken): blinded and restrained.
  swallow?: boolean;
  // Clauses no engine models (a disease, a curse, lycanthropy, petrification
  // by stages, a drained Strength): the DM's to resolve, said so on the hit.
  manual?: string[];
};

export type AttackText = {
  mode?: "melee" | "ranged" | "both";
  spellAttack?: boolean;
  reach?: number;
  range?: { normal: number; long: number };
  // The hit's own damage type, then each rider's.
  types: string[];
  riders: TypedDice[];
  onHit?: OnHitRider;
  // The hit's own dice as printed ("1d8+3" from "Hit: 7 (1d8 + 3)"), and
  // the average the line prints for the whole blow, base and riders (11
  // for "7 (1d8 + 3) piercing damage plus 4 (1d8) poison damage"). Absent
  // when the line prints no dice.
  baseDice?: string;
  printedAverage?: number;
};

const compact = (raw: string) => raw.replace(/\s+/g, "");

// The mean of a dice expression ("2d10+6" -> 17), the number a stat block
// prints beside its dice.
export function averageOf(expression: string): number {
  let total = 0;
  for (const term of compact(expression).split(/(?=[+-])/)) {
    const sign = term.startsWith("-") ? -1 : 1;
    const body = term.replace(/^[+-]/, "");
    const dice = /^(\d+)d(\d+)$/i.exec(body);
    if (dice) {
      total += (sign * Number(dice[1]) * (Number(dice[2]) + 1)) / 2;
    } else if (/^\d+$/.test(body)) {
      total += sign * Number(body);
    }
  }
  return total;
}

// The dice terms alone: "2d10+6" -> "2d10".
export function diceTermsOf(expression: string): string {
  return compact(expression)
    .split(/(?=[+-])/)
    .filter((term) => /d/i.test(term))
    .map((term) => term.replace(/^\+/, ""))
    .join("+");
}

export function readAttackText(desc: string): AttackText {
  const text = desc.replace(/\s+/g, " ").trim();
  const out: AttackText = { types: [], riders: [] };
  const kind = /(melee or ranged|melee|ranged)\s+(weapon|spell)\s+attack/i.exec(text);
  if (kind) {
    const word = kind[1].toLowerCase();
    out.mode = word === "melee or ranged" ? "both" : word === "melee" ? "melee" : "ranged";
    out.spellAttack = kind[2].toLowerCase() === "spell";
  }
  const reach = /reach\s+(\d{1,3})\s*ft/i.exec(text);
  if (reach) {
    out.reach = Number(reach[1]);
  }
  const range = /range\s+(\d{1,4})(?:\s*\/\s*(\d{1,4}))?\s*ft/i.exec(text);
  if (range) {
    out.range = { normal: Number(range[1]), long: Number(range[2] ?? range[1]) };
  }
  const hitAt = text.search(/hit:/i);
  const hit = hitAt >= 0 ? text.slice(hitAt + 4) : text;
  const types = new RegExp(`\\d+\\s*\\([^)]*\\)\\s+(${DAMAGE_WORDS.join("|")})\\s+damage`, "i").exec(hit);
  if (types) {
    out.types.push(types[1].toLowerCase());
  }
  // The hit's own dice open the line: "Hit: 7 (1d8 + 3) piercing damage".
  const base = hitAt >= 0 ? /^\s*(\d{1,3})\s*\(\s*(\d{1,3}d\d{1,3}(?:\s*[+-]\s*\d{1,3})?)\s*\)/i.exec(hit) : null;
  // A flat hit with no dice ("Hit: 1 piercing damage", a homunculus) is its
  // own base.
  const flat = hitAt >= 0 && !base ? new RegExp(`^\\s*(\\d{1,3})\\s+(${DAMAGE_WORDS.join("|")})\\s+damage`, "i").exec(hit) : null;
  let printed = base ? Number(base[1]) : flat ? Number(flat[1]) : 0;
  if (base) {
    out.baseDice = compact(base[2]);
  } else if (flat) {
    out.baseDice = flat[1];
    out.types.push(flat[2].toLowerCase());
  }
  // "plus 3 (1d6) lightning or thunder damage (djinni's choice)" rides as
  // the first type named.
  const words = DAMAGE_WORDS.join("|");
  for (const rider of hit.matchAll(
    new RegExp(`plus\\s+(\\d+)\\s*\\((\\d{1,3}d\\d{1,3}(?:\\s*[+-]\\s*\\d+)?)\\)\\s+(${words})(?:\\s+or\\s+(?:${words}))?\\s+damage`, "gi"),
  )) {
    const type = rider[3].toLowerCase();
    out.riders.push({ dice: compact(rider[2]), type });
    if (!out.types.includes(type)) {
      out.types.push(type);
    }
  }
  // The printed average counts every "plus N (dice)", read or not; a blow
  // whose riders were not all read has no printed dice to stand on.
  const plus = [...hit.matchAll(/plus\s+(\d+)\s*\(\s*\d{1,3}d\d{1,3}[^)]*\)/gi)];
  printed += plus.reduce((sum, match) => sum + Number(match[1]), 0);
  if ((base || flat) && plus.length === out.riders.length) {
    out.printedAverage = printed;
  }
  const onHit = readOnHit(hit);
  if (onHit) {
    out.onHit = onHit;
  }
  return out;
}

// What a hit does besides its damage.
function readOnHit(hit: string): OnHitRider | null {
  const rider: OnHitRider = {};
  const dcAt = hit.search(/DC\s*\d{1,2}\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw/i);
  if (dcAt >= 0) {
    // The sentence with the save in it decides the effect; what follows it
    // ("if the poison reduces the target to 0 ...") is a different rule.
    const rest = hit.slice(dcAt);
    const stop = rest.search(/\.\s+[A-Z]/);
    const sentence = stop >= 0 ? rest.slice(0, stop + 1) : rest;
    const effect = parseSaveEffect(sentence);
    Object.assign(rider, {
      ...(effect.save ? { save: effect.save } : {}),
      ...(effect.dc ? { dc: effect.dc } : {}),
      ...(effect.condition ? { condition: effect.condition } : {}),
      ...(effect.damage ? { damage: effect.damage, damageType: effect.damageType } : {}),
      ...(effect.halfOnSave ? { halfOnSave: true } : {}),
      ...(effect.rounds ? { rounds: effect.rounds } : {}),
      ...(effect.untilLongRest ? { untilLongRest: true } : {}),
      ...(effect.lasting ? { lasting: true } : {}),
    });
    if (/repeat the saving throw/i.test(rest)) {
      rider.repeatSave = true;
    }
  }
  const grapple = /(?:target|it|creature) is grappled\s*\(escape DC\s*(\d{1,2})\)/i.exec(hit);
  if (grapple) {
    rider.escapeDc = Number(grapple[1]);
    if (!rider.condition) {
      rider.condition = "grappled";
    }
    // "Until this grapple ends, the creature is restrained" (a constrictor),
    // "Until the grapple ends, the target is restrained" (a roper), "the
    // target is restrained until this grapple ends" (a behir).
    if (/until (?:this|the) grapple ends,[^.]*\bis restrained|\bis restrained until (?:this|the) grapple ends/i.test(hit)) {
      rider.alsoCondition = "restrained";
    }
  }
  const drain = /hit point maximum is reduced by an amount equal to the (necrotic )?damage (?:taken|dealt)/i.exec(hit);
  if (drain) {
    rider.drainMaxHp = drain[1] ? "necrotic" : "all";
    if (/regains hit points equal to that amount/i.test(hit)) {
      rider.drainHeals = true;
    }
  }
  if (/\bis swallowed\b/i.test(hit)) {
    rider.swallow = true;
  }
  const manual = hit
    .split(/(?<=\.)\s+/)
    .filter((sentence) => /\b(?:disease|diseased|cursed|curse|lycanthrop\w*|swallowed|petrif\w*|strength score is reduced|stable but poisoned)\b/i.test(sentence))
    .map((sentence) => sentence.trim())
    .slice(0, 3);
  if (manual.length) {
    rider.manual = manual;
  }
  const size = /if the target is (?:a |an )?(tiny|small|medium|large|huge)(?: or smaller)?/i.exec(hit);
  if (size && (rider.condition || rider.damage || rider.swallow)) {
    rider.maxSize = size[1].toLowerCase();
  }
  return rider.condition || rider.damage || rider.drainMaxHp || rider.swallow || rider.manual ? rider : null;
}

// ---- Multiattack ----

// `ifHit`: the step is made only when the swing before it hit ("If that
// attack hits, the grick can make one beak attack against the same target").
export type RoutineStep = { attack: string; count: number; ifHit?: boolean };

const COUNTS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// "Bite (Bat or Vampire Form Only)" -> "bite".
const bareName = (name: string) => name.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();

function matchAttack(word: string, names: string[]): string | null {
  const wanted = word.replace(/^(?:its|his|her|their)\s+/i, "").trim().toLowerCase();
  const singular = wanted.replace(/(?<=[^s])s$/, "");
  return (
    names.find((name) => bareName(name) === wanted) ??
    names.find((name) => bareName(name) === singular) ??
    names.find((name) => bareName(name).split(" ").includes(singular)) ??
    null
  );
}

const COUNT_WORD = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})";

// One "one with its bite" / "two claw attacks" / "two with its claws" /
// "one to constrict".
function stepOf(item: string, names: string[]): RoutineStep | null {
  const text = item.trim().replace(/[.]$/, "");
  const withIts = /^(a|an|one|two|three|four|five|six|\d{1,2})\s+(?:\w+\s+)?(?:attacks?\s+)?with\s+(?:its|his|her|their)\s+(.+)$/i.exec(text);
  const named = /^(a|an|one|two|three|four|five|six|\d{1,2})\s+(.+?)\s+attacks?$/i.exec(text);
  const toVerb = /^(a|an|one|two|three|four|five|six|\d{1,2})\s+to\s+(\w+)$/i.exec(text);
  const found = withIts ?? named ?? toVerb;
  if (!found) {
    return null;
  }
  const count = COUNTS[found[1].toLowerCase()] ?? Number(found[1]);
  const attack = matchAttack(found[2], names);
  return attack && count >= 1 ? { attack, count } : null;
}

// "one with its claws or harpoon" -> "one with its claws", "one with its
// harpoon": a step that lets the creature pick the attack.
function stepChoices(item: string): string[] {
  const choice = /^(.*?\b(?:its|his|her|their)\s+)(.+?)\s+or\s+(?:its\s+)?(.+)$/i.exec(item.trim());
  return choice ? [`${choice[1]}${choice[2]}`, `${choice[1]}${choice[3]}`] : [item];
}

// Every routine a list of items allows: each item with a choice of attack
// multiplies the routines. A routine naming an attack the block does not
// have (the lamia's Intoxicating Touch, no attack roll) is left out.
function routinesOfList(body: string, names: string[]): RoutineStep[][] {
  const items = body.split(/,\s*(?:and\s+)?|\s+and\s+/).map((item) => item.trim()).filter(Boolean);
  let routines: RoutineStep[][] = [[]];
  for (const item of items) {
    const steps = stepChoices(item).map((choice) => stepOf(choice, names));
    if (steps.every((step) => step === null)) {
      return [];
    }
    routines = routines.flatMap((routine) =>
      steps.filter((step): step is RoutineStep => step !== null).map((step) => [...routine, step]),
    );
  }
  return routines.filter((routine) => routine.length);
}

// The printed wording made regular: "(humanoid form)" notes dropped, the
// medusa's dashes ("makes either three melee attacks - A and B - or two
// ranged attacks") read as a list and its alternative.
function normalizedMultiattack(desc: string): string {
  return desc
    .replace(/\s+/g, " ")
    .replace(/\s*\([^)]*\bform\)/gi, "")
    .replace(/\bmakes either\b/gi, "makes")
    .replace(/\s+-\s+or\s+/g, " or ")
    .replace(/\s+-\s+/g, ": ");
}

// The routines a Multiattack line names, first the main one, then any "Or
// it makes..." alternative. Null when the line names no attack by name
// ("makes two melee attacks"), which leaves the count to parseMultiattackCount.
export function parseRoutines(desc: string, attackNames: string[]): RoutineStep[][] | null {
  const routines: RoutineStep[][] = [];
  const sentences = normalizedMultiattack(desc).split(/(?<=\.)\s+/);
  for (const sentence of sentences) {
    const listed = new RegExp(`makes?\\s+${COUNT_WORD}\\s+(?:\\w+\\s+)?attacks?\\s*:\\s*(.+)$`, "i").exec(sentence);
    const either = new RegExp(
      `makes?\\s+(${COUNT_WORD})\\s+(?:\\w+\\s+)?attacks?,?\\s+either\\s+with\\s+(?:its|his|her|their)\\s+([\\w ]+?)\\s+or\\s+(?:with\\s+)?(?:its|his|her|their)\\s+([\\w ]+?)\\.?$`,
      "i",
    ).exec(sentence);
    const plainRe = /makes?\s+((?:a|an|one|two|three|four|five|six|\d{1,2})\s+(?:\w+\s+){0,2}?attacks?(?:\s+with\s+(?:its|his|her|their)\s+[\w ]+)?)/gi;
    const also = /can also make (a|an|one|two) ([\w ]+?) attacks?/i.exec(sentence);
    const ifHit = /if that attack hits,[^.]*?can make (a|an|one|two) ([\w ]+?) attacks?/i.exec(sentence);
    if ((also || ifHit) && routines.length) {
      // "If it has a shortsword drawn, it can also make a shortsword attack."
      // "If that attack hits, the grick can make one beak attack."
      const found = (ifHit ?? also)!;
      const step = stepOf(`${found[1]} ${found[2]} attack`, attackNames);
      if (step) {
        routines[routines.length - 1] = [...routines[routines.length - 1], ifHit ? { ...step, ifHit: true } : step];
      }
      continue;
    }
    if (listed) {
      // "two attacks: one with its pike and one with its hooves or two with
      // its longbow": an " or " before a count opens another routine.
      for (const alternative of listed[1].split(new RegExp(`\\s+or\\s+(?=${COUNT_WORD}\\s)`, "i"))) {
        routines.push(...routinesOfList(alternative, attackNames));
      }
      continue;
    }
    if (either) {
      // "three attacks, either with its longsword or its longbow".
      for (const name of [either[2], either[3]]) {
        const step = stepOf(`${either[1]} with its ${name}`, attackNames);
        if (step) {
          routines.push([step]);
        }
      }
      continue;
    }
    // "makes four attacks with its tendrils, uses Reel, and makes one attack
    // with its bite": every "makes ..." in the sentence is one routine.
    const steps = [...sentence.matchAll(plainRe)]
      .map((match) => stepOf(match[1], attackNames))
      .filter((step): step is RoutineStep => step !== null);
    if (steps.length) {
      routines.push(steps);
    }
  }
  return routines.length ? routines : null;
}
