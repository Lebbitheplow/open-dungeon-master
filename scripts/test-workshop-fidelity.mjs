// What a workshop copy of a published thing keeps. A DM who starts a
// monster, an item, a spell or a character option from something in the
// books expects the copy to work the way the original does at the table
// until they change it; this checks that against every row the content pack
// carries (and a fixture of SRD rows when it is not installed, as in CI),
// through the same functions the workshop's routes run.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { getContentDb } = await import("../src/lib/content/db.ts");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { draftFromData, draftFromStats, draftToData } = await import("../src/lib/bestiary/monster-draft.ts");
const { spellMechanicsFor } = await import("../src/lib/content/index.ts");
const { MECH_OVERRIDES } = await import("../src/lib/srd/spell-mechanics.ts");
const { normalizeHomebrewData, normalizeSpellMech } = await import("../src/lib/homebrew/gear.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
const { withMechanics, itemMechanicsOf, archetypeMechanicsOf, raceMechanicsOf } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { listRaces } = await import("../src/lib/content/index.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { sizeForRace } = await import("../src/lib/srd/index.ts");
const { hpBonusPerLevel } = await import("../src/lib/srd/race-id.ts");
const { innateSpellsFor, takesDraconicAncestry } = await import("../src/lib/srd/racial-grants.ts");
const { ignoresHeavyArmorSpeedPenalty } = await import("../src/lib/srd/armor.ts");
const { classFeaturesFor, subclassNamesFor, subclassSpellsFor } = await import("../src/lib/srd/features.ts");
const { extraSubclassOf } = await import("../src/lib/srd/subclass-tables.ts");
const { packSubclassExtras } = await import("../src/lib/content/archetype-tables.ts");
const { gearFromHomebrewData } = await import("../src/lib/homebrew/item-data.ts");
const { resolveAttackWeapon, weaponAttackProfile } = await import("../src/lib/dm/attack-logic.ts");
const { armorOfRow, wornArmorTurnsCrits, SRD_ARMOR } = await import("../src/lib/srd/armor.ts");
const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { magicItemRiders, attunementProblem } = await import("../src/lib/srd/magic-items.ts");
const { chargeRuleOf } = await import("../src/lib/srd/item-charge-rules.ts");
const { itemCheckRiders } = await import("../src/lib/srd/item-check-riders.ts");
const { itemSpellsOfRow } = await import("../src/lib/srd/item-spells.ts");
const { gearDefOfRow } = await import("../src/lib/srd/magic-gear.ts");
const magicItemsJson = JSON.parse(fs.readFileSync(new URL("../src/lib/classes/magic-items.json", import.meta.url), "utf8"));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    error.message = `${name}\n${error.message}`;
    throw error;
  }
}

const db = getContentDb();
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/srd-monster-rows.json", import.meta.url), "utf8"));

function monsterRows(document) {
  if (!db) {
    return fixture.rows.map((row) => ({ name: row.name, document_slug: "wotc-srd", cr: row.cr, data: row.data }));
  }
  const sql = document ? "SELECT name, document_slug, cr, data_json FROM monsters WHERE document_slug = ?" : "SELECT name, document_slug, cr, data_json FROM monsters";
  return db.prepare(sql).all(...(document ? [document] : [])).map((row) => ({ ...row, data: JSON.parse(row.data_json) }));
}

// Sizes compare in one case: the pack prints "large", the workshop "Large",
// and every reader lowers it (statblock.ts sizeRank).
// Keys are sorted, because the draft rebuilds each object in its own order.
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}
const comparable = (stats) =>
  JSON.stringify(sorted(stats), (key, value) => ((key === "size" || key === "maxSize") && typeof value === "string" ? value.toLowerCase() : value));

// The block a DM gets after "start from" and a save: stored as JSON, read
// back through the draft boundary the bestiary routes use.
function throughWorkshop(name, stats) {
  const stored = JSON.parse(JSON.stringify(draftToData(draftFromStats(name, stats), "")));
  return draftFromData(name, stored).stats;
}

const ENGINE_FIELDS = ["specials", "spellcasting", "regeneration", "routines"];
const ATTACK_FIELDS = ["mode", "spellAttack", "reach", "range", "riders", "onHit"];

