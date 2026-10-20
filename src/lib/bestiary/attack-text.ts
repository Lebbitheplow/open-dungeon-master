import { parseSaveEffect } from "@/lib/dm/monster-abilities";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { textKey } from "@/lib/language/text-logic";
import { pluralForms } from "@/lib/srd/name-forms";

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
  // Some documents print their labels in Markdown ("_Hit:_ 5 (1d4+3)").
  const text = desc.replace(/[_*]/g, "").replace(/\s+/g, " ").trim();
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
  // The hit's own type is the one its clause opens with ("Hit: 1 piercing
  // damage", "Hit: 7 (1d8 + 3) piercing damage"); else the first typed dice
  // before a saving throw, whose damage is the save's and not the hit's (a
  // Poisonous Snake's "taking 5 (2d4) poison damage on a failed save").
  const own =
    new RegExp(`^\\s*\\d+\\s*(?:\\([^)]*\\)\\s*)?(${DAMAGE_WORDS.join("|")})\\s+damage`, "i").exec(hit) ??
    new RegExp(`\\d+\\s*\\([^)]*\\)\\s+(${DAMAGE_WORDS.join("|")})\\s+damage`, "i").exec(hit.split(/saving throw/i)[0]);
  if (own) {
    out.types.push(own[1].toLowerCase());
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

// "Bite (Bat or Vampire Form Only)" -> "bite", "+1 Longsword" -> "longsword".
const bareName = (name: string) => textKey(name.replace(/\([^)]*\)/g, "").replace(/^\s*[+-]\d+\s+/, ""));

// The attack a routine names: its whole bare name, or the same name with
// either side plural ("claws" is Claw, "talon" is Talons). A word of a name
// is none ("tail" is no Tail Spike).
function matchAttack(word: string, names: string[]): string | null {
  const wanted = textKey(word.replace(/^(?:its|his|her|their)\s+/i, ""));
  return (
    names.find((name) => bareName(name) === wanted) ??
    names.find((name) => pluralForms(bareName(name)).includes(wanted) || pluralForms(wanted).includes(bareName(name))) ??
    null
  );
}

export const COUNT_WORD = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})";

// A word of an action's name, never the wording around it ("uses Grasp of
// Shadows then attacks ... twice" names no action used twice).
const NAME_WORD = "(?!(?:then|and|or|with|attacks?)\\b)[\\p{L}\\p{M}\\p{N}'’-]+";

// An item that names a count of attacks: "two claw attacks", "one with its
// tail", "two melee attacks with its claws"; not "one leg attack per leg",
// whose count the block does not fix.
export const ATTACK_GROUP = new RegExp(
  `^(?!a\\s+number\\b)(${COUNT_WORD})\\s+(?:(?:[\\p{L}\\p{M}\\p{N}'’-]+\\s+){0,6}?attacks?\\b(?!\\s+(?:for\\s+each|per)\\b)|(?:[\\p{L}\\p{M}\\p{N}'’-]+\\s+){0,2}?with\\s+(?:its|his|her|their)\\s)`,
  "iu",
);

// One "one with its bite" / "two claw attacks" / "two with its claws" /
// "one to constrict".
function stepOf(item: string, names: string[]): RoutineStep | null {
  const text = item.trim().replace(/[.]$/, "");
  const withIts = new RegExp(`^(${COUNT_WORD})\\s+(?:\\w+\\s+)?(?:attacks?\\s+)?with\\s+(?:its|his|her|their)\\s+(.+)$`, "i").exec(text);
  const named = new RegExp(`^(${COUNT_WORD})\\s+(.+?)\\s+attacks?$`, "i").exec(text);
  const toVerb = new RegExp(`^(${COUNT_WORD})\\s+to\\s+(\\w+)$`, "i").exec(text);
  const found = withIts ?? named ?? toVerb;
  if (!found) {
    return null;
  }
  const count = COUNTS[found[1].toLowerCase()] ?? Number(found[1]);
  const attack = matchAttack(found[2], names);
  return attack && count >= 1 ? { attack, count } : null;
}

