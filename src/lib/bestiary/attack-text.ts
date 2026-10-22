import { CONDITION_WORDS, conditionName, parseSaveEffect, SAVE_DC } from "@/lib/dm/monster-abilities";
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

// What a hit deals instead in a case the engine can tell: at half its hit
// points or fewer (a swarm's weaker bite, "if the troll is bloodied"), or at
// range (a thrown spear's "in melee or ... at range"). A whole blow: its
// dice, its types and the dice riding it.
export type AttackAlternative = { when: "bloodied" | "ranged"; damage: string; type: string; riders?: TypedDice[] };

export type AttackText = {
  mode?: "melee" | "ranged" | "both";
  spellAttack?: boolean;
  // The damage prints as magical ("magical bludgeoning damage").
  magical?: boolean;
  alternatives?: AttackAlternative[];
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
  // The hit opens with no damage of its own (a Giant Spider's Web): what
  // it does is its on-hit rider.
  effectOnly?: boolean;
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
  // The kind as printed, and its misprints: "Melee Weapon or Ranged Attack"
  // (Black Flag), "Melee Weapon Damage:" and "Ranged Magical Attack:" (Tome
  // of Beasts).
  const kind =
    /(melee or ranged|melee|ranged)\s+(weapon|spell|magical)\s+(?:attack|damage)\b/i.exec(text) ??
    /\b(melee)\s+(weapon|spell)\s+or\s+ranged(?:\s+(?:weapon|spell))?\s+attack/i.exec(text);
  if (kind) {
    const word = kind[1].toLowerCase();
    const both = word === "melee or ranged" || /\bor\s+ranged/i.test(kind[0]);
    out.mode = both ? "both" : word === "melee" ? "melee" : "ranged";
    out.spellAttack = /^(?:spell|magical)$/i.test(kind[2]);
  }
  // Tome of Beasts 3 prints its numbers bare: "+8 to hit, 10 ft." (reach),
  // "+5 to hit 30/120'" or a ranged "+7 to hit, 60 ft." (range), and once
  // "+8 to hit 5.'". Feet are spelled "feet" in A5e and a few lines, and some
  // ranges print no unit at all ("range 80/320,").
  const FEET = "(?:ft\\b|feet\\b|')";
  const near = new RegExp(`to hit,?\\s+(?:reach\\s+)?(\\d{1,3})\\.?\\s*${FEET}`, "i").exec(text);
  const reach = new RegExp(`reach\\s+(\\d{1,3})\\s*${FEET}`, "i").exec(text) ?? (out.mode !== "ranged" ? near : null);
  // A swarm's "reach 0 ft." (a creature in its space) is a reach too.
  if (reach) {
    out.reach = Number(reach[1]);
  }
  const range =
    new RegExp(`\\branged?\\s+(\\d{1,4})(?:\\s*\\/\\s*(\\d{1,4}))?\\s*${FEET}`, "i").exec(text) ??
    /\branged?\s+(\d{1,4})\s*\/\s*(\d{1,4})\b/i.exec(text) ??
    new RegExp(`to hit,?\\s+(\\d{1,4})\\s*\\/\\s*(\\d{1,4})\\s*${FEET}`, "i").exec(text) ??
    (out.mode === "ranged" ? near : null);
  if (range) {
    out.range = { normal: Number(range[1]), long: Number(range[2] ?? range[1]) };
  }
  // A kind the line leaves out ("Attack: +4 to hit, reach 5 ft. or range
  // 20/60 ft."), or a melee line that prints only a range: "range 5 ft." is
  // its reach (a mamura's claw, a bar brawl's "range 0 ft."), and a range
  // with a long range is a ranged attack misprinted (an A5e drider's
  // longbow, a guardian naga's spit).
  if (!out.mode && (out.reach !== undefined || out.range)) {
    out.mode = out.reach !== undefined && out.range ? "both" : out.range ? "ranged" : "melee";
  } else if (out.mode === "melee" && out.reach === undefined && out.range) {
    if (out.range.long === out.range.normal && !/\//.test(range?.[0] ?? "")) {
      out.reach = out.range.normal;
    } else {
      out.mode = "ranged";
    }
    if (out.mode === "melee") {
      delete out.range;
    }
  }
  const hit = hitClause(text);
  // A choice of types ("cold, fire, lightning, poison, or thunder damage (its
  // choice)") is read as the first type named.
  const words = DAMAGE_WORDS.join("|");
  const typeList = `(?:magical\\s+)?(${words})\\b(?:,?\\s+(?:or\\s+)?(?:${words})\\b)*`;
  // The hit's own type is the one its clause opens with ("Hit: 1 piercing
  // damage", "Hit: 7 (1d8 + 3) piercing damage"); else the first typed dice
  // before a saving throw, whose damage is the save's and not the hit's (a
  // Poisonous Snake's "taking 5 (2d4) poison damage on a failed save").
  const own =
    new RegExp(`^\\s*\\d+\\s*(?:\\([^)]*\\)\\s*)?${typeList}`, "i").exec(hit) ??
    new RegExp(`\\d+\\s*\\([^)]*\\)\\s+${typeList}\\s+damage`, "i").exec(hit.split(/saving throw/i)[0]);
  // The hit's own dice open the clause: "Hit: 7 (1d8 + 3) piercing damage".
  const base = /^\s*(\d{1,3})\s*\(\s*(\d{1,3}d\d{1,3}(?:\s*[+-]\s*\d{1,3})?)\s*\)/i.exec(hit);
  // A flat hit with no dice ("Hit: 1 piercing damage", a homunculus) is its
  // own base.
  const flat = !base ? new RegExp(`^\\s*(\\d{1,3})\\s+(?:magical\\s+)?(${words})\\s+damage`, "i").exec(hit) : null;
  let printed = base ? Number(base[1]) : flat ? Number(flat[1]) : 0;
  if (base) {
    out.baseDice = compact(base[2]);
  } else if (flat) {
    out.baseDice = flat[1];
  }
  // A hit whose type the block leaves to a trait or the creature ("damage
  // of the type determined by Apothecary") is untyped, never its rider's.
  if (own) {
    out.types.push(own[1].toLowerCase());
    if (/\bmagical\s/i.test(own[0])) {
      out.magical = true;
    }
  } else if (base || flat) {
    out.types.push("untyped");
  }
  // Each "plus 7 (2d6) fire damage" (Tome of Beasts 3: "+ 7 (2d6) fire",
  // Black Flag: "piercing and 3 (1d6) fire damage") rides the hit under its
  // own type, or untyped when it names none; an "and" before the hit's save
  // only, since after it the dice are the save's. One that holds only
  // sometimes ("if used with two hands", "if the swarm has half of its hit
  // points or fewer", "when Enlarged") or burns on later turns ("ongoing fire
  // damage") is no part of the hit: the DM's to apply.
  const manual: string[] = [];
  let unread = 0;
  const saveAt = hit.search(/saving throw/i);
  // The dice an "or ..." blow carries are its own, not this one's.
  const ors = orClauses(hit.split(/saving throw/i)[0], words);
  const orSpans = ors.map((or) => [or.index, or.index + or.length]);
  for (const plus of hit.matchAll(/(?:plus|\+|and)\s+(\d+)\s*\(\s*(\d{1,3}d\d{1,3}(?:\s*[+-]\s*\d+)?)\s*\)\s*/gi)) {
    if (orSpans.some(([from, to]) => (plus.index ?? 0) >= from && (plus.index ?? 0) < to)) {
      continue;
    }
    const after = hit.slice((plus.index ?? 0) + plus[0].length);
    const typed = new RegExp(`^${typeList}(?:\\s+damage\\b)?`, "i").exec(after);
    if (/^and/i.test(plus[0]) && (!typed || (saveAt >= 0 && (plus.index ?? 0) > saveAt))) {
      continue;
    }
    const bare = /^damage\b/i.exec(after);
    const tail = after.slice((typed ?? bare)?.[0].length ?? 0);
    if (/^ongoing\b/i.test(after) || ((typed || bare) && /^\s*(?:if|when|while|against)\b/i.test(tail))) {
      manual.push(`${plus[0].replace(/^(?:plus|\+|and)\s+/i, "").trim()} ${after.split(/[.;]/)[0].trim()}`);
      continue;
    }
    printed += Number(plus[1]);
    if (!typed && !bare) {
      unread += 1;
      // Dice no damage type names ("plus 2 (1d4) Charisma damage", a chort
      // devil's): the DM's, said so on the hit.
      manual.push(`${plus[0].replace(/^(?:plus|\+|and)\s+/i, "").trim()} ${after.split(/[.;,]/)[0].trim()}`.trim());
      continue;
    }
    const type = typed ? typed[1].toLowerCase() : "untyped";
    out.riders.push({ dice: compact(plus[2]), type });
    if (!out.types.includes(type)) {
      out.types.push(type);
    }
  }
  const alternatives = readAlternatives(ors, manual, out.types[0]);
  if (alternatives.length) {
    out.alternatives = alternatives;
  }
  // The printed average counts every rider of the hit; a blow whose riders
  // were not all read has no printed dice to stand on.
  if ((base || flat) && !unread) {
    out.printedAverage = printed;
  }
  const effectOnly = !base && !flat;
  if (effectOnly) {
    out.effectOnly = true;
  }
  const onHit = readOnHit(hit, effectOnly);
  if (manual.length) {
    out.onHit = { ...onHit, manual: [...(onHit?.manual ?? []), ...manual] };
  } else if (onHit) {
    out.onHit = onHit;
  }
  return out;
}