test("every SRD monster comes back from the workshop exactly as the engine reads it from the book", () => {
  const changed = [];
  const rows = monsterRows("wotc-srd");
  assert.ok(rows.length >= (db ? 300 : fixture.rows.length));
  for (const row of rows) {
    const published = parseMonster(row.data, typeof row.data.cr === "number" ? row.data.cr : Number(row.cr));
    if (comparable(published) !== comparable(throughWorkshop(row.name, published))) {
      changed.push(row.name);
    }
  }
  assert.deepEqual(changed, [], `changed by a workshop round trip: ${changed.join(", ")}`);
});

test("no monster in the pack loses an action, a spell list, regeneration, a routine or an attack's rider on the way through", () => {
  const lost = [];
  for (const row of monsterRows()) {
    const published = parseMonster(row.data, typeof row.data.cr === "number" ? row.data.cr : Number(row.cr));
    const back = throughWorkshop(row.name, published);
    for (const field of ENGINE_FIELDS) {
      if (comparable(published[field]) !== comparable(back[field])) {
        lost.push(`${row.document_slug}/${row.name}: ${field}`);
      }
    }
    published.attacks.forEach((attack, index) => {
      for (const field of ATTACK_FIELDS) {
        // A range of nothing ("0/0 ft.") is the pack's slip, not a range.
        if (field === "range" && attack.range && !attack.range.normal) continue;
        if (comparable(attack[field]) !== comparable(back.attacks[index]?.[field])) {
          lost.push(`${row.document_slug}/${row.name}: ${attack.name}.${field}`);
        }
      }
    });
  }
  // A handful of pack rows print an ability whose "name" is a whole
  // sentence past the 120 characters a name may have.
  const sentences = lost.filter((entry) => /: specials$/.test(entry));
  assert.ok(sentences.length <= 2, `lost: ${lost.slice(0, 20).join("; ")}`);
  assert.deepEqual(lost.filter((entry) => !/: specials$/.test(entry)), []);
});

test("an attack's bonus is the one its line prints, where the pack's field misprints it", () => {
  const rows = new Map(monsterRows("wotc-srd").map((row) => [row.name, row]));
  const bonus = (name, attack) => {
    const row = rows.get(name);
    if (!row) return null;
    return parseMonster(row.data, row.cr).attacks.find((entry) => entry.name === attack)?.toHit ?? null;
  };
  // SRD 5.1: Vampire Spawn's bite is +6 (the pack's field says +61), the
  // purple worm's +14 (+9), the black bear's +4 (+3), and the rug of
  // smothering's Smother +5 (0, which left it with no attack at all).
  for (const [name, attack, want] of [
    ["Vampire Spawn", "Bite", 6],
    ["Purple Worm", "Bite", 14],
    ["Black Bear", "Bite", 4],
    ["Rug of Smothering", "Smother", 5],
  ]) {
    if (rows.has(name)) {
      assert.equal(bonus(name, attack), want, `${name} ${attack}`);
    }
  }
});

// ---- spells ----

// The SRD's spells as the "start from" picker hands them over: the row and,
// with mechanics=1, the block the engine casts the published spell with.
function spellRows() {
  if (db) {
    return db
      .prepare("SELECT name, level, school, data_json FROM spells WHERE document_slug = 'wotc-srd'")
      .all()
      .map((row) => ({ name: row.name, level: row.level, school: row.school, source: "open5e", data: JSON.parse(row.data_json) }));
  }
  // No pack: the spells the overrides answer for, with only a description.
  return Object.keys(MECH_OVERRIDES).map((key) => ({
    name: key.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    level: 1,
    school: "evocation",
    source: "open5e",
    data: { desc: `The ${key} spell.` },
  }));
}

test("every SRD spell copied into the workshop casts with the block the published spell casts with", () => {
  const changed = [];
  let blocks = 0;
  for (const row of withMechanics("spells", spellRows())) {
    const published = spellMechanicsFor({ spell: row.name })?.mech ?? null;
    const draft = draftFromCatalog("spell", row);
    const stored = normalizeHomebrewData("spell", JSON.parse(JSON.stringify(draft.data)), `${row.name} (copy)`);
    if ("error" in stored) {
      changed.push(`${row.name}: refused, ${stored.error}`);
      continue;
    }
    const kept = normalizeSpellMech(stored.data.mech);
    if (published) {
      blocks += 1;
      if (comparable(kept) !== comparable(published)) {
        changed.push(row.name);
      }
    }
  }
  assert.ok(blocks >= (db ? 200 : 20), `only ${blocks} spells had a block`);
  assert.deepEqual(changed, [], `a copy does not cast like the published spell: ${changed.join(", ")}`);
});