// "one with its claws or harpoon" -> "one with its claws", "one with its
// harpoon", and "two Wind Lash or Lightning Bolt attacks" -> "two Wind Lash
// attacks", "two Lightning Bolt attacks": a step that lets the creature pick
// the attack.
function stepChoices(item: string): string[] {
  const choice = /^(.*?\b(?:its|his|her|their)\s+)(.+?)\s+or\s+(?:with\s+)?(?:its\s+)?(.+)$/i.exec(item.trim());
  if (choice) {
    return [`${choice[1]}${choice[2]}`, `${choice[1]}${choice[3]}`];
  }
  const named = /^(\S+)\s+(.+?)\s+or\s+(.+?)\s+(attacks?)$/i.exec(item.trim());
  return named ? [`${named[1]} ${named[2]} ${named[4]}`, `${named[1]} ${named[3]} ${named[4]}`] : [item];
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

// The routines the groups a "makes" lists allow: "three claw attacks and
// one bite attack." is Claw x3 and Bite, and "one claw and one bite attack"
// the same with the noun said once, up to an item that is no count ("each
// of which it can replace with one use of Fling"). None when a count names
// no attack of the block ("two Heavy Pick attacks" on a block whose attack
// is War Pick, "as many leg attacks as it has legs"): a routine short of a
// group would plan too few swings.
function listedRoutines(clause: string, names: string[]): RoutineStep[][] {
  let routines: RoutineStep[][] = [[]];
  for (const item of multiattackItems(clause)) {
    const steps = stepChoices(item)
      .map((choice) => stepOf(choice, names) ?? stepOf(`${choice} attack`, names))
      .filter((step): step is RoutineStep => step !== null);
    if (!steps.length) {
      if (new RegExp(`^(?:${COUNT_WORD}|as many)\\s`, "i").test(item)) {
        return [];
      }
      break;
    }
    routines = routines.flatMap((routine) => steps.map((step) => [...routine, step]));
  }
  return routines.filter((routine) => routine.length);
}

// What a "makes" lists, up to what else the turn does ("uses its Frightful
// Presence"), split into its alternatives at an "or" that opens another
// count ("two claw attacks or one claw and one bite attack").
export function multiattackAlternatives(clause: string): string[] {
  const listed = clause
    .split(/,?\s*(?:(?:and|or)\s+)?(?:then\s+)?\b(?:uses?|can|casts?)\b/i)[0]
    .replace(new RegExp(`(\\battacks?)\\s+or\\s+(?!${COUNT_WORD}\\s).*$`, "i"), "$1");
  return listed.split(new RegExp(`\\s+or\\s+(?=${COUNT_WORD}\\s)`, "i"));
}

// The items of one alternative: "three claw attacks and one bite attack",
// "two thorn vine attacks plus one...", "a claws attack and then either a
// bite or longsword attack".
export function multiattackItems(alternative: string): string[] {
  return alternative
    .replace(/[.,;:\s]+$/, "")
    .split(/,\s*(?:and\s+)?|\s+(?:and|plus)\s+/)
    .map((item) => item.trim().replace(/^(?:then\s+)?(?:either\s+)?/i, "").replace(/\s+(?:against|if|in place of|instead of)\s.*$/i, ""))
    .filter(Boolean);
}

// The sentence cut at each "or" that opens another "makes" (", or it makes
// two Rune Blast attacks", "or he makes three Fist attacks", "or it can cast
// one spell and make one..."): each part is one way to spend the turn.
export function multiattackParts(sentence: string): string[] {
  return sentence.split(/,?\s+or\s+(?=(?:[\p{L}\p{M}'’-]+\s+){0,4}?(?:makes?|casts?)\b)/iu);
}

// The printed wording made regular: "(humanoid form)" notes dropped, the
// medusa's dashes ("makes either three melee attacks - A and B - or two
// ranged attacks") read as a list and its alternative, and "or uses its
// Hurl Flame twice" (the efreeti) as "or makes two Hurl Flame attacks",
// "two slam attacks, two stomp attacks, or one of each" as its two
// alternatives, and a line that opens on its count ("Three Pitchfork
// attacks or...") as made; cut into sentences.
export function multiattackSentences(desc: string): string[] {
  return desc
    .replace(/\s+/g, " ")
    .trim()
    .replace(new RegExp(`^(?=${COUNT_WORD}\\s)`, "i"), "makes ")
    .replace(new RegExp(`(\\battacks?),\\s+(?=${COUNT_WORD}\\s[^.,;]*?attacks?,?\\s+or\\s+one of each\\b)`, "gi"), "$1 or ")
    .replace(/,?\s+or\s+one of each\b/gi, "")
    .replace(new RegExp(`\\buses\\s+(?:its\\s+)?((?:${NAME_WORD}\\s+){0,3}${NAME_WORD})\\s+(twice|three times)\\b`, "giu"), (_, name: string, times: string) =>
      `makes ${times === "twice" ? "two" : "three"} ${name} attacks`,
    )
    .replace(/\s*\([^)]*\bform\)/gi, "")
    .replace(/\bmakes either\b/gi, "makes")
    .replace(/\s+-\s+or\s+/g, " or ")
    .replace(/\s+-\s+/g, ": ")
    .split(/(?<=[.;])\s+/);
}

// The routines a Multiattack line names, first the main one, then any "Or
// it makes..." alternative. Null when a group it lists names no attack of
// the block ("makes two melee attacks", "two Necrotic Blast attacks" beside
// a Necrotic Burst), which leaves the count to parseMultiattackCount: a
// routine read past an unreadable group would plan the wrong swings.
export function parseRoutines(desc: string, attackNames: string[]): RoutineStep[][] | null {
  const routines: RoutineStep[][] = [];
  let unread = false;
  for (const sentence of multiattackSentences(desc)) {
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
    if (/^if\b/i.test(sentence)) {
      // "If both Mace attacks hit one creature...", "If the commander is
      // mounted, its mount can then make one Hooves attack": what follows
      // the routine, not another one.
      continue;
    }
    for (const part of multiattackParts(sentence)) {
      const listed = new RegExp(`makes?\\s+${COUNT_WORD}\\s+(?:\\w+\\s+)?attacks?\\s*:\\s*(.+)$`, "i").exec(part);
      const either = new RegExp(
        `makes?\\s+(${COUNT_WORD})\\s+(?:\\w+\\s+)?attacks?,?\\s+either\\s+with\\s+(?:its|his|her|their)\\s+([\\w ]+?)\\s+or\\s+(?:with\\s+)?(?:its|his|her|their)\\s+([\\w ]+?)\\.?$`,
        "i",
      ).exec(part);
      if (listed) {
        // "two attacks: one with its pike and one with its hooves or two with
        // its longbow": an " or " before a count opens another routine.
        for (const alternative of listed[1].split(new RegExp(`\\s+or\\s+(?=${COUNT_WORD}\\s)`, "i"))) {
          const found = routinesOfList(alternative, attackNames);
          unread ||= !found.length;
          routines.push(...found);
        }
        continue;
      }
      if (either) {
        // "three attacks, either with its longsword or its longbow".
        for (const name of [either[2], either[3]]) {
          const step = stepOf(`${either[1]} with its ${name}`, attackNames);
          unread ||= !step;
          if (step) {
            routines.push([step]);
          }
        }
        continue;
      }
      // "makes three claw attacks and one bite attack", "makes four attacks
      // with its tendrils, uses Reel, and makes one attack with its bite":
      // every group each "makes" lists, up to what else the turn does.
      // Each alternative of a single "makes" is a routine of its own; two
      // "makes" in one part are one routine.
      const made = part
        .split(/\bmakes?\s+/i)
        .slice(1)
        .filter((clause) => ATTACK_GROUP.test(multiattackItems(clause)[0] ?? ""))
        .map((clause) => multiattackAlternatives(clause).map((alternative) => listedRoutines(alternative, attackNames)));
      if (made.flat().some((found) => !found.length)) {
        unread = true;
      } else if (made.length === 1) {
        routines.push(...made[0].flat());
      } else if (made.length) {
        routines.push(made.flatMap((alternatives) => alternatives[0][0]));
      }
    }
  }
  return routines.length && !unread ? routines : null;
}
