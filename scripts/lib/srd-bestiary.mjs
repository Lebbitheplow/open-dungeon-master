// A stat block read straight off an SRD 5.1 rulebook page
// (src/lib/rulebook/srd-5.1.json), for scripts/test-enforce-srd-bestiary.mjs.
// Written apart from the engine's readers (src/lib/bestiary/*.ts) and from
// the creature table's (scripts/lib/srd-creature-text.mjs) on purpose: the
// audit compares what the engine plays with what the page prints, and a
// reader shared with the engine would agree with it by construction.

const ABILITY = { str: "str", dex: "dex", con: "con", int: "int", wis: "wis", cha: "cha" };
const ABILITY_WORD = {
  strength: "str", dexterity: "dex", constitution: "con",
  intelligence: "int", wisdom: "wis", charisma: "cha",
};

// The text of a line with its markdown emphasis gone.
export function plainText(text) {
  return String(text ?? "")
    .replace(/[*_]/g, "")
    .replace(/−/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function crNumber(text) {
  const value = String(text).trim();
  const fraction = /^(\d+)\/(\d+)$/.exec(value);
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(value);
}

function field(md, label) {
  // "Damage Resistance" in the singular on the archmage's page.
  const match = new RegExp(`^\\*\\*${label}s?\\*\\*\\s*(.*)$`, "m").exec(md);
  return match ? plainText(match[1]) : "";
}

function bonusList(text) {
  const out = {};
  // "Stealth +4 (+6 in dim light or darkness)": the bracket is a case of
  // its own, not the bonus.
  for (const part of text.replace(/\s*\([^)]*\)/g, "").split(/,\s*/)) {
    const match = /^(.+?)\s*([+-]\d+)$/.exec(part.trim());
    if (match) {
      out[match[1].trim().toLowerCase()] = Number(match[2]);
    }
  }
  return out;
}

// "40 ft., fly 80 ft. (hover), swim 40 ft." as feet by mode.
export function speedsOf(text) {
  const out = {};
  for (const part of text.split(/,\s*/)) {
    const match = /^(?:(walk|fly|swim|climb|burrow)\s+)?(\d+)\s*ft\.?/i.exec(part.trim());
    // "0 ft., swim 40 ft." (a shark): no walking speed at all.
    if (match && Number(match[2]) > 0) {
      out[(match[1] ?? "walk").toLowerCase()] = Number(match[2]);
    }
  }
  return out;
}

export function sensesOf(text) {
  const out = {};
  for (const sense of ["darkvision", "blindsight", "tremorsense", "truesight"]) {
    const match = new RegExp(`${sense} (\\d+) ft`, "i").exec(text);
    if (match) {
      out[sense] = Number(match[1]);
    }
  }
  const passive = /passive Perception (\d+)/i.exec(text);
  if (passive) {
    out.passivePerception = Number(passive[1]);
  }
  return out;
}

// The entries of one section: "***Name***. text" paragraphs, and a
// legendary section's "**Name**. text". A paragraph with no name of its own
// runs on from the entry before it.
function entriesOf(section) {
  const entries = [];
  // Lines inside a paragraph stay lines: a spell list prints one level a
  // line, and the engine's reader splits it there.
  const lines = (text) => text.split("\n").map(plainText).filter(Boolean).join("\n");
  for (const paragraph of section.split(/\n\s*\n/)) {
    const text = paragraph.trim();
    if (!text || text.startsWith(">") || text.startsWith("|") || text.startsWith("[")) {
      continue;
    }
    const named = /^\*{2,3}([^*]+?)\*{2,3}\.?\s*([\s\S]*)$/.exec(text);
    if (named) {
      entries.push({ name: plainText(named[1]).replace(/\.$/, ""), text: lines(named[2]) });
    } else if (entries.length) {
      entries.at(-1).text += `\n${lines(text)}`;
    } else {
      entries.push({ name: "", text: lines(text) });
    }
  }
  return entries;
}

// A page's own block, or the block under a heading on it ("### Half-Red
// Dragon Veteran" on the template's page). Null for a page that prints no
// block (Customizing NPCs).
export function readPage(md, { heading } = {}) {
  let body = md;
  if (heading) {
    const at = md.indexOf(`### ${heading}`);
    if (at < 0) {
      return null;
    }
    body = md.slice(at + heading.length + 4);
    const next = body.search(/^#{1,3} /m);
    body = next >= 0 ? body.slice(0, next) : body;
  }
  // The young red dragon's page drops the italics around this line.
  const head = /^\*?(Tiny|Small|Medium|Large|Huge|Gargantuan) ([^,*]+?)(?: \(([^)]*)\))?, ([^*\n]+)\*?$/m.exec(body);
  if (!head || !/\*\*Armor Class\*\*/.test(body)) {
    return null;
  }
  const abilityRow = /^\|\s*(\d+) \([^)]*\)\s*\|\s*(\d+) \([^)]*\)\s*\|\s*(\d+) \([^)]*\)\s*\|\s*(\d+) \([^)]*\)\s*\|\s*(\d+) \([^)]*\)\s*\|\s*(\d+) \([^)]*\)\s*\|/m.exec(body);
  const acText = field(body, "Armor Class");
  const hpText = field(body, "Hit Points");
  const hp = /^(\d+)(?: \(([^)]+)\))?/.exec(hpText);
  const challenge = /^([\d/]+) \(([\d,]+) XP\)/.exec(field(body, "Challenge"));
  const sections = body.split(/^#{6} /m);
  const traitPart = sections[0].slice(sections[0].search(/^\*\*Challenge\*\*.*$/m));
  const traitEntries = entriesOf(traitPart.replace(/^\*\*Challenge\*\*.*$/m, ""));
  // The ancient green dragon's page runs its actions on under its traits
  // with no Actions heading: an attack line or a Multiattack there is an
  // action.
  const misfiled = (entry) => /^Multiattack/.test(entry.name) || /^(Melee|Ranged)( or Ranged)? (Weapon|Spell) Attack:/.test(entry.text) || /\(Recharge/.test(entry.name) || entry.name === "Frightful Presence";
  const traits = traitEntries.filter((entry) => !misfiled(entry));
  const named = Object.fromEntries(
    sections.slice(1).map((part) => {
      const nl = part.indexOf("\n");
      return [part.slice(0, nl).trim().toLowerCase(), part.slice(nl + 1)];
    }),
  );
  const legendaryText = named["legendary actions"] ?? "";
  const legendaryEntries = entriesOf(legendaryText);
  const intro = legendaryEntries.find((entry) => !entry.name);
  const count = intro ? /can take (\d+) legendary actions/i.exec(intro.text) : null;
  const savesText = field(body, "Saving Throws");
  const saves = {};
  for (const [name, bonus] of Object.entries(bonusList(savesText))) {
    saves[ABILITY[name.slice(0, 3)] ?? name] = bonus;
  }
  return {
    size: head[1],
    type: head[2].trim().toLowerCase(),
    subtype: head[3] ? head[3].toLowerCase() : null,
    alignment: head[4].trim(),
    ac: Number(/^(\d+)/.exec(acText)?.[1]),
    acText,
    hp: hp ? Number(hp[1]) : null,
    hitDice: hp?.[2]?.replace(/\s+/g, "") ?? null,
    speeds: speedsOf(field(body, "Speed")),
    speedText: field(body, "Speed"),
    abilities: abilityRow
      ? { str: +abilityRow[1], dex: +abilityRow[2], con: +abilityRow[3], int: +abilityRow[4], wis: +abilityRow[5], cha: +abilityRow[6] }
      : null,
    saves,
    skills: bonusList(field(body, "Skills")),
    vulnerable: field(body, "Damage Vulnerabilitie"),
    resist: field(body, "Damage Resistance"),
    immune: field(body, "Damage Immunitie"),
    conditionImmune: field(body, "Condition Immunitie"),
    senses: sensesOf(field(body, "Senses")),
    sensesText: field(body, "Senses"),
    languages: field(body, "Languages"),
    cr: challenge ? crNumber(challenge[1]) : null,
    xp: challenge ? Number(challenge[2].replace(/,/g, "")) : null,
    traits: traits.filter((entry) => entry.name),
    actions: [...traitEntries.filter(misfiled), ...entriesOf(named.actions ?? "")],
    reactions: entriesOf(named.reactions ?? ""),
    legendaryIntro: intro?.text ?? "",
    legendary: legendaryText
      ? {
          count: count ? Number(count[1]) : null,
          options: legendaryEntries
            .filter((entry) => entry.name)
            .map((entry) => {
              const cost = /\(Costs (\d+) Actions\)/i.exec(entry.name);
              return { name: entry.name.replace(/\s*\(Costs \d+ Actions\)/i, ""), cost: cost ? Number(cost[1]) : 1, text: entry.text };
            }),
        }
      : null,
  };
}

// One action line read as an attack: its kind, bonus, reach or range, and
// every typed amount of the hit before any "or" (the second-form damage
// such as "or 8 (1d10+3) slashing damage if used with two hands" is not the
// blow). Null when the line is no attack roll.
export function readAttackLine(text) {
  const head = /^(Melee or Ranged|Melee|Ranged) (Weapon|Spell) Attack: ([+-]\d+) to hit(?: \([^)]*\))?, (.*?)\.\s*Hit: ([\s\S]*)$/.exec(text);
  if (!head) {
    return null;
  }
  const [, kind, form, bonus, reachText, hitText] = head;
  const reach = /reach (\d+) ft/.exec(reachText);
  const range = /range (\d+)\/(\d+) ft/.exec(reachText);
  // The hit's own amounts: before the save that some hits force (its
  // damage is the save's), and without a second form's ("or 8 (1d10+3)
  // slashing damage if used with two hands"), which is not the blow.
  const beforeSave = hitText.split(/[,.]? (?:and )?(?:the target|it|that creature|the creature) (?:must|is|has)\b|saving throw/)[0];
  // The first amount is the blow; after it only one added with "plus" (or
  // "and") rides it. The rest are the blow's other forms: "4 (1d8)
  // bludgeoning damage if wielded with two hands, or 6 (1d8 + 2) ... with
  // shillelagh".
  const amounts = [];
  for (const match of beforeSave.matchAll(/(\d+) \(([^)]+)\) (\w+)(?: or \w+)? damage|(?<![(\d])\b(\d+) (\w+) damage/g)) {
    if (amounts.length && !/(?:plus|and)\s*$/.test(beforeSave.slice(0, match.index))) {
      continue;
    }
    if (match[2]) {
      amounts.push({ average: Number(match[1]), dice: match[2].replace(/\s+/g, ""), type: match[3].toLowerCase() });
    } else {
      amounts.push({ average: Number(match[4]), dice: String(match[4]), type: match[5].toLowerCase() });
    }
  }
  const save = /DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i.exec(hitText);
  return {
    kind: kind.toLowerCase(),
    spell: form === "Spell",
    toHit: Number(bonus),
    reach: reach ? Number(reach[1]) : null,
    range: range ? { normal: Number(range[1]), long: Number(range[2]) } : null,
    amounts,
    save: save ? { dc: Number(save[1]), ability: ABILITY_WORD[save[2].toLowerCase()] } : null,
    hitText,
  };
}

