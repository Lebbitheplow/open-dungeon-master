// Reads the Open5e magic-item descriptions and emits the mechanically
// parseable ones into src/lib/classes/magic-items.json.
//
// Like the class-resource generator, the OUTPUT IS COMMITTED and loaded at
// runtime (the AC engine runs client-side in the builder, so it cannot hit
// the content DB). Run by hand when the content pack changes:
//
//   node scripts/generate-magic-items.mjs          # write the file
//   node scripts/generate-magic-items.mjs --check   # fail if stale
//   node scripts/generate-magic-items.mjs --explain # print each row's sentences
//
// Only the clean, high-value patterns are parsed (flat AC and save bonuses,
// the Bracers-of-Defense unarmored bonus, ability-setting items, and damage
// resistances). Everything else stays narrative, exactly like the feature
// long tail. Weapon and armor `+N` are handled by the item NAME elsewhere
// (srd/armor.ts magicItemBonus), so the flat-AC effect deliberately skips
// armor and shield categories to avoid double-counting.
//
// An effect is read from ONE SENTENCE, and only from a sentence that gives
// the wearer a standing benefit: "the weapon ignores resistance to slashing
// damage" gives its wielder nothing, a potion's hour is not a worn effect, and
// an example of what a sword could do is not what it does. What the words
// cannot settle is corrected by hand in scripts/lib/magic-item-corrections.mjs.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3-multiple-ciphers";
import { ADDED, DROPPED, REPLACED } from "./lib/magic-item-corrections.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDb = join(root, "data", "content", "open5e.sqlite");
const outPath = join(root, "src", "lib", "classes", "magic-items.json");

const ABILITY = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

const CLASSES = [
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
];

// The thirteen damage types, and the one keyword the damage engine reads
// beside them (Armor of Invulnerability).
const RESISTABLE = new Set([
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
  "nonmagical",
]);

// Used up, not worn: what one of these does lasts an hour and is the use_item
// tool's to apply.
const CONSUMABLE = /potion|scroll|ammunition|arrow/i;

// Marks of a sentence that is not a standing benefit: a duration, a trigger,
// a condition the wearer has to be in, an example, a table cell.
const NOT_STANDING =
  /\||\bfor 1 (?:hour|minute)|\bfor \d+ (?:hours|minutes|rounds)|\bfor the next |\bwhen you (?:drink|consume|finish|play|roll|are targeted)|\bafter (?:you drink|drinking)|until the (?:start|end) of|\bif you help |mounted on |\bwhile underwater|\bwhile you are a |\bwhile in that |dim light or darkness|\bwhile you are surrounded|\bfor example\b|\binstead of\b|\bretains its\b/i;

// The wearer is the one who benefits.
const WEARER = /\byou (?:also )?(?:have|gain)\b|\byour \w+ score\b/i;