// ---- items ----

const SKILLS = ["athletics", "acrobatics", "stealth", "perception", "investigation", "sleight_of_hand", "persuasion", "arcana"];
const FIGHTER = { abilityMods: { str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0 }, proficiencyBonus: 3 };
const WEAPON_PROFS = ["simple", "martial", "firearms"];
const WEARER = { class: "wizard", spellcasting: { ability: "int" }, race: "human", alignment: "neutral good", conditions: [] };

// What the engines make of one carried line: the swing, the suit, the worn
// magic, the charges, the checks, the spells a charge casts, the curse.
function engineView(row) {
  const equipment = [row];
  const weapon = resolveAttackWeapon(equipment, WEAPON_PROFS, undefined);
  const profile = weapon.srd ? weaponAttackProfile(FIGHTER, WEAPON_PROFS, weapon) : null;
  const armor = armorOfRow(row);
  const riders = magicItemRiders(equipment, WEARER);
  return {
    swing: profile && {
      toHit: profile.toHit,
      damage: profile.damageExpression,
      type: profile.damageType,
      ranged: profile.ranged,
      range: profile.rangeTiles,
      magic: profile.magicBonus,
      // A "+1" the published name declares is said in the name; a renamed
      // copy says it as a rider. The numbers are compared above.
      notes: profile.riderNotes.map((note) => note.replace(row.name, "ITEM")).filter((note) => !/^ITEM: \+\d to hit and damage$/.test(note)),
      typed: profile.gearTyped ?? null,
      dice: profile.gearDice ?? null,
      crit: profile.gearCritDice ?? null,
      vs: profile.gearBonusVs ?? null,
    },
    // The setting a suit belongs to (genres) gates the builder's shop, not
    // what the suit does on a sheet.
    armor: armor && { ...armor, armor: { ...armor.armor, name: undefined, genres: undefined } },
    critProof: wornArmorTurnsCrits(equipment),
    worn: { ...riders, sources: riders.sources.length },
    charges: chargeRuleOf(row),
    checks: SKILLS.map((skill) => {
      const out = itemCheckRiders(equipment, skill);
      return [out.bonus, out.advantage];
    }),
    spells: itemSpellsOfRow(row),
    cursed: Boolean(gearDefOfRow(row)?.cursed),
    attunes: attunementProblem({ ...row, attuned: false }, [], { ...WEARER, class: "fighter", spellcasting: null }) === null,
  };
}