// "2d6+5" (or "2d6 + 5", or "1d10+1d6") as the sum of its dice and its flat
// part, so two spellings of one blow compare equal.
export function diceShape(expression) {
  const dice = {};
  let flat = 0;
  for (const term of String(expression).replace(/\s+/g, "").replace(/-/g, "+-").split("+").filter(Boolean)) {
    const die = /^(-?\d*)d(\d+)$/i.exec(term);
    if (die) {
      const count = die[1] === "" ? 1 : die[1] === "-" ? -1 : Number(die[1]);
      dice[die[2]] = (dice[die[2]] ?? 0) + count;
    } else if (/^-?\d+$/.test(term)) {
      flat += Number(term);
    } else {
      return null;
    }
  }
  const sides = Object.keys(dice).sort((a, b) => a - b).filter((side) => dice[side] !== 0);
  return `${sides.map((side) => `${dice[side]}d${side}`).join("+")}${flat ? `${flat > 0 && sides.length ? "+" : ""}${flat}` : ""}` || "0";
}

// The SRD 5.1 XP by challenge (Monster Statistics, "Experience Points by
// Challenge Rating").
export const XP_BY_CR = new Map([
  [0, 10], [0.125, 25], [0.25, 50], [0.5, 100], [1, 200], [2, 450], [3, 700], [4, 1100],
  [5, 1800], [6, 2300], [7, 2900], [8, 3900], [9, 5000], [10, 5900], [11, 7200], [12, 8400],
  [13, 10000], [14, 11500], [15, 13000], [16, 15000], [17, 18000], [18, 20000], [19, 22000],
  [20, 25000], [21, 33000], [22, 41000], [23, 50000], [24, 62000], [25, 75000], [26, 90000],
  [27, 105000], [28, 120000], [29, 135000], [30, 155000],
]);

