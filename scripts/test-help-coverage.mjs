// Every feature a player can end up with must be explainable to them.
//
// test-feature-coverage.mjs guarantees a feature has MECHANICS (an effect, a
// counter, or an acknowledged reason it needs none). This one guarantees it
// has WORDS: describeFeature() returns something a new player can read. The
// two together mean a feature can neither do nothing nor explain nothing.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  describeFeature,
  describeRace,
  describeSkill,
  glossaryTerm,
  glossaryTerms,
  spellSummary,
  starterSpellsFor,
} = await import("../src/lib/help/index.ts");
const { SRD_CLASSES } = await import("../src/lib/srd/index.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib");
const readJson = (...parts) => JSON.parse(readFileSync(join(srcDir, ...parts), "utf8"));

const classFeatures = readJson("srd", "class-features.json").classes;
const authored = readJson("srd", "subclasses.json").classes;
const races = readJson("srd", "races.json").races;
const skills = readJson("srd", "skills.json").skills;
const glossary = readJson("..", "lib", "help", "glossary.json").terms;

test("every SRD class feature has player-facing text", () => {
  const missing = [];
  for (const [classId, table] of Object.entries(classFeatures)) {
    for (const names of Object.values(table.levels)) {
      for (const name of names) {
        if (!describeFeature(classId, "", name)?.trim()) {
          missing.push(`${classId}: ${name}`);
        }
      }
    }
    for (const subclass of table.subclasses) {
      for (const names of Object.values(subclass.levels)) {
        for (const name of names) {
          if (!describeFeature(classId, subclass.name, name)?.trim()) {
            missing.push(`${classId}/${subclass.name}: ${name}`);
          }
        }
      }
    }
  }
  assert.deepEqual([...new Set(missing)].sort(), []);
});

test("every authored subclass feature has player-facing text", () => {
  const missing = [];
  for (const [classId, entries] of Object.entries(authored)) {
    for (const entry of entries) {
      for (const features of Object.values(entry.levels)) {
        for (const feature of features) {
          if (!describeFeature(classId, entry.name, feature.n)?.trim()) {
            missing.push(`${classId}/${entry.name}: ${feature.n}`);
          }
        }
      }
    }
  }
  assert.deepEqual([...new Set(missing)].sort(), []);
});

test("a feature name shared by two subclasses resolves to each one's own text", () => {
  const nature = describeFeature("cleric", "Nature Domain", "Divine Strike");
  const death = describeFeature("cleric", "Death Domain", "Divine Strike");
  const generic = describeFeature("cleric", "", "Divine Strike");
  assert.ok(nature.includes("cold"));
  assert.ok(death.includes("necrotic"));
  assert.ok(generic && generic !== nature && generic !== death);
});

test("every lineage and skill can be described", () => {
  assert.deepEqual(races.filter((race) => !describeRace(race.id)?.trim()), []);
  assert.deepEqual(
    skills.filter((skill) => !describeSkill(skill.id)?.trim()).map((skill) => skill.id),
    [],
  );
  // Content-pack race slugs use hyphens where the bundled ids use underscores.
  assert.ok(describeRace("half-elf"));
});

test("glossary entries are complete, unique and readable", () => {
  const problems = [];
  const seen = new Set();
  for (const entry of glossary) {
    if (seen.has(entry.id)) {
      problems.push(`duplicate id ${entry.id}`);
    }
    seen.add(entry.id);
    if (!entry.term?.trim() || !entry.short?.trim()) {
      problems.push(`${entry.id}: missing term or short`);
    }
    if (entry.short && entry.short.length > 160) {
      problems.push(`${entry.id}: short text is too long for an inline read`);
    }
  }
  assert.deepEqual(problems, []);
  assert.equal(glossaryTerms().length, glossary.length);
});

test("the six abilities are all glossary terms, so ability labels can link", () => {
  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    assert.ok(glossaryTerm(ability), `no glossary entry for ${ability}`);
  }
});

test("every glossary id used in the UI exists", () => {
  // A <GameTerm id="..."> with no matching entry silently renders as plain
  // text, so nothing would look broken while the help quietly went missing.
  const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(appDir);

  const missing = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<GameTerm\s+id="([^"]+)"/g)) {
      if (!glossaryTerm(match[1])) {
        missing.push(`${file.split("/src/")[1]}: ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("no help text uses an em dash", () => {
  const offenders = [];
  const scan = (label, value) => {
    if (typeof value === "string" && value.includes("—")) {
      offenders.push(label);
    }
  };
  for (const entry of glossary) {
    scan(`glossary/${entry.id}/short`, entry.short);
    scan(`glossary/${entry.id}/long`, entry.long);
  }
  const srdFeatures = readJson("..", "lib", "help", "srd-features.json");
  for (const [name, text] of Object.entries(srdFeatures.features)) {
    scan(`srd-features/${name}`, text);
  }
  for (const [classId, entries] of Object.entries(srdFeatures.byClass)) {
    for (const [name, text] of Object.entries(entries)) {
      scan(`srd-features/${classId}/${name}`, text);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every caster class offers opening spell suggestions", () => {
  // A new player cannot search for a spell whose name they have never heard,
  // so a caster with no suggestions leaves them staring at an empty box.
  const missing = SRD_CLASSES.filter(
    (klass) => klass.spellAbility && !starterSpellsFor(klass.id),
  ).map((klass) => klass.id);
  assert.deepEqual(missing, []);
});

test("every suggested spell is a real spell in the manifest", () => {
  const manifest = JSON.parse(
    readFileSync(join(srcDir, "srd", "manifest", "spells.json"), "utf8"),
  ).spells;
  const known = new Set();
  for (const entry of manifest) {
    known.add(entry.n.toLowerCase());
    (entry.a ?? []).forEach((alias) => known.add(alias.toLowerCase()));
  }
  const bogus = [];
  for (const klass of SRD_CLASSES) {
    const starter = starterSpellsFor(klass.id);
    if (!starter) {
      continue;
    }
    for (const pick of [...starter.cantrips, ...starter.spells]) {
      if (!known.has(pick.n.toLowerCase())) {
        bogus.push(`${klass.id}: ${pick.n}`);
      }
      if (!pick.d?.trim()) {
        bogus.push(`${klass.id}: ${pick.n} has no reason given`);
      }
    }
  }
  assert.deepEqual(bogus, []);
});

test("classes that teach a secret language grant it", () => {
  // Picking druid has to actually let the character speak Druidic.
  const druid = SRD_CLASSES.find((klass) => klass.id === "druid");
  const rogue = SRD_CLASSES.find((klass) => klass.id === "rogue");
  assert.ok(druid.languages?.includes("Druidic"), "druid does not grant Druidic");
  assert.ok(rogue.languages?.includes("Thieves' Cant"), "rogue does not grant Thieves' Cant");
});

test("spell summaries read correctly for cantrips and levelled spells", () => {
  assert.match(spellSummary({ level: 0, school: "evocation" }), /evocation cantrip/);
  assert.match(
    spellSummary({ level_int: 3, school: "necromancy", concentration: true }),
    /level 3 necromancy · concentration/,
  );
  assert.equal(spellSummary(undefined), "");
});

console.log(`\ntest-help-coverage: ${passed} passed`);