function sentencesOf(desc) {
  return desc
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// The damage types one "resistance to ..." phrase names. Stops at the first
// word that is not part of the list. A list qualified by what follows it
// ("slashing damage from nonmagical attacks", "damage dealt by the breath
// weapons of dragons") is a narrower thing than the engine's resistance, and
// a list joined by "or" is a choice of one: both are left out.
function resistedTypes(sentence) {
  const types = [];
  for (const phrase of sentence.matchAll(/resistance (?:to|against) ([^.;]*)/gi)) {
    const words = phrase[1].toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
    const found = [];
    for (const word of words) {
      if (RESISTABLE.has(word)) {
        found.push(word);
        continue;
      }
      if (word === "damage" || word === "and" || word === "to") {
        continue;
      }
      if (word === "or" || word === "from" || word === "dealt" || word === "caused") {
        found.length = 0;
      }
      break;
    }
    types.push(...found);
  }
  return types;
}

// The effects a single item's description grants, and whether it works from
// the pack. Returns no effects for an item with no parseable mechanic.
function parseEffects(desc, category) {
  const effects = [];
  const read = [];
  let carried = false;
  if (CONSUMABLE.test(category)) {
    return { effects, carried, read };
  }
  const armorCategory = /armor|shield/i.test(category);
  const standing = sentencesOf(desc).filter(
    (sentence) => WEARER.test(sentence) && !NOT_STANDING.test(sentence),
  );
  const note = (sentence) => {
    if (!read.includes(sentence)) {
      read.push(sentence);
    }
    if (/on your person|\bcarrying\b/i.test(sentence)) {
      carried = true;
    }
  };

  let ac = null;
  let unarmored = null;
  let save = null;
  let setAbility = null;
  const resist = [];
  for (const sentence of standing) {
    const bare = /\+(\d) bonus to (?:AC|Armor Class) if you are wearing no armor/i.exec(sentence);
    if (bare && !unarmored) {
      unarmored = Number(bare[1]);
      note(sentence);
    } else if (!bare && !armorCategory && ac === null) {
      // Flat AC only from non-armor items; magic armor's bonus rides its name.
      const flat = /\+(\d) bonus to (?:AC|Armor Class)\b(?! if)/i.exec(sentence);
      if (flat) {
        ac = Number(flat[1]);
        note(sentence);
      }
    }
    const saves =
      /\+(\d) bonus to (?:your )?(?:(?:AC|Armor Class)(?: and |, )|ability checks and )?saving throws/i.exec(
        sentence,
      );
    if (saves && save === null) {
      save = Number(saves[1]);
      note(sentence);
    }
    const score =
      /your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score (?:is|changes to|becomes) (\d+)/i.exec(
        sentence,
      );
    if (score && !setAbility) {
      setAbility = { ability: ABILITY[score[1].toLowerCase()], score: Number(score[2]) };
      note(sentence);
    }
    const types = resistedTypes(sentence);
    if (types.length) {
      resist.push(...types);
      note(sentence);
    }
  }

  if (unarmored !== null) {
    effects.push({ kind: "ac_unarmored", amount: unarmored });
  } else if (ac !== null) {
    effects.push({ kind: "ac_bonus", amount: ac });
  }
  if (save !== null) {
    effects.push({ kind: "save_bonus", amount: save });
  }
  if (setAbility) {
    effects.push({ kind: "set_ability", ...setAbility });
  }
  if (resist.length) {
    effects.push({ kind: "resistance", types: [...new Set(resist)] });
  }
  return { effects, carried, read };
}

// Who may attune, from the pack's own line: "requires attunement by a
// sorcerer, warlock, or wizard". Null when anyone may.
function attunedBy(text) {
  const who = /requires attunement by (.+)$/i.exec(text.trim());
  if (!who) {
    return null;
  }
  const phrase = who[1].toLowerCase();
  const rule = { text: who[1].trim() };
  const classes = CLASSES.filter((name) => new RegExp(`\\b${name}\\b`).test(phrase));
  if (classes.length) {
    rule.classes = classes;
  }
  if (/\bspellcaster\b/.test(phrase)) {
    rule.spellcaster = true;
  }
  const alignment = /\b(good|evil|lawful|chaotic|neutral) alignment\b/.exec(phrase);
  if (alignment) {
    rule.alignment = alignment[1];
  }
  const race = /\b(dwarf|elf|halfling|gnome|human|dragonborn|tiefling|orc)\b/.exec(phrase);
  if (race) {
    rule.race = race[1];
  }
  return rule.classes || rule.spellcaster || rule.alignment || rule.race ? rule : null;
}

const keyOf = (name) => name.trim().toLowerCase();

function collect() {
  const db = new Database(contentDb, { readonly: true });
  // The SRD's own wording first, so an item two documents describe is read
  // from the SRD.
  const rows = db
    .prepare(
      `SELECT slug, name, category, rarity, data_json FROM items WHERE kind = 'magic_item'
       ORDER BY CASE document_slug WHEN 'wotc-srd' THEN 0 ELSE 1 END, slug`,
    )
    .all();
  db.close();

  const slugs = new Map();
  for (const row of rows) {
    const key = keyOf(row.name);
    slugs.set(key, [...(slugs.get(key) ?? []), row.slug]);
  }

  const out = [];
  const explained = [];
  const seen = new Set();
  for (const row of rows) {
    const match = keyOf(row.name);
    if (seen.has(match)) {
      continue;
    }
    seen.add(match);
    const data = JSON.parse(row.data_json || "{}");
    const desc = String(data.desc || "").replace(/\s+/g, " ");
    const attunement = String(data.requires_attunement || "");
    const parsed = parseEffects(desc, row.category || "");
    const effects = DROPPED[match] ? [] : (REPLACED[match] ?? parsed.effects);
    const restriction = attunedBy(attunement);
    // A row with no effect is kept only when the engine has something to
    // enforce about it: who may attune.
    if (!effects.length && !restriction) {
      continue;
    }
    out.push({
      name: row.name.trim(),
      match,
      slugs: slugs.get(match) ?? [],
      requiresAttunement: /requires attunement/i.test(attunement),
      ...(restriction ? { attunedBy: restriction } : {}),
      ...(parsed.carried && effects.length ? { carried: true } : {}),
      effects,
    });
    explained.push({ name: row.name.trim(), effects, read: parsed.read });
  }
  for (const added of ADDED) {
    const match = keyOf(added.name);
    if (seen.has(match)) {
      throw new Error(`${added.name} is in the pack and in the corrections; keep one.`);
    }
    seen.add(match);
    out.push({
      name: added.name,
      match,
      slugs: [],
      requiresAttunement: added.requiresAttunement,
      ...(added.aliases ? { aliases: added.aliases } : {}),
      effects: added.effects,
    });
  }
  return {
    items: out.sort((a, b) => a.name.localeCompare(b.name)),
    explained: explained.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

if (!existsSync(contentDb)) {
  console.error(`content DB not found at ${contentDb}; cannot generate.`);
  process.exit(1);
}

const collected = collect();
const generated = {
  _note:
    "GENERATED by scripts/generate-magic-items.mjs from the Open5e content DB, with the hand corrections in scripts/lib/magic-item-corrections.mjs applied. Do not edit by hand; re-run the script instead.",
  items: collected.items,
};
const serialized = `${JSON.stringify(generated, null, 2)}\n`;

if (process.argv.includes("--explain")) {
  for (const row of collected.explained) {
    console.log(`\n## ${row.name} -> ${JSON.stringify(row.effects)}`);
    for (const sentence of row.read) {
      console.log(`   ${sentence.slice(0, 300)}`);
    }
  }
} else if (process.argv.includes("--check")) {
  // Compare on content, not line endings: git hands Windows checkouts a CRLF
  // copy of the committed file, which a byte-for-byte compare reads as stale.
  const current = existsSync(outPath)
    ? readFileSync(outPath, "utf8").replace(/\r\n/g, "\n")
    : "";
  if (current !== serialized) {
    console.error("magic-items.json is stale; re-run node scripts/generate-magic-items.mjs");
    process.exit(1);
  }
  console.log(`magic-items.json is current (${generated.items.length} items).`);
} else {
  writeFileSync(outPath, serialized);
  console.log(`Wrote ${generated.items.length} magic items to src/lib/classes/magic-items.json`);
}
