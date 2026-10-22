import type { SaveAbility } from "@/lib/bestiary/statblock";
import { textKey } from "@/lib/language/text-logic";

// The clause a save prints, as numbers the engine runs (SRD 5.1, Saving
// Throws): the DC and ability, the dice, and what a FAILED save lays and for
// how long. Shared by a monster's abilities (monster-abilities.ts) and an
// attack's "Hit:" rider (src/lib/bestiary/attack-text.ts). Pure.

export const ABILITY_WORDS: Record<string, SaveAbility> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

export const DAMAGE_WORDS = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

export const CONDITION_WORDS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "paralyzed", "petrified", "poisoned", "restrained", "stunned", "unconscious",
];

// "DC 13 Constitution saving throw": an ability's and an attack's rider.
export const SAVE_DC = /DC\s*(\d{1,2})\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw/i;

// A condition word as a line prints it, as the engine names it.
export function conditionName(word: string): string {
  const name = textKey(word);
  return name === "knocked prone" ? "prone" : name === "asleep" ? "unconscious" : name;
}

export type SaveEffect = {
  save?: SaveAbility;
  dc?: number;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  condition?: string;
  // More conditions the same failure lays: "is blinded and deafened".
  also?: string[];
  // "for 1 minute" is 10 rounds; "until the end of its next turn" is 1;
  // "for 1 hour" 600, "for 24 hours" a day's 14400.
  rounds?: number;
  // "until the target finishes a long rest" (a succubus's kiss).
  untilLongRest?: boolean;
  // "until it is removed by the lesser restoration spell", "until freed by
  // greater restoration", "until the disease is cured": no count and no
  // repeat save; a cure ends it.
  lasting?: boolean;
  // The target repeats the save each round to end the condition.
  repeatSave?: boolean;
  // "falls unconscious for 10 minutes or until it takes damage".
  endsOnDamage?: boolean;
  // A heavier failure: "If the saving throw fails by 5 or more, the target
  // is also frightened". The condition lands only when the save misses the
  // DC by at least the margin.
  failBy?: { margin: number; condition: string };
  // The ability says it is magic ("against this magic"), which Magic
  // Resistance answers.
  magical?: boolean;
};

const CONDITIONS = `knocked prone|prone|asleep|${CONDITION_WORDS.join("|")}`;
// A condition a verb lays: "is paralyzed", "be magically charmed", "falls
// unconscious", "falling prone", "becoming poisoned". Not after a negation
// ("can't be charmed", "isn't knocked prone").
const LAID = new RegExp(
  `(?<!\\b(?:not|cannot|can't|never|won't)\\s)\\b(is|are|be|become|becomes|becoming|fall|falls|falling|being|lands?)\\s+(?:(?:also|then|instead|now|still|\\w+ly)\\s+)*(?:knocked\\s+)?(${CONDITIONS})\\b`,
  "gi",
);
// The conditions listed after the first: "blinded and deafened", "blinded,
// stunned, and deafened", "grappled (escape DC 14) and restrained".
const MORE = new RegExp(`^(?:\\s*\\([^)]*\\))?(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)(?:(?:is|be|becomes?|falls?)\\s+)?(?:knocked\\s+)?(${CONDITIONS})\\b`, "i");
const KNOCKED = /(?<!\b(?:not|isn't|aren't|or)\s)\bknock(?:s|ed)?\s+(?:(?:it|them|the (?:target|creature))\s+)?prone\b/i;
// A sentence about what a failed save does: "On a failure", "A creature that
// fails the save", "Those that fail", Tome of Beasts 3's "Fail:".
const FAILURE =
  /^(?:(?:otherwise|in addition|additionally|also),?\s+)?(?:on a fail(?:ed save|ed saving throw|ure)|if (?:it|the (?:saving throw|save)|(?:an? |the )?(?:[\w-]+ ){0,4}?[\w-]+) fails?\b|(?:(?:a|any|each|the)\s+)?(?:creature|target)s? (?:that|who) fails?\b|(?:those|creatures|targets) (?:that|who) fail\b|fail:)/i;