const SAVE_FIELD = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };

// A page's block in the shape of an Open5e row, so the engine's own reader
// (src/lib/bestiary/statblock.ts parseMonster) reads the SRD text itself,
// with no content pack: what it makes of the words is what it would make of
// a pack row printing them.
export function rowOfBlock(name, block) {
  const row = {
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    document__slug: "srd-text",
    size: block.size,
    type: block.type,
    subtype: block.subtype ?? "",
    alignment: block.alignment,
    armor_class: block.ac,
    hit_points: block.hp,
    hit_dice: block.hitDice,
    speed: block.speeds,
    skills: block.skills,
    damage_vulnerabilities: block.vulnerable,
    damage_resistances: block.resist,
    damage_immunities: block.immune,
    condition_immunities: block.conditionImmune,
    senses: block.sensesText,
    languages: block.languages,
    cr: block.cr,
    actions: block.actions.map((entry) => ({ name: entry.name, desc: entry.text })),
    special_abilities: block.traits.map((entry) => ({ name: entry.name, desc: entry.text })),
    reactions: block.reactions.map((entry) => ({ name: entry.name, desc: entry.text })),
    legendary_desc: block.legendaryIntro,
    legendary_actions: block.legendary
      ? block.legendary.options.map((option) => ({ name: option.cost > 1 ? `${option.name} (Costs ${option.cost} Actions)` : option.name, desc: option.text }))
      : null,
  };
  for (const [ability, word] of Object.entries(SAVE_FIELD)) {
    row[word] = block.abilities?.[ability] ?? 10;
    row[`${word}_save`] = block.saves[ability] ?? null;
  }
  return row;
}

