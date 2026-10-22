// Writes the SRD 5.1 creature table, src/lib/srd/srd-creatures.json, from the
// Open5e content pack's SRD rows (document wotc-srd): every beast Wild Shape,
// Polymorph and Conjure Animals draw from, Find Familiar's forms and Pact of
// the Chain's, and every creature the conjuring and necromancy spells call
// (scripts/lib/srd-creature-overlay.mjs says which and why). A second file,
// src/lib/srd/srd-creature-names.json, holds the names alone for the DM
// console's pickers, so the browser never loads the blocks.
//
// Like the magic-item table, the OUTPUT IS COMMITTED and loaded at runtime:
// a server with no content pack summons the same creature as one with it.
// Run by hand when the pack or the overlay changes:
//
//   node scripts/generate-srd-creatures.mjs          # write the files
//   node scripts/generate-srd-creatures.mjs --check  # fail if stale
//
// Each block is read from the pack row: the scores, Armor Class, hit points
// and speeds from its fields, every attack from its printed line (the line
// is the SRD's text; the attack_bonus and damage_dice fields beside it are
// sometimes wrong, so they are never read). Every block is then held to the
// SRD 5.1 text in src/lib/rulebook/srd-5.1.json: a difference the overlay's
// corrections do not settle stops the run, and so does a correction the
// pack no longer needs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3-multiple-ciphers";
import { CHAIN_FORMS, CORRECTIONS, FAMILIARS, inRoster, PACK_KEEPS, RULEBOOK_PAGE, sidebarEntry, TRAITS_FROM } from "./lib/srd-creature-overlay.mjs";
import { attacksPerTurn, defenseWords, packSpeeds, parseAttack, parseRoutines, parseRulebookPage, parseSenses, plain } from "./lib/srd-creature-text.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDb = process.env.CONTENT_DB_PATH || join(root, "data", "content", "open5e.sqlite");
const outPath = join(root, "src", "lib", "srd", "srd-creatures.json");
const namesPath = join(root, "src", "lib", "srd", "srd-creature-names.json");
const rulebookPath = join(root, "src", "lib", "rulebook", "srd-5.1.json");

const SAVE_FIELDS = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const DEFENSES = ["resist", "immune", "vulnerable", "conditionImmune"];