// "or 5 (2d4) piercing damage if the swarm has half of its hit points or
// fewer", "or 7 (1d8 + 3) slashing damage if used with two hands": each "or"
// blow of the hit, before its save. One the engine can tell (half its hit
// points, at range) is an alternative; any other (two hands, a charge, a
// form, Enlarge) is a line in `manual` for the DM, who knows how it was made.
const BLOODIED = /\bhalf (?:of )?its (?:hit points|hp)\b|\bhalf or fewer hit points\b|\bis bloodied\b/i;

type OrClause = { index: number; length: number; text: string; average: string; dice: string; type: string | null; riders: TypedDice[]; condition: string };

// Each "or" blow of a hit: its dice and types, the dice riding it before its
// condition ("or 9 (2d8) piercing damage plus 7 (2d6) poison damage if the
// hydra has half its hit points or fewer"), and the condition, which ends at
// the next comma or rider: a rider after it ("if used with two hands, plus 3
// (1d6) fire damage", "if used in two hands plus 14 (4d6) necrotic damage")
// rides every blow.
function orClauses(hit: string, words: string): OrClause[] {
  const types = `(?:magical\\s+)?(?:${words})\\b(?:,?\\s+(?:or\\s+)?(?:${words})\\b)*`;
  const dice = "\\d{1,3}d\\d{1,3}(?:\\s*[+-]\\s*\\d{1,3})?";
  const rider = `(?:,?\\s*(?:plus|\\+|and)\\s+\\d+\\s*\\(\\s*${dice}\\s*\\)\\s*(?:${types})?(?:\\s+damage)?)`;
  const or = new RegExp(`,?\\s+or\\s+(\\d+)\\s*\\(\\s*(${dice})\\s*\\)\\s*(${types})?\\s*(?:damage\\b)?(?:\\s*\\([^)]*\\))?(${rider}*)\\s*((?:if|when|while|at|against|in|with|on|to)\\b(?:(?!\\s(?:plus|\\+|and)\\s+\\d+\\s*\\()[^,.;])*)?`, "gi");
  return [...hit.matchAll(or)].map((match) => ({
    index: match.index ?? 0,
    length: match[0].length,
    text: match[0].replace(/^,?\s+/, "").trim(),
    average: match[1],
    dice: compact(match[2]),
    type: match[3] ? (new RegExp(`(${words})`, "i").exec(match[3])?.[1].toLowerCase() ?? null) : null,
    riders: [...(match[4] ?? "").matchAll(new RegExp(`\\(\\s*(${dice})\\s*\\)\\s*(?:magical\\s+)?(${words})?`, "gi"))].map((entry) => ({
      dice: compact(entry[1]),
      type: entry[2]?.toLowerCase() ?? "untyped",
    })),
    condition: (match[5] ?? "").trim(),
  }));
}

