// The spell data itself: is every spell ODM ships a well-formed 5e spell,
// and do the ones everybody knows say what the rulebook says?
//
// Two layers are bundled with the code and checked on every machine: the
// authored spells (src/lib/srd/authored-spells.json, the widely played spells
// no open dataset carries) and the checklist (manifest/spells.json, every
// official spell's name, level, school and class list). The SRD's own spells
// live in the Open5e content pack, so their rows are checked when the pack
// answers and skipped when it does not (CI).
//
// Structure first: a level from 0 to 9, one of the eight schools, a casting
// time the action economy can read (an action, a bonus action, a reaction or
// a span of minutes), a range, components with the material named, a
// duration, and a concentration flag that agrees with the duration. Then the
// literal table in scripts/lib/enforce-spell-table.mjs, typed from SRD 5.1,
// against ODM's rows, field by field.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { packAnswers } from "./lib/enforce-spells.mjs";
import {
  SCHOOLS,
  SPELL_CLASSES,
  SPELL_TABLE,
  castingTimeOf,
  componentLetters,
  plainDuration,
} from "./lib/enforce-spell-table.mjs";

const { test, finish } = suite("test-enforce-spell-data");
const world = await openWorld();
const pack = await packAnswers();
const { allPackSpells, findSpellByName } = await import("../src/lib/content/index.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");
const { checklistClassSpell, isCantripName, spellLevelOf } = await import("../src/lib/srd/spell-lists.ts");
const { default: authoredJson } = await import("../src/lib/srd/authored-spells.json", { with: { type: "json" } });
const { default: manifestJson } = await import("../src/lib/srd/manifest/spells.json", { with: { type: "json" } });

const RANGE = /^(self|touch|sight|special|unlimited|\d[\d,]*\s*(feet|foot|ft\.?|miles?))\b/i;
const squash = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, "");

// Everything wrong with one spell row, in words. `row` is the Open5e shape
// the authored file and the 2014 pack documents share.
function structuralFaults(row) {
  const faults = [];
  const level = Number(row.level_int ?? row.level);
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    faults.push(`level ${row.level}`);
  }
  if (!SCHOOLS.includes(String(row.school ?? "").toLowerCase())) {
    faults.push(`school "${row.school}"`);
  }
  if (castingTimeOf(row.casting_time) === null) {
    faults.push(`casting time "${row.casting_time}"`);
  }
  if (!RANGE.test(String(row.range ?? "").trim())) {
    faults.push(`range "${row.range}"`);
  }
  const letters = componentLetters(row.components);
  if (!letters) {
    faults.push(`components "${row.components}"`);
  }
  const material = String(row.material ?? "").trim() || (/\(([^)]+)\)/.exec(String(row.components ?? ""))?.[1] ?? "");
  if (letters.includes("M") && !material) {
    faults.push("a material component with no material named");
  }
  if (!String(row.duration ?? "").trim()) {
    faults.push("no duration");
  }
  const flagged = row.concentration === true || row.concentration === "yes" || row.requires_concentration === true;
  const worded = /concentration/i.test(String(row.duration ?? ""));
  if (worded && !flagged) {
    faults.push(`duration "${row.duration}" says concentration and the flag does not`);
  }
  if (!String(row.desc ?? "").trim()) {
    faults.push("no description");
  }
  return faults;
}

// ---- bundled: the authored spells ----

