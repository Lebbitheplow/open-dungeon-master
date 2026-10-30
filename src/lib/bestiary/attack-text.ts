import { CONDITION_WORDS, conditionName, parseSaveEffect, SAVE_DC } from "@/lib/dm/monster-abilities";
import type { SaveAbility } from "@/lib/bestiary/statblock";

// What an attack's printed line says beyond its bonus and dice (SRD 5.1,
// Monsters: Actions): melee or ranged, its reach and range, the typed dice
// that ride the hit ("plus 7 (2d6) fire damage"), and what else a hit does
// (a save against poison, knocked prone, grappled with an escape DC). The
// Multiattack routine that names which attacks a creature makes is
// multiattack-text.ts. Pure; read by statblock.ts when a pack row becomes a
// stored block.

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
    // The save's damage is its own sentence's, or an "On a failure, ..."
    // sentence's right after it (A5e, and Tome of Beasts 3's spelled-out
    // brackets): later sentences tell of other rules (a swallowed creature's
    // acid each turn, "if the poison reduces the target to 0 ..."). What a
    // failure lays may be said in the sentences after it ("On a failure, it
    // is knocked prone"); the save reader keeps what belongs to the failed
    // save (src/lib/dm/save-effect.ts).
    const rest = hit.slice(dcAt);
    const sentences = rest.split(/(?<=\.)\s+(?=[A-Z])/);
    const own = parseSaveEffect(sentences[0]);
    const failure = sentences[1] && /^on a fail(?:ure|ed save)\b/i.test(sentences[1]) ? parseSaveEffect(`${sentences[0]} ${sentences[1]}`) : own;
    const struck = own.damage ? own : failure;
    const followed = parseSaveEffect(rest);
    const laid = own.condition ? own : failure.condition ? failure : followed.condition ? followed : own;
    Object.assign(rider, {
      ...(own.save ? { save: own.save } : {}),
      ...(own.dc ? { dc: own.dc } : {}),
      ...(laid.condition ? { condition: laid.condition } : {}),
      ...(struck.damage ? { damage: struck.damage, damageType: struck.damageType } : {}),
      // "On a success, it takes half the damage" comes after the failure's.
      ...(struck.halfOnSave || (struck.damage && followed.halfOnSave) ? { halfOnSave: true } : {}),
      ...(laid.rounds ? { rounds: laid.rounds } : {}),
      ...(laid.untilLongRest ? { untilLongRest: true } : {}),
      ...(laid.lasting ? { lasting: true } : {}),
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
  // "its hit point maximum is reduced by an amount equal to the damage
  // taken" (a wight's Life Drain), or the clay golem's Slam: "must succeed
  // on a DC 15 Constitution saving throw or have its hit point maximum
  // reduced by an amount equal to the damage taken".
  const drain = /(?:hit point maximum is reduced|have its hit point maximum reduced) by an amount equal to the (necrotic )?damage (?:taken|dealt)/i.exec(hit);
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
  // So is what a failed save costs that no field holds (the bearded and
  // horned devils' infernal wound, the solar's "or die", a drain that lasts
  // "until removed by the greater restoration spell"), and damage dealt at
  // the start of the target's later turns (a rug of smothering's): the save
  // is still rolled, and the GM is told the rest.
  const unmodelled = /\b(?:pushed|pulled|knocked back|flung|hurled|speed (?:is )?(?:halved|reduced)|half (?:its )?speed|drops?\b[^.]*\b(?:weapon|holding|held)|can't take reactions|can't regain hit points|teleport\w*|infernal wound|saving throw or die|lasts until removed|at the start of each of the target's turns, the target takes)\b/i;
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
