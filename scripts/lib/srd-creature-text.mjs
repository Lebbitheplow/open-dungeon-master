// Readers for SRD 5.1 stat-block text, shared by the creature table's
// generator (scripts/generate-srd-creatures.mjs) and its test
// (scripts/test-srd-creatures.mjs). Two sources are read the same way: the
// Open5e pack's rows, whose action lines are the SRD's own words (the
// numbers stored beside them are not always: the black bear's attack_bonus
// field says +3 where its line says +4), and the SRD 5.1 rulebook pages in
// src/lib/rulebook/srd-5.1.json, a second conversion of the same text.
//
// Every reader returns plain data. A sentence of an attack that no field
// holds is kept word for word as a manual note, never dropped.

const ABILITY = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

const COUNT = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const ROUNDS = { round: 1, minute: 10, hour: 600, day: 14400 };

// The text of a line with its markdown emphasis and line breaks gone.
export function plain(text) {
  return String(text ?? "")
    .replace(/[*_]/g, "")
    .replace(/−/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// "1/2" or "0.5" as a number.
export function parseCr(text) {
  const value = String(text).trim();
  const fraction = /^(\d+)\/(\d+)$/.exec(value);
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(value);
}

// "7 (2d6)" or a flat "1": the dice as the dice engine writes them when the
// line prints dice, else the number.
function amountOf(average, dice) {
  return dice ? dice.replace(/\s+/g, "") : String(Number(average));
}

function roundsOf(count, unit) {
  return Number(count) * ROUNDS[unit.toLowerCase().replace(/s$/, "")];
}

// A paragraph's sentences, keeping "5 ft. of movement" whole.
function sentences(text) {
  return text
    .replace(/\bft\.(?=\s+[a-z(])/g, "ft\u0000")
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((sentence) => sentence.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
}

// The attack line's head. The SRD text slips now and then ("reach 10 ft.
// one target" with no comma, "reach 5 ft. and range 20/60 ft.", "ranged
// 150/600 ft."), and the header reads those too.
const HEADER =
  /^(Melee or Ranged|Melee|Ranged) (Weapon|Spell) Attack: ([+-]\d+) to hit(?: \([^)]*\))?, (?:reach (\d+) ft\.,?(?: (?:or|and) range (\d+)\/(\d+) ft\.,?)?|ranged? (\d+)\/(\d+) ft\.,?) ([^.]*?)\. Hit: (.*)$/;

const DAMAGE = String.raw`(?:(\d+) \(([^)]+)\)|(\d+)) (\w+) damage`;

// One action's line read as an attack, or null when it is no attack roll
// (Multiattack, a breath weapon, Invisibility).
export function parseAttack(name, desc) {
  const text = plain(desc);
  const header = HEADER.exec(text);
  if (!header) {
    return null;
  }
  const [, kind, , bonus, reach, thrownRange, thrownLong, range, longRange, target, hitText] = header;
  const attack = { name: plain(name).replace(/\.$/, ""), toHit: Number(bonus) };
  const hit = hitText.trim();
  const base = new RegExp(`^${DAMAGE}`).exec(hit);
  attack.damage = base ? amountOf(base[1] ?? base[3], base[2]) : "0";
  attack.type = base ? base[4].toLowerCase() : "";
  if (kind !== "Ranged" && reach && Number(reach) !== 5) {
    attack.reach = Number(reach);
  }
  if (kind === "Ranged") {
    attack.range = Number(range);
    attack.longRange = Number(longRange);
  } else if (thrownRange) {
    attack.thrown = true;
    attack.range = Number(thrownRange);
    attack.longRange = Number(thrownLong);
  }
  if (/\bprone creature\b/i.test(target)) {
    attack.proneTargetsOnly = true;
  }
  const riders = [...hit.matchAll(new RegExp(String.raw`\bplus ${DAMAGE}`, "g"))].map((match) => ({
    dice: amountOf(match[1] ?? match[3], match[2]),
    type: match[4].toLowerCase(),
  }));
  if (riders.length) {
    attack.riders = riders;
  }
  const onHit = readOnHit(hit, base ? base[0] : "");
  if (onHit) {
    attack.onHit = onHit;
  }
  return attack;
}

// What a hit does besides its damage, from the words after the damage: a
// save and what failing it costs, a grapple, and the sentences no field
// holds, kept as written.
function readOnHit(hit, damageWords) {
  const onHit = {};
  const manual = [];
  const parts = sentences(hit);
  const first = (parts.shift() ?? "")
    .slice(damageWords.length)
    .replace(new RegExp(String.raw`, or ${DAMAGE} (?:if used with two hands(?: to make a melee attack)?|with shillelagh)`, "g"), "")
    .replace(new RegExp(String.raw`,? plus ${DAMAGE}`, "g"), "");
  for (const clause of [first, ...parts]) {
    const sentence = clause.replace(/^[,.\s]+|[.\s]+$/g, "").replace(/^and /, "");
    if (sentence && !readClause(sentence, onHit, manual)) {
      manual.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`);
    }
  }
  if (manual.length) {
    onHit.manual = manual;
  }
  return Object.keys(onHit).length ? onHit : null;
}

// Reads one clause into the rider. True when every word of it is held by a
// field, or when the fields hold its rule and the clause itself went to the
// manual notes for the rest; false when no field holds it.
function readClause(sentence, onHit, manual) {
  const save = /^(?:if the target is (?:a creature(?: other than (?:an? )?([a-z ]+?))?|an? (Tiny|Small|Medium|Large|Huge) or smaller creature), it|the target|it) must (?:make|make on|succeed on) a DC (\d+) (\w+) saving throw(.*)$/i.exec(sentence);
  if (save) {
    const read = {};
    if (!readSaveOutcome(save[5].trim(), read)) {
      return false;
    }
    Object.assign(onHit, { save: ABILITY[save[4].toLowerCase()], dc: Number(save[3]) }, read);
    if (save[1]) {
      onHit.exempt = save[1].split(/ or /).map((word) => word.trim().toLowerCase());
    }
    if (save[2]) {
      onHit.maxSize = save[2];
    }
    return true;
  }
  const grapple = /^(?:the (?:target|creature) is|if the target is a creature, it is|if the target is an? (Tiny|Small|Medium|Large|Huge) or smaller creature, it is) grappled \(escape DC (\d+)\)$/i.exec(sentence);
  if (grapple) {
    onHit.condition = "grappled";
    onHit.escapeDc = Number(grapple[2]);
    if (grapple[1]) {
      onHit.maxSize = grapple[1];
    }
    return true;
  }
  const restrained = /^until (?:this|the) grapple ends, the (?:target|creature) is restrained((?:,| and ).*)?$/i.exec(sentence);
  if (restrained && onHit.condition === "grappled") {
    onHit.alsoCondition = "restrained";
    if (restrained[1]) {
      manual.push(`${sentence}.`);
    }
    return true;
  }
  if (/^the target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success$/i.test(sentence) && onHit.condition) {
    onHit.repeatSave = true;
    return true;
  }
  const failBy = /^if the saving throw fails by (\d+) or more, the target falls unconscious for the same duration, or until it takes damage or another creature uses an action to shake it awake$/i.exec(sentence);
  if (failBy && onHit.condition) {
    onHit.unconsciousFailBy = Number(failBy[1]);
    return true;
  }
  const atMost = /^if its saving throw result is (\d+) or lower, the poisoned target falls unconscious for the same duration, or until it takes damage or another creature takes an action to shake it awake$/i.exec(sentence);
  if (atMost && onHit.condition) {
    onHit.unconsciousAtMost = Number(atMost[1]);
    return true;
  }
  if (/^until this poison ends, the target is unconscious$/i.test(sentence) && onHit.condition === "poisoned") {
    onHit.alsoCondition = "unconscious";
    return true;
  }
  // Life Drain's reduction and its end, which drainMaxHp means.
  if (onHit.drainMaxHp && /^(?:this reduction lasts until the target finishes a long rest|the target dies if this effect reduces its hit point maximum to 0)$/i.test(sentence)) {
    return true;
  }
  return false;
}

// What failing (or making) the save costs: "taking 10 (3d6) poison damage
// on a failed save, or half as much damage on a successful one", "or take
// 5 (2d4) poison damage and become poisoned for 1 minute", "or be knocked
// prone", "or be paralyzed for 1 minute". False for an outcome no field
// holds (a disease, mummy rot).
function readSaveOutcome(text, onHit) {
  const half = new RegExp(`^, taking ${DAMAGE} on a failed save, or half as much damage on a successful one$`, "i").exec(text);
  if (half) {
    onHit.damage = amountOf(half[1] ?? half[3], half[2]);
    onHit.damageType = half[4].toLowerCase();
    onHit.halfOnSave = true;
    return true;
  }
  const take = new RegExp(String.raw`^or take ${DAMAGE}(?: and become (\w+) for (\d+) (minute|hour|round)s?)?$`, "i").exec(text);
  if (take) {
    onHit.damage = amountOf(take[1] ?? take[3], take[2]);
    onHit.damageType = take[4].toLowerCase();
    if (take[5]) {
      onHit.condition = take[5].toLowerCase();
      onHit.rounds = roundsOf(take[6], take[7]);
    }
    return true;
  }
  if (/^or be knocked prone$/i.test(text)) {
    onHit.condition = "prone";
    return true;
  }
  const become = /^or (?:be|become) (blinded|charmed|deafened|frightened|paralyzed|poisoned|restrained|stunned|unconscious)(?: for (\d+) (minute|hour|round)s?)?$/i.exec(text);
  if (become) {
    onHit.condition = become[1].toLowerCase();
    if (become[2]) {
      onHit.rounds = roundsOf(become[2], become[3]);
    }
    return true;
  }
  if (/^or its hit point maximum is reduced by an amount equal to the damage taken$/i.test(text)) {
    onHit.drainMaxHp = "all";
    return true;
  }
  return false;
}

// "Bite (Bat or Vampire Form Only)" and "claws" read as one name: no note,
// no plural.
function attackKey(name) {
  return name.replace(/\([^)]*\)/g, "").trim().toLowerCase().replace(/s$/, "");
}

// The Multiattack line read as the routine one Attack action makes, each
// step an attack by name and a count, with any "or" alternative after it:
// "two attacks: one with its bite and one with its claws", "three claw
// attacks and one bite attack", "two longsword attacks or two longbow
// attacks". Null when a step names no attack the block has.
export function parseRoutines(desc, attackNames) {
  const text = plain(desc).split(/(?<=\.)\s/)[0].replace(/\.$/, "");
  const body = text.includes(":") ? text.slice(text.indexOf(":") + 1) : text;
  const routines = [];
  for (const alternative of body.split(/,? or (?=(?:a|an|one|two|three|four|five|six) )/)) {
    const steps = [];
    for (const match of alternative.matchAll(/\b(a|an|one|two|three|four|five|six) (?:(?:attacks? )?with its ([\w-]+)|([\w-]+) attacks?)\b/gi)) {
      const word = match[2] ?? match[3];
      const attack = attackNames.find((name) => attackKey(name) === attackKey(word));
      if (!attack) {
        return null;
      }
      steps.push({ attack, count: COUNT[match[1].toLowerCase()] });
    }
    if (!steps.length) {
      return null;
    }
    routines.push(steps);
  }
  return routines.length ? routines : null;
}

// Attacks one Attack action holds, from a Multiattack line: "two attacks:
// one with its bite and one with its claws" is two, "three claw attacks
// and one bite attack" four, "two longsword attacks or two longbow
// attacks" two.
export function attacksPerTurn(desc) {
  const text = plain(desc).split(/(?<=\.)\s/)[0];
  const listed = /makes (\w+) (?:\w+ )?attacks?:/i.exec(text);
  if (listed) {
    return COUNT[listed[1].toLowerCase()] ?? 1;
  }
  const routine = text.split(/\bor\b/)[0];
  const counts = [...routine.matchAll(/\b(a|an|one|two|three|four|five|six) (?:[\w-]+ )?attacks?\b/gi)].map((match) => COUNT[match[1].toLowerCase()] ?? 0);
  return Math.max(1, counts.reduce((sum, count) => sum + count, 0));
}

// Speeds in one order, so two readings compare whole.
function ordered(speeds) {
  return Object.fromEntries(["walk", "fly", "swim", "climb", "burrow"].filter((mode) => speeds[mode] !== undefined).map((mode) => [mode, speeds[mode]]));
}

// "40 ft., climb 30 ft." or "0 ft., fly 90 ft. (hover)". A shapechanger's
// other forms in brackets ("30 ft. (40 ft., climb 30 ft. in bear or hybrid
// form)") are its true form's speed only.
export function parseSpeedText(text) {
  const speeds = { walk: 0 };
  for (const part of plain(text).replace(/\s*\((?!hover)[^)]*\)/gi, "").split(/,\s*/)) {
    const match = /^(?:(fly|swim|climb|burrow) )?(\d+) ft\.?(?: \(hover\))?$/i.exec(part.trim());
    if (match) {
      speeds[match[1] ? match[1].toLowerCase() : "walk"] = Number(match[2]);
    }
  }
  return ordered(speeds);
}

// The pack row's speed object in the same shape: no hover flag, walking 0
// when only a swim is printed.
export function packSpeeds(speed) {
  const speeds = { walk: Number(speed?.walk ?? 0) };
  for (const mode of ["fly", "swim", "climb", "burrow"]) {
    if (speed?.[mode]) {
      speeds[mode] = Number(speed[mode]);
    }
  }
  return ordered(speeds);
}

// The SRD writes the same rule two ways: "nonmagical attacks not made with
// silvered weapons" and "nonmagical attacks that aren't silvered". One is
// kept, so a damage line reads the same whichever conversion it came from.
export function defenseWords(text) {
  return plain(text).replace(/not made with (silvered|adamantine) weapons/gi, "that aren't $1");
}

// The special senses a Senses line names, in feet, passive Perception left out.
export function parseSenses(text) {
  const senses = {};
  for (const match of plain(text).matchAll(/\b(darkvision|blindsight|tremorsense|truesight) (\d+) ft\.?/gi)) {
    senses[match[1].toLowerCase()] = Number(match[2]);
  }
  return senses;
}

// Named paragraphs ("***Keen Smell***. The bear has...", or in bold alone,
// "**Petrifying Gaze**.") in order, each its own paragraph only: a page's
// closing lore ("**Gladiators** battle for...") has no stop after its bold
// words and is no part of its last action.
function namedParagraphs(md) {
  const out = [];
  for (const paragraph of md.split(/\n\s*\n/)) {
    const match = /^\*{2,3}([^*]+?)(?:\.\*{2,3}|\*{2,3}\.)\s*([\s\S]*)$/.exec(paragraph.trim());
    if (match) {
      out.push({ name: plain(match[1]).replace(/\.$/, ""), desc: plain(match[2]) });
    }
  }
  return out;
}

// One SRD 5.1 rulebook monster page read whole. `variant` names a sidebar
// whose actions replace the page's own (the diseased giant rat's bite);
// `from` names the block's own heading on a page that holds more than it
// (the half-dragon template's sample veteran).
export function parseRulebookPage(source, { variant, from } = {}) {
  // A quoted sidebar (a variant rule) is no part of the block unless asked
  // for; "**Sense**s" is one of the conversion's slips.
  const lines = String(from ? source.slice(source.indexOf(from)) : source).split("\n");
  const md = lines
    .filter((entry) => !entry.startsWith(">"))
    .join("\n")
    .replace(/\*\*(\w+)\*\*s\b/g, "**$1s**");
  const quoted = lines
    .filter((entry) => entry.startsWith(">"))
    .map((entry) => entry.replace(/^> ?/, ""))
    .join("\n");
  // A label as a pattern: "Damage Resistance" and "Damage Resistances"
  // both appear.
  const field = (label) => {
    const match = new RegExp(String.raw`\*\*${label}\*\*\s*([^\n]+)`).exec(md);
    return match ? plain(match[1]) : "";
  };
  // The size and type line, in italics, or bare where the italics slipped.
  const meta = /^\*([^*]+)\*/m.exec(md)?.[1] ?? /^((?:Tiny|Small|Medium|Large|Huge|Gargantuan) [^\n]+)$/m.exec(md)?.[1] ?? "";
  const sizeType = plain(meta).replace(/\s*\([^)]*\)/g, "").split(",")[0];
  const sizeMatch = /^(Tiny|Small|Medium|Large|Huge|Gargantuan) (.*)$/.exec(sizeType.trim());
  const score = String.raw`\s*(\d+) \([+-]?\d+\)\s*\|`;
  const scores = new RegExp(String.raw`\|${score.repeat(6)}`).exec(md);
  const sidebar = variant ? (quoted.split(`**${variant}**`)[1] ?? "") : "";
  const sections = md.split(/^#{1,6}\s*(?:Reactions|Legendary Actions)\s*$/m)[0];
  const [traitPart, ...actionParts] = sections.split(/^#{1,6}\s*Actions\s*$/m);
  let traits = namedParagraphs(traitPart.split(/\*\*Challenge\*\*[^\n]*\n/)[1] ?? "");
  let actions = namedParagraphs(actionParts.join("\n"));
  // A page whose Actions heading slipped: the actions start at its
  // Multiattack or its first attack line.
  const firstAction = actionParts.length ? -1 : traits.findIndex((entry) => entry.name === "Multiattack" || parseAttack(entry.name, entry.desc));
  if (firstAction >= 0) {
    actions = traits.slice(firstAction);
    traits = traits.slice(0, firstAction);
  }
  if (sidebar) {
    const replaced = namedParagraphs(sidebar);
    actions = actions.map((action) => replaced.find((entry) => entry.name === action.name) ?? action);
  }
  const saves = field("Saving Throws?");
  return {
    size: sizeMatch?.[1] ?? "",
    type: (sizeMatch?.[2] ?? "").toLowerCase(),
    ac: Number(/^(\d+)/.exec(field("Armor Class"))?.[1] ?? 0),
    hp: Number(/^(\d+)/.exec(field("Hit Points"))?.[1] ?? 0),
    speeds: parseSpeedText(field("Speed")),
    abilities: scores
      ? { str: Number(scores[1]), dex: Number(scores[2]), con: Number(scores[3]), int: Number(scores[4]), wis: Number(scores[5]), cha: Number(scores[6]) }
      : null,
    saves: saves ? [...saves.matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\b/g)].map((match) => match[1].toLowerCase()) : [],
    resist: defenseWords(field("Damage Resistances?")),
    immune: defenseWords(field("Damage Immunit(?:y|ies)")),
    vulnerable: defenseWords(field("Damage Vulnerabilit(?:y|ies)")),
    conditionImmune: field("Condition Immunit(?:y|ies)"),
    senses: parseSenses(field("Senses")),
    cr: parseCr(/^([\d/]+)/.exec(field("Challenge"))?.[1] ?? "0"),
    traits,
    actions,
  };
}