await test("every authored spell is a well-formed spell", () => {
  const problems = [];
  const seen = new Set();
  for (const row of authoredJson.spells) {
    const faults = structuralFaults(row);
    const key = String(row.name ?? "").trim().toLowerCase();
    if (!key) {
      faults.push("no name");
    }
    if (seen.has(key)) {
      faults.push("listed twice");
    }
    seen.add(key);
    const classes = Array.isArray(row.classes) ? row.classes : [];
    if (!classes.length) {
      faults.push("on no class list");
    }
    if (row.ritual !== undefined && typeof row.ritual !== "boolean") {
      faults.push(`ritual ${row.ritual}`);
    }
    if (faults.length) {
      problems.push(`${row.name}: ${faults.join("; ")}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(authoredJson.spells.length >= 150, "the authored layer is present");
});

await test("an authored concentration flag and its duration agree both ways", () => {
  const problems = authoredJson.spells
    .filter((row) => Boolean(row.concentration) !== /concentration/i.test(row.duration))
    .map((row) => `${row.name}: flag ${Boolean(row.concentration)}, duration "${row.duration}"`);
  assert.deepEqual(problems, []);
});

// ---- bundled: the checklist ----

await test("every checklist entry has a level, a school and a class list", () => {
  const problems = [];
  const seen = new Set();
  for (const row of manifestJson.spells) {
    const faults = [];
    if (!Number.isInteger(row.l) || row.l < 0 || row.l > 9) {
      faults.push(`level ${row.l}`);
    }
    if (!SCHOOLS.includes(String(row.s ?? "").toLowerCase())) {
      faults.push(`school "${row.s}"`);
    }
    const classes = String(row.c ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
    if (!classes.length) {
      faults.push("on no class list");
    }
    const key = row.n.trim().toLowerCase();
    if (seen.has(key)) {
      faults.push("listed twice");
    }
    seen.add(key);
    if (faults.length) {
      problems.push(`${row.n}: ${faults.join("; ")}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.equal(manifestJson.spells.length, manifestJson._counts.total);
});

await test("every spell's class list names only spellcasting classes", () => {
  const bad = [
    ...manifestJson.spells.flatMap((row) =>
      String(row.c ?? "").split(",").map((entry) => [row.n, entry.trim().toLowerCase()]),
    ),
    ...authoredJson.spells.flatMap((row) => (row.classes ?? []).map((entry) => [row.name, entry])),
  ]
    .filter(([, entry]) => entry && !SPELL_CLASSES.includes(entry))
    .map(([name, entry]) => `${name}: ${entry}`);
  assert.deepEqual([...new Set(bad)], [], [...new Set(bad)].join("; "));
});

await test("the checklist gives every spell in the table its printed level and school", () => {
  const problems = [];
  for (const row of SPELL_TABLE) {
    const found = manifestJson.spells.find(
      (entry) => [entry.n, ...(entry.a ?? [])].some((name) => name.toLowerCase() === row.name.toLowerCase()),
    );
    if (!found) {
      problems.push(`${row.name}: not on the checklist`);
      continue;
    }
    if (found.l !== row.level) {
      problems.push(`${row.name}: level ${found.l}, the book says ${row.level}`);
    }
    if (row.school && found.s.toLowerCase() !== row.school) {
      problems.push(`${row.name}: ${found.s}, the book says ${row.school}`);
    }
    assert.equal(spellLevelOf(row.name), row.level);
    assert.equal(isCantripName(row.name), row.level === 0);
  }
  assert.deepEqual(problems, []);
});

// SRD 5.1 class spell lists, for the spells a table argues about. The
// artificer is not SRD and is left out of the comparison.
const CLASS_LISTS = {
  "Fire Bolt": ["sorcerer", "wizard"],
  "Eldritch Blast": ["warlock"],
  "Sacred Flame": ["cleric"],
  "Vicious Mockery": ["bard"],
  "Magic Missile": ["sorcerer", "wizard"],
  "Cure Wounds": ["bard", "cleric", "druid", "paladin", "ranger"],
  "Healing Word": ["bard", "cleric", "druid"],
  "Shield": ["sorcerer", "wizard"],
  "Bless": ["cleric", "paladin"],
  "Bane": ["bard", "cleric"],
  "Hunter's Mark": ["ranger"],
  "Sleep": ["bard", "sorcerer", "wizard"],
  "Thunderwave": ["bard", "druid", "sorcerer", "wizard"],
  "Burning Hands": ["sorcerer", "wizard"],
  "Guiding Bolt": ["cleric"],
  "Inflict Wounds": ["cleric"],
  "Mage Armor": ["sorcerer", "wizard"],
  "Identify": ["bard", "wizard"],
  "Find Familiar": ["wizard"],
  "Detect Magic": ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "wizard"],
  "Hold Person": ["bard", "cleric", "druid", "sorcerer", "warlock", "wizard"],
  "Misty Step": ["sorcerer", "warlock", "wizard"],
  "Spiritual Weapon": ["cleric"],
  "Fireball": ["sorcerer", "wizard"],
  "Counterspell": ["sorcerer", "warlock", "wizard"],
  "Spirit Guardians": ["cleric"],
  "Haste": ["sorcerer", "wizard"],
  "Slow": ["sorcerer", "wizard"],
  "Revivify": ["cleric", "paladin"],
  "Polymorph": ["bard", "druid", "sorcerer", "wizard"],
  "Banishment": ["cleric", "paladin", "sorcerer", "warlock", "wizard"],
  "Stoneskin": ["druid", "ranger", "sorcerer", "wizard"],
  "Raise Dead": ["bard", "cleric", "paladin"],
  "Disintegrate": ["sorcerer", "wizard"],
  "Heal": ["cleric", "druid"],
  "Power Word Kill": ["bard", "sorcerer", "warlock", "wizard"],
  "Wish": ["sorcerer", "wizard"],
  "Meteor Swarm": ["sorcerer", "wizard"],
};

const listedOn = (name) =>
  String(manifestJson.spells.find((entry) => entry.n.toLowerCase() === name.toLowerCase())?.c ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry && entry !== "artificer")
    .sort();

await test("no class but the paladin is missing from a spell's list", () => {
  // The paladin is the gap below.
  const problems = [];
  for (const [name, expected] of Object.entries(CLASS_LISTS)) {
    const listed = listedOn(name);
    const missing = expected.filter((entry) => entry !== "paladin" && !listed.includes(entry));
    if (missing.length) {
      problems.push(`${name}: not on the ${missing.join(", ")} list`);
    }
  }
  assert.deepEqual(problems, []);
});

await test("the paladin list holds the SRD's paladin spells", () => {
  const missing = Object.entries(CLASS_LISTS)
    .filter(([name, expected]) => expected.includes("paladin") && !listedOn(name).includes("paladin"))
    .map(([name]) => name);
  assert.deepEqual(missing, [], `not on the paladin list: ${missing.join(", ")}`);
  assert.equal(checklistClassSpell("Bless", "paladin", 1), "Bless");
});

await test("a class list holds no subclass grants", () => {
  const extras = Object.entries(CLASS_LISTS)
    .map(([name, expected]) => [name, listedOn(name).filter((entry) => !expected.includes(entry))])
    .filter(([, extra]) => extra.length)
    .map(([name, extra]) => `${name}: ${extra.join(", ")}`);
  assert.deepEqual(extras, [], extras.join("; "));
});

await test("a class list answers only for its own spells, at levels it can reach", () => {
  assert.equal(checklistClassSpell("Fireball", "wizard", 3), "Fireball");
  assert.equal(checklistClassSpell("fireball", "wizard", 9), "Fireball");
  assert.equal(checklistClassSpell("Fireball", "wizard", 2), null, "a level 3 spell is out of reach at 2");
  assert.equal(checklistClassSpell("Fireball", "cleric", 9), null);
  assert.equal(checklistClassSpell("Cure Wounds", "wizard", 9), null);
  assert.equal(checklistClassSpell("Eldritch Blast", "warlock", 9), null, "a cantrip is never prepared");
  assert.equal(checklistClassSpell("Not A Spell", "wizard", 9), null);
});

// ---- the content pack ----

const rowsOf = (documentSlug) =>
  getContentDb()
    .prepare("SELECT name, level, school, ritual, concentration, classes_csv, data_json FROM spells WHERE document_slug = ?")
    .all(documentSlug)
    .map((row) => ({ ...row, data: JSON.parse(row.data_json) }));

// The rows the engine serves from the pack (src/lib/content/spell-overrides.ts):
// the file is never edited, so what the rules hold is what is read from it.
const servedOf = (documentSlug) => allPackSpells().filter((row) => row.documentSlug === documentSlug);

if (pack) {
  const NO_MATERIAL = "a material component with no material named";

  await test("every SRD 5.1 and ODM-authored pack row is a well-formed spell", () => {
    const problems = [];
    for (const documentSlug of ["wotc-srd", "odm-expanded"]) {
      const rows = rowsOf(documentSlug);
      assert.ok(rows.length >= 150, `${documentSlug} has ${rows.length} rows`);
      for (const row of rows) {
        const faults = structuralFaults({ ...row.data, level: row.level, level_int: row.level, school: row.school })
          .filter((fault) => fault !== NO_MATERIAL);
        // The pack prints a concentration spell's duration as "Up to 1 minute".
        const upTo = /^(up to|concentration)/i.test(String(row.data.duration ?? "").trim());
        if (Boolean(row.concentration) !== upTo) {
          faults.push(`concentration column ${row.concentration}, duration "${row.data.duration}"`);
        }
        if (!String(row.classes_csv ?? "").trim()) {
          faults.push("on no class list");
        }
        if (faults.length) {
          problems.push(`${documentSlug} ${row.name}: ${faults.join("; ")}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  await test("every served SRD row with a material names it", () => {
    const bad = servedOf("wotc-srd")
      .filter((row) => structuralFaults({ ...row.data, level: row.level, school: row.school }).includes(NO_MATERIAL))
      .map((row) => row.name);
    assert.deepEqual(bad, [], `no material named: ${bad.join(", ")}`);
  });

  await test("every pack row, whatever its source, has a level from 0 to 9", () => {
    const bad = getContentDb()
      .prepare("SELECT name, document_slug, level FROM spells WHERE level < 0 OR level > 9 OR level IS NULL")
      .all();
    assert.deepEqual(bad, []);
  });

  await test("every served spell belongs to one of the eight schools", () => {
    const bad = allPackSpells()
      .filter((row) => !SCHOOLS.includes(String(row.school).toLowerCase()))
      .map((row) => `${row.documentSlug} ${row.name}: ${row.school}`);
    assert.deepEqual(bad, [], bad.join("; "));
  });

  await test("no 2024 row is served to the 2014 engine in a shape it cannot read", () => {
    const problems = servedOf("srd-2024")
      .map((row) => ({ row, faults: structuralFaults({ ...row.data, level: row.level, level_int: row.level, school: row.school }) }))
      .filter((entry) => entry.faults.length)
      .map((entry) => `${entry.row.name}: ${entry.faults.join("; ")}`);
    assert.deepEqual(problems, [], problems.slice(0, 3).join(" | "));
  });

  await test("the 2024 rows are not served, and Hex and Chromatic Orb are ODM's 2014 restatements", () => {
    assert.equal(servedOf("srd-2024").length, 0);
    for (const name of ["Hex", "Chromatic Orb"]) {
      assert.equal(findSpellByName(name)?.documentSlug, "odm-expanded", name);
    }
  });

  await test("an SRD spell name resolves to the SRD row at its own level", () => {
    const shadowed = rowsOf("wotc-srd")
      .map((row) => ({ row, found: findSpellByName(row.name) }))
      .filter(({ row, found }) => found?.documentSlug !== "wotc-srd" || found.level !== row.level)
      .map(({ row, found }) => `${row.name} (level ${row.level}) resolves to ${found?.documentSlug} level ${found?.level}`);
    assert.deepEqual(shadowed, [], shadowed.join("; "));
  });

  await test("Toll the Dead is not an SRD spell, and ODM does not file it as one", () => {
    const found = findSpellByName("Toll the Dead");
    assert.ok(found, "ODM ships it in the authored layer");
    assert.notEqual(found.documentSlug, "wotc-srd");
    assert.equal(rowsOf("wotc-srd").some((row) => row.name === "Toll the Dead"), false);
  });

  // The table against the row the engine actually reads for that name.
  const compare = (row) => {
    const found = findSpellByName(row.name);
    if (!found) {
      return [`${row.name}: no row`];
    }
    const data = found.data;
    const faults = [];
    const differs = (label, got, want) => {
      if (want !== undefined && got !== want) {
        faults.push(`${label} ${JSON.stringify(got)}, the book says ${JSON.stringify(want)}`);
      }
    };
    differs("level", found.level, row.level);
    differs("school", String(found.school).toLowerCase(), row.school);
    differs("casting time", castingTimeOf(data.casting_time), row.time);
    const range = String(data.range ?? "").toLowerCase();
    if (row.range && range !== row.range && !range.startsWith(`${row.range} `)) {
      faults.push(`range "${range}", the book says "${row.range}"`);
    }
    differs("components", componentLetters(data.components), row.comp);
    for (const word of row.material ?? []) {
      if (!squash(data.material).includes(squash(word))) {
        faults.push(`material "${data.material}" does not name "${word}"`);
      }
    }
    differs("duration", plainDuration(data.duration), row.duration);
    differs("concentration", found.concentration, row.conc);
    differs("ritual", found.ritual, row.ritual);
    return faults.map((fault) => `${row.name}: ${fault}`);
  };
  // Haste is shadowed (above); Hex and Chromatic Orb exist only as 2024 rows.
  const knownBad = new Set(["Haste", "Hex", "Chromatic Orb"]);

  await test("the spells everybody knows say what the rulebook says", () => {
    const problems = SPELL_TABLE.filter((row) => !knownBad.has(row.name)).flatMap(compare);
    assert.deepEqual(problems, []);
    assert.ok(SPELL_TABLE.length >= 60);
  });

  await test("Haste, Hex and Chromatic Orb read as the book prints them", () => {
    const problems = SPELL_TABLE.filter((row) => knownBad.has(row.name)).flatMap(compare);
    assert.deepEqual(problems, [], problems.join("; "));
  });

  await test("reaction, bonus action and long casting times are told apart in the data", () => {
    const timeOf = (name) => castingTimeOf(findSpellByName(name).data.casting_time);
    for (const name of ["Shield", "Counterspell", "Feather Fall", "Hellish Rebuke"]) {
      assert.equal(timeOf(name), "reaction", name);
    }
    for (const name of ["Healing Word", "Misty Step", "Spiritual Weapon", "Hunter's Mark", "Shield of Faith"]) {
      assert.equal(timeOf(name), "bonus", name);
    }
    assert.equal(timeOf("Identify"), 1);
    assert.equal(timeOf("Find Familiar"), 60);
    assert.equal(timeOf("Raise Dead"), 60);
  });

  await test("the ritual tag is on the rituals and nowhere it does not belong", () => {
    for (const name of ["Detect Magic", "Identify", "Find Familiar", "Silence", "Comprehend Languages", "Alarm"]) {
      assert.equal(findSpellByName(name).ritual, true, name);
    }
    for (const name of ["Fireball", "Cure Wounds", "Shield", "Magic Missile", "Revivify", "Wish"]) {
      assert.equal(findSpellByName(name).ritual, false, name);
    }
  });
}

world.close();
finish();