// Where two views part, as "path: published -> copy".
function firstDifference(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference(a[key], b[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return `${path || "view"}: ${JSON.stringify(a)?.slice(0, 120)} -> ${JSON.stringify(b)?.slice(0, 120)}`;
}

// Every item the engines know by name: the SRD weapons and armour, and every
// magic item row (SRD and pack) the magic-gear table carries.
function itemRows() {
  const rows = [
    ...SRD_WEAPONS.map((weapon) => ({ name: weapon.name, kind: "weapon" })),
    ...SRD_ARMOR.map((armor) => ({ name: armor.name, kind: "armor" })),
    ...magicItemsJson.items.map((item) => ({ name: item.name, kind: "magic_item" })),
  ];
  return rows.map((row) => ({ ...row, source: "open5e", data: { desc: `${row.name}.` } }));
}

test("every weapon, suit and magic item copied into the workshop works on a sheet as the published one does", () => {
  const changed = [];
  let copied = 0;
  for (const row of itemRows()) {
    const gear = itemMechanicsOf(row);
    const draft = draftFromCatalog("item", { ...row, ...(gear ? { gear } : {}) });
    const copyName = "Workshop Copy";
    const stored = normalizeHomebrewData("item", JSON.parse(JSON.stringify(draft.data)), copyName);
    if ("error" in stored) {
      changed.push(`${row.name}: refused, ${stored.error}`);
      continue;
    }
    copied += 1;
    const attuned = Boolean(stored.data.requiresAttunement);
    const published = { name: row.name, qty: 1, equipped: true, attuned };
    const snapshot = gearFromHomebrewData(copyName, stored.data);
    const copy = { name: copyName, qty: 1, equipped: true, attuned, ...(snapshot ? { gear: snapshot } : {}) };
    const want = comparable(engineView(published));
    const got = comparable(engineView(copy));
    if (want !== got) {
      changed.push(`${row.name}: ${firstDifference(JSON.parse(want), JSON.parse(got))}`);
    }
  }
  assert.ok(copied > 500, `only ${copied} items copied`);
  assert.deepEqual(changed, [], `${changed.length} copies work differently:\n${changed.slice(0, 12).join("\n")}`);
});

// ---- subclasses ----

const CLASSES = ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"];
const grantNames = (features) => features.map((feature) => `${feature.level}:${feature.name}`).sort();

// A copy of a published subclass, renamed and stored, as the table's extras.
function copiedExtras(classId, row) {
  const table = archetypeMechanicsOf(row, classId);
  if (!table) return null;
  const draft = draftFromCatalog("archetype", { ...row, table }, { classSlug: classId });
  const stored = normalizeHomebrewData("archetype", JSON.parse(JSON.stringify(draft.data)), "Copy");
  const extra = extraSubclassOf({ name: "Workshop Copy", source: "homebrew", data: stored.data });
  return extra ? { [classId]: [extra] } : null;
}

test("every bundled subclass copied into the workshop grants the same features and spells at every level", () => {
  const changed = [];
  let copied = 0;
  for (const classId of CLASSES) {
    for (const name of subclassNamesFor(classId)) {
      const extras = copiedExtras(classId, { name, source: "open5e", data: { desc: "" } });
      if (!extras) {
        changed.push(`${classId}/${name}: nothing to copy`);
        continue;
      }
      copied += 1;
      for (const level of [3, 6, 10, 14, 20]) {
        const want = grantNames(classFeaturesFor(classId, name, level));
        const got = grantNames(classFeaturesFor(classId, "Workshop Copy", level, extras));
        if (JSON.stringify(want) !== JSON.stringify(got)) {
          changed.push(`${classId}/${name} at ${level}`);
          break;
        }
        if (JSON.stringify(subclassSpellsFor(classId, name, level).sort()) !== JSON.stringify(subclassSpellsFor(classId, "Workshop Copy", level, extras).sort())) {
          changed.push(`${classId}/${name} spells at ${level}`);
          break;
        }
      }
    }
  }
  assert.ok(copied >= 100, `only ${copied} subclasses copied`);
  assert.deepEqual(changed, [], changed.join("; "));
});

test("a content-pack subclass written as prose grants its features, and its workshop copy grants the same", () => {
  if (!db) return;
  const pack = packSubclassExtras();
  const prose = db
    .prepare("SELECT name, class_slug, data_json FROM archetypes WHERE document_slug NOT IN ('wotc-srd', 'odm-expanded')")
    .all();
  const changed = [];
  let granted = 0;
  let headed = 0;
  for (const row of prose) {
    const classId = row.class_slug;
    if (!CLASSES.includes(classId)) continue;
    const data = JSON.parse(row.data_json);
    // A row that prints no feature under a heading has nothing to grant (a
    // summary row, an empty one).
    if (!/^\s*#{3,6}/m.test(String(data.desc ?? ""))) continue;
    headed += 1;
    const fromPack = classFeaturesFor(classId, row.name, 20, pack);
    const base = classFeaturesFor(classId, "", 20);
    if (fromPack.length > base.length) granted += 1;
    const extras = copiedExtras(classId, { name: row.name, source: "open5e", data });
    if (!extras) continue;
    if (JSON.stringify(grantNames(fromPack)) !== JSON.stringify(grantNames(classFeaturesFor(classId, "Workshop Copy", 20, extras)))) {
      changed.push(`${classId}/${row.name}`);
    }
  }
  assert.equal(granted, headed, `only ${granted} of ${headed} pack subclasses with features grant one`);
  assert.deepEqual(changed, [], changed.join("; "));
});

// ---- species ----

const raceFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/srd-race-rows.json", import.meta.url), "utf8"));
const raceRows = db
  ? listRaces({ limit: 500 }).map((row) => ({ slug: row.slug, name: row.name, documentSlug: row.documentSlug, document: row.document, data: row.data }))
  : raceFixture.rows;
const raceParent = (slug) => raceRows.find((row) => row.slug === slug) ?? null;

// A copy of a published species, renamed and stored, as the builder and the
// creation check offer it.
function copiedSpecies(row) {
  const table = raceMechanicsOf({ ...row, source: "open5e" }, raceParent);
  if (!table) return null;
  const draft = draftFromCatalog("race", { ...row, table });
  const stored = normalizeHomebrewData("race", JSON.parse(JSON.stringify(draft.data)), "Copy");
  return packRaceOptions([{ slug: "homebrew:copy", name: "Copy", documentSlug: "homebrew", document: "Homebrew", data: stored.data }], ["homebrew:copy"])[0] ?? null;
}

// What the option says, less what names it; a size the row leaves unstated
// is Medium at the table either way.
const OPTION_LABELS = ["id", "name", "slug", "documentSlug", "source", "note", "traitsSummary", "choiceTraitNames"];
const optionView = (option) => {
  const view = { ...option, size: option.size ?? "Medium" };
  for (const key of OPTION_LABELS) delete view[key];
  return sorted(view);
};

// The rules the engines key by a bundled race's id, asked of the published
// row and of its copy (src/lib/srd/race-id.ts speciesRulesFor).
const engineSpecies = (id, rules) => ({
  size: sizeForRace(id, rules),
  toughness: hpBonusPerLevel(id, rules),
  heavyArmor: ignoresHeavyArmorSpeedPenalty(id, rules),
  ancestry: takesDraconicAncestry(id, rules),
  innate: innateSpellsFor(id, 5, rules).map((spell) => `${spell.name}@${spell.gainedAt}`),
});

test("every published species copied into the workshop grants the same, and the engines read it the same", () => {
  const published = packRaceOptions(raceRows);
  const changed = [];
  let copied = 0;
  for (const option of published) {
    const row = raceRows.find((entry) => entry.slug === option.slug);
    const copy = copiedSpecies(row);
    if (!copy) {
      changed.push(`${option.name}: not offered`);
      continue;
    }
    copied += 1;
    const want = optionView(option);
    const got = optionView(copy);
    for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
      if (JSON.stringify(want[key]) !== JSON.stringify(got[key])) {
        changed.push(`${option.name} ${key}: ${JSON.stringify(want[key])?.slice(0, 80)} -> ${JSON.stringify(got[key])?.slice(0, 80)}`);
      }
    }
    const rules = { size: copy.size, heavyArmorSpeed: copy.heavyArmorSpeed, traitNames: copy.traitNames };
    const engines = JSON.stringify(engineSpecies("homebrew:copy", rules));
    const original = JSON.stringify(engineSpecies(option.id, { size: option.size, heavyArmorSpeed: option.heavyArmorSpeed, traitNames: option.traitNames }));
    if (engines !== original) changed.push(`${option.name} at the table: ${original} -> ${engines}`);
  }
  assert.ok(copied >= 9, `only ${copied} species copied`);
  assert.deepEqual(changed, [], `${changed.length} copies differ:\n${changed.slice(0, 12).join("\n")}`);
});

test("the SRD's species keep the rules the engines key by their id when copied", () => {
  const want = {
    "hill-dwarf": { size: "Medium", toughness: 1, heavyArmor: true },
    halfling: { size: "Small" },
    lightfoot: { size: "Small" },
    "rock-gnome": { size: "Small" },
    tiefling: { innate: ["Thaumaturgy@1", "Hellish Rebuke@3", "Darkness@5"] },
    dragonborn: { ancestry: true },
  };
  for (const [slug, expected] of Object.entries(want)) {
    const copy = copiedSpecies(raceRows.find((row) => row.slug === slug && row.documentSlug === "wotc-srd"));
    assert.ok(copy, `${slug} was not copied`);
    const seen = engineSpecies("homebrew:copy", { size: copy.size, heavyArmorSpeed: copy.heavyArmorSpeed, traitNames: copy.traitNames });
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(seen[key], value, `${slug} copy: ${key}`);
    }
  }
});

console.log(`test-workshop-fidelity: ${passed} passed${db ? "" : " (fixture rows, no content pack)"}`);