// The "or" blows the engine can tell apart (half its hit points, at range)
// as alternatives; any other (two hands, a charge, a form, Enlarge) is a line
// in `manual` for the DM, who knows how the blow was made.
// An "or" blow that names no type ("or 5 (2d4) if the bar brawl has half its
// hit points or fewer") deals the hit's own.
function readAlternatives(ors: OrClause[], manual: string[], ownType: string | undefined): AttackAlternative[] {
  const out: AttackAlternative[] = [];
  for (const or of ors) {
    const when = BLOODIED.test(or.condition) ? "bloodied" : /^(?:at range|if thrown|when thrown)\b/i.test(or.condition) ? "ranged" : null;
    const type = or.type ?? ownType;
    if (when && type) {
      out.push({
        when,
        damage: [or.dice, ...or.riders.map((rider) => rider.dice)].join("+"),
        type: [type, ...or.riders.map((rider) => rider.type).filter((entry) => entry !== type)].join("/"),
        ...(or.riders.length ? { riders: or.riders } : {}),
      });
    } else {
      manual.push(or.text);
    }
  }
  return out;
}

// The clause after "Hit:"; in a document that prints no label (Tome of
// Beasts 3: "+8 to hit, 10 ft., one target, 18 (3d8+5) slashing damage"),
// the line from its first dice, or after the bonus when it prints none.
function hitClause(text: string): string {
  const label = text.search(/\bhit:/i);
  if (label >= 0) {
    return text.slice(label + 4);
  }
  const bonus = /to hit\b/i.exec(text);
  const after = bonus ? text.slice(bonus.index + bonus[0].length) : text;
  const dice = after.search(/\d{1,3}\s*\(\s*\d{1,3}d\d/i);
  if (dice >= 0) {
    return after.slice(dice);
  }
  // No dice: what the hit does follows the target ("one creature,. The
  // target is grappled").
  const target = /\b(?:one|single|each)\b[^.,]*?\b(?:target|creature|tgt)s?\b[^.,]*[.,]*\s*/i.exec(after);
  return target ? after.slice(target.index + target[0].length) : after;
}

// What a hit does besides its damage.
function readOnHit(hit: string, effectOnly: boolean): OnHitRider | null {
  const rider: OnHitRider = {};
  const dcAt = hit.search(SAVE_DC);
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
  const grapple = /(?:target|it|creature)(?: is)? grappled\s*\(escape DC\s*(\d{1,2})\)/i.exec(hit);
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
  const sentences = hit.split(/(?<=\.)\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  let manual = sentences.filter((sentence) => /\b(?:disease|diseased|cursed|curse|lycanthrop\w*|swallowed|petrif\w*|strength score is reduced|stable but poisoned)\b/i.test(sentence));
  // What a hit (or its save) does that no engine models: a push or a pull,
  // a speed cut, a dropped weapon, lost reactions. The sentence goes to the
  // DM, as the issue-473 audit found some 290 of them dropped.
  const unmodelled = /\b(?:pushed|pulled|knocked back|flung|hurled|speed (?:is )?(?:halved|reduced)|half (?:its )?speed|drops?\b[^.]*\b(?:weapon|holding|held)|can't take reactions|can't regain hit points|teleport\w*)\b/i;
  manual = [...manual, ...sentences.filter((sentence) => unmodelled.test(sentence) && !manual.includes(sentence))];
  // A hit that only lays an effect: the condition its first sentence names
  // ("The target is restrained by webbing", "it is knocked prone"), and what
  // else it says (the webbing's escape, an attachment, a sleep) for the DM.
  if (effectOnly && !rider.condition && !rider.damage && !rider.swallow) {
    const laid = new RegExp(`\\b(?:target|creatures?|it)\\b[^.]*?\\b(?:is|are|becomes?)\\s+(?:magically\\s+)?(knocked prone|${CONDITION_WORDS.join("|")})\\b`, "i").exec(sentences[0] ?? "");
    if (laid) {
      rider.condition = conditionName(laid[1]);
    }
    manual = [...new Set([...manual, ...sentences.slice(laid ? 1 : 0)])];
  }
  manual = manual.slice(0, 3);
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
// have is left out.
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
// A5e's way of saying it: "attacks once with its bite and twice with its
// claws", "attacks three times with its tentacle", "attacks with its horns
// and its claws", "attacks twice".
const TIMES: Record<string, string> = { once: "one", twice: "two", thrice: "three", "three times": "three", "four times": "four", "five times": "five", "six times": "six" };
const TIMES_WORD = "once|twice|thrice|three times|four times|five times|six times";

function a5eMultiattack(text: string): string {
  // "attacks" the verb, never the noun of "makes two attacks with its claws".
  const verb = `(?<!\\b(?:${COUNT_WORD}|melee|ranged|weapon|spell|its|his|her|their)\\s)\\battacks`;
  return text
    .replace(new RegExp(`${verb}\\s+(${TIMES_WORD})\\s+with\\s+(its|his|her|their)\\s`, "gi"), (_, times: string, its: string) => `makes ${TIMES[times.toLowerCase()]} attack${times.toLowerCase() === "once" ? "" : "s"} with ${its} `)
    .replace(new RegExp(`${verb}\\s+with\\s+(its|his|her|their)\\s`, "gi"), (_, its: string) => `makes one attack with ${its} `)
    .replace(new RegExp(`\\band\\s+(${TIMES_WORD})\\s+with\\s+(its|his|her|their)\\s`, "gi"), (_, times: string, its: string) => `and ${TIMES[times.toLowerCase()]} attack${times.toLowerCase() === "once" ? "" : "s"} with ${its} `)
    .replace(/(\bmakes one attack with (?:its|his|her|their) [^.,;]+?) and (its|his|her|their) /gi, "$1 and one attack with $2 ")
    .replace(new RegExp(`${verb}\\s+(${TIMES_WORD})(?=\\s*[.;]|$)`, "gi"), (_, times: string) => `makes ${TIMES[times.toLowerCase()]} attacks`);
}

// Tome of Beasts 3 names its attacks with no noun and often no verb: "Three
// Claws.", "One Bite and two Kicks or three Spit Worms.", "Uses its
// Frightful Presence then one Bite and two Claws." Each count before a
// capitalized name is that many of the attack so named.
// The count in either case, the name only capitalized.
const ANY_CASE_COUNT = "(?:[Aa]n?|[Oo]ne|[Tt]wo|[Tt]hree|[Ff]our|[Ff]ive|[Ss]ix|[Ss]even|[Ee]ight|[Nn]ine|[Tt]en|\\d{1,2})";

function namedCounts(text: string): string {
  return text
    .replace(new RegExp(`\\bthen\\s+(?=${COUNT_WORD}\\s)`, "gi"), "then makes ")
    .replace(new RegExp(`\\b(${ANY_CASE_COUNT})\\s+((?:[A-Z][\\p{L}'’-]*)(?:\\s+[A-Z][\\p{L}'’-]*)*)(?!\\s+attacks?\\b)(?=\\s*(?:[,.;]|\\s(?:or|and|plus)\\s|$))`, "gu"), "$1 $2 attacks");
}

export function multiattackSentences(desc: string): string[] {
  return namedCounts(a5eMultiattack(desc.replace(/\s+/g, " ").trim()))
    .replace(new RegExp(`^(?=${COUNT_WORD}\\s)`, "i"), "makes ")
    .replace(/(^|[.;]\s+)(?=(?:[Oo]ne|[Tt]wo|[Tt]hree|[Ff]our|[Ff]ive|[Ss]ix)\s+[A-Z])/g, "$1makes ")
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