// ---- comparing a page with the engine's block ----

// The page's defence line and the engine's, in one wording: "from
// nonmagical attacks not made with silvered weapons" is the same rule as
// "...that aren't silvered".
export const defenceWords = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/not made with (silvered|adamantine) weapons/g, "that aren't $1")
    .replace(/[;,.]/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// The engine's "40, fly 80 (hover)" as feet by mode, a walking speed of 0
// left out as the page reader leaves it.
export function speedsOfEngine(speed) {
  const out = {};
  for (const part of String(speed).replace(/\([^)]*\)/g, "").split(/,\s*/)) {
    const match = /^(?:([a-z]+)\s+)?(\d+)/.exec(part.trim());
    if (match && Number(match[2]) > 0) {
      out[match[1] ?? "walk"] = Number(match[2]);
    }
  }
  return out;
}

export const sameMap = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// An attack's name without its form note or plural, so the page's "Claw"
// finds the pack's "Claws" (the hezrou) and "Bite (Bat or Vampire Form
// Only)" its bite.
export const bareName = (name) => name.replace(/\s*\([^)]*\)\s*$/, "").replace(/s$/, "");

// The page's attack lines, each read.
export const pageAttacks = (block) => block.actions.map((entry) => ({ name: entry.name, line: readAttackLine(entry.text) })).filter((entry) => entry.line);

// The engine's attack of a page attack's name.
export const engineAttack = (stats, name) => stats.attacks.find((attack) => attack.name === name) ?? stats.attacks.find((attack) => bareName(attack.name) === bareName(name));