// An action with a recharge or a daily count is no attack the engine rolls
// every turn (a giant spider's Web): it stays a line for whoever runs it.
const LIMITED = /\((?:recharge|\d+\/day)/i;

// "Sting (Bite in Beast Form)": the attack is the sting, and the note is
// the Shapechanger trait's to tell.
const attackName = (name) => name.replace(/\s*\(Bite in Beast Form\)$/i, "");

const line = (entry) => `${plain(entry.name)}: ${plain(entry.desc)}`;

// A reaction or a legendary action, as the bestiary writes one
// (src/lib/bestiary/statblock.ts): "Reaction: Parry. The knight adds...".
const sectionLine = (label) => (entry) => `${label}: ${plain(entry.name)}. ${plain(entry.desc)}`;

// The block a pack row gives, before the overlay's corrections.
function fromPack(row, data) {
  const actions = (data.actions ?? []).filter((action) => !sidebarEntry(action.name));
  const specials = (data.special_abilities ?? []).filter((entry) => !sidebarEntry(entry.name));
  const attacks = [];
  const actionLines = [];
  let multiattack = null;
  for (const action of actions) {
    const parsed = action.name === "Multiattack" || LIMITED.test(action.name) ? null : parseAttack(action.name, action.desc);
    if (action.name === "Multiattack") {
      multiattack = action;
    }
    if (parsed) {
      attacks.push(parsed);
    } else {
      actionLines.push(line(action));
    }
  }
  return {
    name: row.name,
    slug: row.slug,
    type: String(row.type).toLowerCase(),
    size: data.size,
    cr: row.cr,
    ac: Number(data.armor_class),
    hp: Number(data.hit_points),
    speeds: packSpeeds(data.speed),
    abilities: {
      str: data.strength,
      dex: data.dexterity,
      con: data.constitution,
      int: data.intelligence,
      wis: data.wisdom,
      cha: data.charisma,
    },
    saves: SAVE_FIELDS.filter((field) => data[`${field}_save`] !== null && data[`${field}_save`] !== undefined).map((field) => field.slice(0, 3)),
    senses: parseSenses(data.senses),
    resist: defenseWords(data.damage_resistances),
    immune: defenseWords(data.damage_immunities),
    vulnerable: defenseWords(data.damage_vulnerabilities),
    conditionImmune: plain(data.condition_immunities),
    attacks,
    multiattack,
    specials: specials.map(line),
    actionLines: [
      ...actionLines,
      ...(data.reactions ?? []).map(sectionLine("Reaction")),
      ...(data.legendary_actions ?? []).map(sectionLine("Legendary action")),
    ],
  };
}

// The overlay's corrections laid on a block; each must change something.
function corrected(block, correction, stale) {
  const out = { ...block };
  for (const [field, value] of Object.entries(correction)) {
    if (field === "attackNames") {
      for (const [from, to] of Object.entries(value)) {
        if (!out.attacks.some((attack) => attack.name === from)) {
          stale.push(`${block.name}: no attack "${from}" to rename`);
        }
        out.attacks = out.attacks.map((attack) => (attack.name === from ? { ...attack, name: to } : attack));
      }
    } else if (field === "attackFields") {
      for (const [named, fields] of Object.entries(value)) {
        const found = out.attacks.find((attack) => attack.name === named);
        if (!found || Object.entries(fields).every(([key, wanted]) => found[key] === wanted)) {
          stale.push(`${block.name}: attack "${named}" already has ${JSON.stringify(fields)}`);
        }
        out.attacks = out.attacks.map((attack) => (attack.name === named ? { ...attack, ...fields } : attack));
      }
    } else if (field === "traitNames") {
      for (const [from, to] of Object.entries(value)) {
        if (!out.specials.some((entry) => entry.startsWith(`${from}:`))) {
          stale.push(`${block.name}: no trait "${from}" to rename`);
        }
        out.specials = out.specials.map((entry) => (entry.startsWith(`${from}:`) ? `${to}${entry.slice(from.length)}` : entry));
      }
    } else {
      if (JSON.stringify(out[field]) === JSON.stringify(value)) {
        stale.push(`${block.name}: the pack already has ${field} ${JSON.stringify(value)}`);
      }
      out[field] = value;
    }
  }
  return out;
}

// The numbers two readings of one attack must share; the manual notes are
// left out, as the rulebook page runs on into the creature's lore.
function attackNumbers(attack) {
  const { onHit, ...rest } = attack;
  const rule = { ...onHit };
  delete rule.manual;
  return JSON.stringify({ ...rest, name: attackName(rest.name), ...(onHit ? { onHit: rule } : {}) });
}

// Where the block and the SRD 5.1 page disagree, field by field. A field
// the overlay leaves to the pack (PACK_KEEPS) must still disagree, or the
// keep is stale.
function differences(block, page, keeps = {}) {
  const found = [];
  const kept = new Set();
  const same = (field, ours, theirs) => {
    const key = field.split(" ")[0];
    if (JSON.stringify(ours) === JSON.stringify(theirs)) {
      return;
    }
    if (keeps[key]) {
      kept.add(key);
      return;
    }
    found.push(`${field}: pack ${JSON.stringify(ours)}, SRD ${JSON.stringify(theirs)}`);
  };
  for (const field of ["size", "type", "cr", "ac", "hp", "speeds", "abilities", "saves", "senses"]) {
    same(field, block[field], page[field]);
  }
  for (const field of DEFENSES) {
    same(field, block[field].toLowerCase(), page[field].toLowerCase());
  }
  const theirs = page.actions.filter((action) => !sidebarEntry(action.name) && action.name !== "Multiattack" && !LIMITED.test(action.name)).map((action) => parseAttack(action.name, action.desc)).filter(Boolean);
  same("attacks", block.attacks.map(attackNumbers).sort(), theirs.map(attackNumbers).sort());
  const multiattack = page.actions.find((action) => action.name === "Multiattack");
  same("attacksPerTurn", block.multiattack ? attacksPerTurn(block.multiattack.desc) : 1, multiattack ? attacksPerTurn(multiattack.desc) : 1);
  same(
    "trait names",
    block.specials.map((entry) => entry.slice(0, entry.indexOf(":"))),
    page.traits.filter((trait) => !sidebarEntry(trait.name)).map((trait) => trait.name),
  );
  for (const key of Object.keys(keeps)) {
    if (!kept.has(key)) {
      found.push(`${key}: the pack and the SRD text agree now; strike the keep`);
    }
  }
  return found;
}

// The committed shape: empty fields left out, the routine read once.
function finished(block) {
  const attacks = block.attacks.map((attack) => ({ ...attack, name: attackName(attack.name) }));
  const routines = block.multiattack ? parseRoutines(block.multiattack.desc, attacks.map((attack) => attack.name)) : null;
  const perTurn = block.multiattack ? attacksPerTurn(block.multiattack.desc) : 1;
  return {
    name: block.name,
    slug: block.slug,
    type: block.type,
    size: block.size,
    cr: block.cr,
    ac: block.ac,
    hp: block.hp,
    speeds: block.speeds,
    abilities: block.abilities,
    ...(block.saves.length ? { saves: block.saves } : {}),
    ...(Object.keys(block.senses).length ? { senses: block.senses } : {}),
    ...Object.fromEntries(DEFENSES.filter((field) => block[field]).map((field) => [field, block[field]])),
    attacks,
    ...(perTurn > 1 ? { attacksPerTurn: perTurn } : {}),
    ...(routines && perTurn > 1 ? { routines } : {}),
    traits: [...block.specials, ...block.actionLines],
  };
}

function collect() {
  const db = new Database(contentDb, { readonly: true, fileMustExist: true });
  const rows = db.prepare("SELECT slug, name, type, cr, data_json FROM monsters WHERE document_slug = 'wotc-srd' ORDER BY name").all();
  db.close();
  const book = JSON.parse(readFileSync(rulebookPath, "utf8"));
  const pages = new Map(book.pages.filter((page) => page.kind === "monster").map((page) => [page.title, page]));
  const byName = new Map(rows.map((row) => [row.name, row]));
  const problems = [];
  const stale = [];
  const creatures = [];
  for (const row of rows) {
    const data = JSON.parse(row.data_json);
    if (!inRoster(row, data)) {
      continue;
    }
    let block = fromPack(row, data);
    const borrowed = TRAITS_FROM[row.name];
    if (borrowed) {
      const from = byName.get(borrowed);
      block.specials = [...fromPack(from, JSON.parse(from.data_json)).specials, ...block.specials];
    }
    if (CORRECTIONS[row.name]) {
      block = corrected(block, CORRECTIONS[row.name], stale);
    }
    const where = RULEBOOK_PAGE[row.name] ?? { title: row.name };
    const page = pages.get(where.title);
    if (!page) {
      problems.push(`${row.name}: no SRD 5.1 rulebook page "${where.title}"`);
      continue;
    }
    for (const found of differences(block, parseRulebookPage(page.md, where), PACK_KEEPS[row.name])) {
      problems.push(`${row.name}: ${found}`);
    }
    creatures.push(finished(block));
  }
  for (const name of [...FAMILIARS.map((entry) => entry.name), ...CHAIN_FORMS]) {
    if (!creatures.some((creature) => creature.name === name)) {
      problems.push(`${name}: a familiar form with no block`);
    }
  }
  for (const name of [...Object.keys(CORRECTIONS), ...Object.keys(PACK_KEEPS)]) {
    if (!creatures.some((creature) => creature.name === name)) {
      stale.push(`${name}: a correction for a creature the table does not hold`);
    }
  }
  if (problems.length || stale.length) {
    console.error([...problems, ...stale].join("\n"));
    console.error("The pack and the SRD 5.1 text disagree, or a correction is stale; settle it in scripts/lib/srd-creature-overlay.mjs.");
    process.exit(1);
  }
  return creatures.sort((a, b) => a.name.localeCompare(b.name));
}

if (!existsSync(contentDb)) {
  console.error(`content DB not found at ${contentDb}; cannot generate.`);
  process.exit(1);
}

const creatures = collect();
const generated = {
  _note:
    "GENERATED by scripts/generate-srd-creatures.mjs from the Open5e content pack's SRD 5.1 rows (document wotc-srd), held to the SRD 5.1 text in src/lib/rulebook/srd-5.1.json, with scripts/lib/srd-creature-overlay.mjs applied. Do not edit by hand; re-run the script instead. Data derived from the SRD 5.1, (c) Wizards of the Coast LLC, CC-BY-4.0.",
  familiars: FAMILIARS,
  chain: CHAIN_FORMS,
  creatures,
};
const names = {
  _note: "GENERATED by scripts/generate-srd-creatures.mjs: the names in srd-creatures.json, for the pickers that run in the browser.",
  beasts: creatures.filter((creature) => creature.type === "beast").map((creature) => creature.name),
  others: creatures.filter((creature) => creature.type !== "beast").map((creature) => creature.name),
};
const serialized = `${JSON.stringify(generated, null, 2)}\n`;
const serializedNames = `${JSON.stringify(names, null, 2)}\n`;

if (process.argv.includes("--check")) {
  // Compare on content, not line endings: a Windows checkout's CRLF copy is
  // the same file.
  const current = (path) => (existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : "");
  if (current(outPath) !== serialized || current(namesPath) !== serializedNames) {
    console.error("srd-creatures.json is stale; re-run node scripts/generate-srd-creatures.mjs");
    process.exit(1);
  }
  console.log(`srd-creatures.json is current (${creatures.length} creatures).`);
} else {
  writeFileSync(outPath, serialized);
  writeFileSync(namesPath, serializedNames);
  console.log(`Wrote ${creatures.length} creatures to src/lib/srd/srd-creatures.json and their names to srd-creature-names.json`);
}