const ENDS_FAILED = /\bon a fail(?:ed save|ed saving throw|ure)\s*[.!]?$/i;
const SUCCESS = /^(?:on a success|if (?:it|the (?:target|creature|saving throw|save)|a (?:target|creature)) succeeds|(?:a|any|each|the) (?:creature|target)s? (?:that|who) succeeds?|if a creature's saving throw is successful)/i;
const FAIL_BY = /\bfails?\b[^.]*?\bby (\d{1,2})(?: or more\b|\s*\+)/i;
// A sentence that repeats the save the effect began with.
const REPEAT = /\b(?:repeats?|re-?rolls?) (?:the|its|this) sav(?:e|ing throw)|\bcan re-?save\b|\bsaving throw at the end of (?:each of )?its turns?\b/i;
// A disease or a curse whose condition holds while it lasts: "While
// diseased, the target is poisoned", "Until the disease is cured, the
// creature is poisoned".
const AFFLICTION = /\b(?:diseas\w*|infect\w*|curse[ds]?|contracts?)\b/i;
const WHILE_AFFLICTED = /^(?:while (?:diseased|infected|cursed)|until (?:the|this) (?:disease|curse|infection) (?:is|ends))/i;

type Sentence = { text: string; start: number };

// Sentences and semicolon clauses, each with where it starts. A5e prints its
// commas as double spaces ("On a failure  the target is paralyzed"); they are
// read as commas.
function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  const pattern = /[^.;!?\n]+(?:[.;!?]+|$)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (trimmed) {
      out.push({ text: trimmed, start: (match.index ?? 0) + raw.indexOf(trimmed) });
    }
  }
  // "5 ft. of it" and "1 min. Target" do not end a sentence: a piece that
  // starts in lower case belongs to the one before it.
  return out.reduce<Sentence[]>((joined, piece) => {
    const last = joined[joined.length - 1];
    if (last && /^[a-z(]/.test(piece.text) && !/;$/.test(last.text)) {
      last.text = `${last.text} ${piece.text}`;
      return joined;
    }
    return [...joined, { ...piece }];
  }, []);
}

// The conditions a clause lays, in order, from the first verb that lays one.
// `guarded`: in the save's own sentence, a verb counts only after the "or"
// (or "and", or a gerund) that gives what a failure brings, so "a creature
// that is frightened makes this save" lays nothing.
function laidIn(clause: string, guarded: boolean): { names: string[]; at: number } | null {
  for (const match of clause.matchAll(LAID)) {
    const verb = match[1].toLowerCase();
    const word = match[2].toLowerCase();
    const at = match.index ?? 0;
    if (word === "asleep" && !verb.startsWith("fall")) {
      continue;
    }
    if (verb === "being" && !/knocked/i.test(match[0])) {
      continue;
    }
    if (guarded && !/(?:ing)$/.test(verb) && !/\b(?:or|and|on)\s+(?:also\s+)?$/i.test(clause.slice(Math.max(0, at - 11), at))) {
      continue;
    }
    return { names: chained(conditionName(word), clause.slice(at + match[0].length)), at };
  }
  const knocked = KNOCKED.exec(clause);
  if (knocked && (!guarded || /\b(?:or|and)\s+(?:be\s+)?$/i.test(clause.slice(Math.max(0, knocked.index - 8), knocked.index)))) {
    return { names: chained("prone", clause.slice(knocked.index + knocked[0].length)), at: knocked.index };
  }
  // Tome of Beasts 3 drops the verb: "DC 15 Wisdom saving throw or
  // frightened 1 min", "or take 11 (2d10) radiant and blinded".
  const bare = new RegExp(`\\bsaving throw or (?:be )?(?:[^.;]*?\\band\\s+)?(${CONDITIONS})\\b`, "i").exec(clause);
  if (bare && bare[1].toLowerCase() !== "asleep") {
    const at = bare.index + bare[0].length - bare[1].length;
    return { names: chained(conditionName(bare[1]), clause.slice(bare.index + bare[0].length)), at };
  }
  // A failure's own sentence may name the condition with no verb, as Tome of
  // Beasts 3's bracket saves read spelled out: "On a failure, frightened
  // until the end of its next turn", "On a failure, 27 (6d8) poison damage
  // and knocked prone", "On a failure, Target incapacitated".
  if (!guarded) {
    const named = new RegExp(`(?:^(?:[^,]*,\\s*|fail:\\s*(?:[\\w-]+\\s+)?)?(?:(?:the\\s+)?target\\s+|it\\s+)?|\\band\\s+)(?:knocked\\s+)?(${CONDITION_WORDS.join("|")}|prone)\\b`, "i").exec(clause);
    if (named) {
      const at = named.index + named[0].length - named[1].length;
      return { names: chained(conditionName(named[1]), clause.slice(named.index + named[0].length)), at };
    }
  }
  return null;
}

// The first condition and those listed after it: "blinded and deafened",
// "knocked prone, pinned to the ground by a shard, and restrained".
function chained(first: string, after: string): string[] {
  const names = [first];
  let rest = after;
  for (let more = MORE.exec(rest); more; more = MORE.exec(rest)) {
    names.push(conditionName(more[1]));
    rest = rest.slice(more[0].length);
  }
  for (const more of rest.matchAll(new RegExp(`(?:,\\s*and|\\band)\\s+(?:(?:is|be|becomes?)\\s+)?(?:knocked\\s+)?(${CONDITIONS})\\b`, "gi"))) {
    if (more[1].toLowerCase() !== "asleep") {
      names.push(conditionName(more[1]));
    }
  }
  if (KNOCKED.test(rest)) {
    names.push("prone");
  }
  return [...new Set(names)];
}

const UNIT_ROUNDS: Record<string, number> = { round: 1, minute: 10, hour: 600, day: 14400 };

// How long a clause says something lasts, in rounds; null when it does not.
function roundsIn(clause: string): number | null {
  const turn = /\b(?:until|til) (?:the )?(?:end|start) of (?:its|their|the [a-z' ]+?'s|your) next turn/i.exec(clause);
  // "for 1 minute", "lasts 1 hour", and Tome of Beasts 3's "frightened 1 min"
  // (the clause begins at the condition's verb or word).
  const span = /(?:\b(?:for|lasts?(?: for)?) |^(?:\w+ ){0,2}?)(\d{1,3}) (round|minute|min|hour|hr|day)s?\b/i.exec(clause);
  if (turn && (!span || turn.index < span.index)) {
    return 1;
  }
  if (!span) {
    return null;
  }
  const unit = span[2].toLowerCase();
  return Number(span[1]) * UNIT_ROUNDS[unit === "min" ? "minute" : unit === "hr" ? "hour" : unit];
}

const ENDS_ON_DAMAGE =
  /\b(?:until|unless|if) (?:it|the (?:target|creature)|a creature) takes (?:any )?damage\b|\bends (?:for|on) (?:a|the) (?:creature|target) if (?:the creature|it|the target) takes damage\b|\bwakes? (?:up )?(?:early )?if (?:it|the (?:target|creature)) takes damage\b/i;

// The rider or effect clause of a line: DC, save, damage, condition and how
// long it lasts. Shared by abilities and by attacks' "Hit:" riders. Every
// condition it lays is one a failed save of this text lays: a condition named
// in a success clause, in a repeat save, against an advantage ("saving
// throws against being charmed") or for a failure by some margin (failBy)
// is not the failure's.
export function parseSaveEffect(raw: string): SaveEffect {
  const text = raw.replace(/[_*]/g, "").replace(/(\w) {2,}(?=\w)/g, "$1, ");
  const out: SaveEffect = {};
  const save = SAVE_DC.exec(text);
  if (save) {
    out.dc = Number(save[1]);
    out.save = ABILITY_WORDS[save[2].toLowerCase()];
  }
  // "14 (4d6) poison damage", and Tome of Beasts 3's "14 (4d6) poison and is
  // poisoned", where the type word ends the phrase.
  const dice = [
    ...text.matchAll(
      new RegExp(`\\d+\\s*\\((\\d{1,3}d\\d{1,3}(?:\\s*[+-]\\s*\\d+)?)\\)\\s+(${DAMAGE_WORDS.join("|")})(?:\\s+damage\\b|(?=\\s+and\\b|\\s*[,.;(]|\\s*$))`, "gi"),
    ),
  ];
  if (dice.length) {
    out.damage = dice.map((match) => match[1].replace(/\s+/g, "")).join("+");
    out.damageType = dice[0][2].toLowerCase();
  }
  if (/half as much damage on a successful|half (?:as much )?damage on a success|half damage with a successful|on a success(?:ful save)?,?\s+(?:it|the target|the creature|a creature)\s+takes\s+half\s+(?:the|that|as much)?\s*damage/i.test(text)) {
    out.halfOnSave = true;
  }
  const sentences = sentencesOf(text);
  const reading = save ? readFailure(text, sentences, save.index) : readUnsaved(text);
  Object.assign(out, reading);
  // What a repeat save brings ("becoming petrified on a failure", "until
  // freed by greater restoration") is not the first failure's.
  const repeat = sentences.findIndex((sentence, position) => position > 0 && REPEAT.test(sentence.text));
  const kept = (repeat >= 0 ? sentences.slice(0, repeat) : sentences)
    .filter((sentence) => !SUCCESS.test(sentence.text) && !/\bimmune\b/i.test(sentence.text))
    .map((sentence) => sentence.text)
    .join(" ");
  if (out.rounds === undefined && !out.lasting) {
    // No duration where the condition is laid: the first the text gives,
    // outside what a success brings.
    const rounds = roundsIn(kept);
    if (rounds !== null) {
      out.rounds = rounds;
    } else if (/until (?:it|the target|the creature)(?:'s)? (?:finishes|completes) a long rest/i.test(kept)) {
      out.untilLongRest = true;
    } else if (/until (?:it is |the (?:target|creature|disease|curse|poison) is )?(?:removed|cured|freed|ended)\b/i.test(kept)) {
      out.lasting = true;
    }
  }
  if (REPEAT.test(text)) {
    out.repeatSave = true;
  }
  // Taking damage ends the effect however late the text says so; a creature
  // that "wakes" is the unconscious one, so a sleep ends and the poison laid
  // with it stays (src/lib/dm/cast-at-player.ts marks which).
  const ends = sentences.find((sentence) => !SUCCESS.test(sentence.text) && ENDS_ON_DAMAGE.test(sentence.text));
  const laid = [out.condition, ...(out.also ?? [])];
  if (out.condition && ends && (!/\b(?:wakes?|awake|unconscious|asleep)\b/i.test(ends.text) || laid.includes("unconscious"))) {
    out.endsOnDamage = true;
  }
  if (/against this magic|magically/i.test(text)) {
    out.magical = true;
  }
  return out;
}

// A line with no save: the condition its "or be ..." clause names, as before.
function readUnsaved(text: string): SaveEffect {
  const condition = new RegExp(`(?:or|and)\\s+(?:be\\s+|become\\s+|is\\s+)?(knocked prone|${CONDITION_WORDS.join("|")})`, "i").exec(text);
  return condition ? { condition: conditionName(condition[1]) } : {};
}

// What the failed save at `at` lays: from the save's own sentence ("or be
// frightened", "falling prone on a failure", "prevents the poisoned
// condition") and from the sentences after it that say what a failure does,
// up to a sentence with a save of its own.
function readFailure(text: string, sentences: Sentence[], at: number): SaveEffect {
  const out: SaveEffect = {};
  const index = Math.max(0, sentences.findIndex((sentence, position) => at >= sentence.start && (position + 1 >= sentences.length || at < sentences[position + 1].start)));
  const own = sentences[index];
  const names: string[] = [];
  let durationFrom: string | null = null;
  const take = (laid: { names: string[]; at: number } | null, clause: string) => {
    if (!laid) {
      return;
    }
    if (!names.length) {
      durationFrom = clause.slice(laid.at);
    }
    names.push(...laid.names.filter((name) => !names.includes(name)));
  };
  if (own) {
    const after = own.text.slice(Math.max(0, at - own.start));
    // Tome of Beasts: "a successful DC 13 Constitution saving throw reduces the
    // poison damage by half and prevents the poisoned condition", which the
    // text before it lays.
    const prevents = new RegExp(`\\bprevents? (?:the )?(${CONDITION_WORDS.join("|")})(?: condition)?\\b`, "i").exec(after);
    const before = own.text.slice(0, Math.max(0, at - own.start));
    if (prevents) {
      names.push(conditionName(prevents[1]));
      const laidBefore = new RegExp(`\\b${prevents[1]}\\b[^.]*`, "i").exec(text);
      durationFrom = laidBefore ? laidBefore[0] : null;
    } else if (
      /\bsuccessful\s*$/i.test(before) &&
      !/^\S+ saving throw or\b/i.test(after.replace(/^DC\s*\d+\s+/i, "")) &&
      /\b(?:halves?|negates?|prevents?|avoids?|reduces?|half|isn't|is not|aren't|doesn't|none)\b/i.test(`${before.slice(-80)} ${after}`)
    ) {
      // A save that spares what the text before it lays: "takes 18 (4d8)
      // psychic damage and is paralyzed for 1d4 rounds, or takes half damage
      // and isn't paralyzed with a successful DC 15 Wisdom saving throw";
      // "... and is blinded; a successful DC 15 Dexterity saving throw ...
      // negates the blindness". Not what a success does not spare
      // ("prevents being pushed (but not being knocked prone)").
      const previous = index > 0 ? sentences[index - 1].text : "";
      const source = laidIn(before, false) ? before : previous;
      const laid = laidIn(source, false);
      const kept = laid ? laid.names.filter((name) => !new RegExp(`\\bbut not\\b[^)]*\\b${name === "prone" ? "prone" : name}\\b`, "i").test(after)) : [];
      take(kept.length && laid ? { names: kept, at: laid.at } : null, source);
    } else if (!FAIL_BY.test(after)) {
      take(laidIn(after, !ENDS_FAILED.test(after) && !FAILURE.test(own.text)), after);
    }
    // "Each creature in the area is blinded until the end of its next turn
    // unless it succeeds on a DC 15 Constitution saving throw."
    if (!names.length && /\bunless\b[^.]*$/i.test(before)) {
      take(laidIn(before, false), before);
    }
  }
  let afflicted = own ? AFFLICTION.test(own.text) : false;
  // A failure's clause runs on past a semicolon: "If the saving throw fails,
  // the face is torn off; the target takes 38 (8d6 + 10) slashing damage and
  // is stunned".
  let failing = false;
  let afterFailure = FAILURE.test(own?.text ?? "");
  let heavier: { margin: number; names: string[] } | null = null;
  for (const sentence of sentences.slice(index + 1)) {
    const line = sentence.text;
    // "On a failure, a target takes 13 (2d8 + 4) bludgeoning damage. If it is
    // Large or smaller, it is also grappled": the size clause goes on with
    // the failure before it.
    const continued = failing || (afterFailure && /^if (?:it|the (?:target|creature)) is (?:a |an )?(?:tiny|small|medium|large|huge)\b/i.test(line));
    failing = false;
    afterFailure = false;
    if (SAVE_DC.test(line) && !REPEAT.test(line)) {
      break;
    }
    // Past a repeat save, a failure is the repeat's: the gorgon's breath
    // restrains, and a second failure petrifies.
    if (REPEAT.test(line)) {
      break;
    }
    if (SUCCESS.test(line)) {
      continue;
    }
    if (continued && !FAILURE.test(line)) {
      take(laidIn(line, false), line);
      failing = line.endsWith(";");
      continue;
    }
    const margin = FAIL_BY.exec(line);
    if (margin && (FAILURE.test(line) || /^if\b/i.test(line))) {
      const laid = laidIn(line.slice(margin.index), false);
      if (laid && !heavier) {
        heavier = { margin: Number(margin[1]), names: laid.names };
      }
      continue;
    }
    if (FAILURE.test(line) || ENDS_FAILED.test(line)) {
      afflicted = afflicted || AFFLICTION.test(line);
      take(laidIn(line, false), line);
      failing = line.endsWith(";");
      afterFailure = true;
      continue;
    }
    if (afflicted && (WHILE_AFFLICTED.test(line) || /\buntil (?:the|this) (?:disease|curse|infection) is (?:cured|removed|lifted)\b/i.test(line))) {
      const laid = laidIn(line, false);
      if (laid && !names.length) {
        // It holds as long as the affliction: a curse "for 1 minute", or a
        // disease until it is cured.
        take(laid, line);
        durationFrom = own ? own.text.slice(Math.max(0, at - own.start)) : null;
        if (durationFrom === null || roundsIn(durationFrom) === null) {
          out.lasting = true;
        }
      }
    }
  }
  // A heavier failure's condition is the one it adds: "fails by 5 or more,
  // it is restrained and knocked prone. Otherwise ... is restrained" adds
  // prone, and one that only repeats the failure's adds nothing.
  const added = heavier?.names.find((name) => !names.includes(name));
  if (heavier && added) {
    out.failBy = { margin: heavier.margin, condition: added };
  }
  if (!names.length) {
    return out;
  }
  out.condition = names[0];
  if (names.length > 1) {
    out.also = names.slice(1);
  }
  const rounds = durationFrom === null ? null : roundsIn(durationFrom);
  if (rounds !== null && !out.lasting) {
    out.rounds = rounds;
  } else if (!out.lasting) {
    // Said in a sentence about the condition after it: "The condition lasts
    // for 1 minute", "The target remains paralyzed for 1 hour".
    const about = sentences
      .slice(index + 1)
      .find((sentence) => !SUCCESS.test(sentence.text) && new RegExp(`\\b(?:${names[0]}|condition|effect|lasts?)\\b`, "i").test(sentence.text) && roundsIn(sentence.text) !== null);
    const later = about ? roundsIn(about.text) : null;
    if (later !== null) {
      out.rounds = later;
    }
  }
  return out;
}
