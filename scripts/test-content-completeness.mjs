// The anti-regression net for "X is missing".
//
// Every name below is content a player at a 5e table expects to find. The
// test asserts it resolves: subclasses must have a real feature table (not
// just a picker entry), and spells, feats and lineages must exist in the
// content pack. When a user reports something missing, add its name here
// first: the build then fails until the content is actually there.
//
// Requires the content pack. Without it the content assertions are skipped
// (the app degrades to the bundled SRD data), but the subclass checks still
// run because those tables live in the repo.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { subclassNamesFor, classFeaturesFor } = await import("../src/lib/srd/features.ts");
const { optionSlotsFor, optionsOfKind, findOptionByFeatureName, optionFeatureName } = await import(
  "../src/lib/srd/options.ts"
);
const { spellSlotsFor } = await import("../src/lib/srd/index.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// Every subclass a player should be able to pick AND receive features for.
const EXPECTED_SUBCLASSES = {
  artificer: ["Alchemist", "Armorer", "Artillerist", "Battle Smith"],
  barbarian: [
    "Path of the Berserker", "Path of the Totem Warrior", "Path of the Ancestral Guardian",
    "Path of the Storm Herald", "Path of the Zealot", "Path of the Beast",
    "Path of Wild Magic", "Path of the Giant",
  ],
  bard: [
    "College of Lore", "College of Valor", "College of Glamour", "College of Swords",
    "College of Whispers", "College of Eloquence", "College of Creation", "College of Spirits",
  ],
  cleric: [
    "Life Domain", "Knowledge Domain", "Light Domain", "Nature Domain", "Tempest Domain",
    "Trickery Domain", "War Domain", "Death Domain", "Forge Domain", "Grave Domain",
    "Order Domain", "Peace Domain", "Twilight Domain", "Arcana Domain",
  ],
  druid: [
    "Circle of the Land", "Circle of the Moon", "Circle of Dreams", "Circle of the Shepherd",
    "Circle of Spores", "Circle of Stars", "Circle of Wildfire",
  ],
  fighter: [
    "Champion", "Battle Master", "Eldritch Knight", "Arcane Archer", "Cavalier",
    "Samurai", "Echo Knight", "Psi Warrior", "Rune Knight", "Banneret",
  ],
  monk: [
    "Way of the Open Hand", "Way of Shadow", "Way of the Four Elements",
    "Way of the Drunken Master", "Way of the Kensei", "Way of the Sun Soul",
    "Way of the Long Death", "Way of Mercy", "Way of the Astral Self",
    "Way of the Ascendant Dragon",
  ],
  paladin: [
    "Oath of Devotion", "Oath of the Ancients", "Oath of Vengeance", "Oath of Conquest",
    "Oath of Redemption", "Oath of Glory", "Oath of the Watchers", "Oath of the Crown",
    "Oathbreaker",
  ],
  ranger: [
    "Hunter", "Beast Master", "Gloom Stalker", "Horizon Walker", "Monster Slayer",
    "Fey Wanderer", "Swarmkeeper", "Drakewarden",
  ],
  rogue: [
    "Thief", "Assassin", "Arcane Trickster", "Mastermind", "Swashbuckler",
    "Inquisitive", "Scout", "Phantom", "Soulknife",
  ],
  sorcerer: [
    "Draconic Bloodline", "Wild Magic", "Divine Soul", "Shadow Magic", "Storm Sorcery",
    "Aberrant Mind", "Clockwork Soul", "Lunar Sorcery",
  ],
  warlock: [
    "The Fiend", "The Archfey", "The Great Old One", "The Celestial", "The Hexblade",
    "The Fathomless", "The Genie", "The Undead", "The Undying",
  ],
  wizard: [
    "School of Evocation", "School of Abjuration", "School of Conjuration",
    "School of Divination", "School of Enchantment", "School of Illusion",
    "School of Necromancy", "School of Transmutation", "War Magic", "Bladesinging",
    "Chronurgy Magic", "Graviturgy Magic", "Order of Scribes",
  ],
};

const EXPECTED_FEATS = [
  "Alert", "Athlete", "Actor", "Charger", "Crossbow Expert", "Defensive Duelist",
  "Dual Wielder", "Dungeon Delver", "Durable", "Elemental Adept", "Grappler",
  "Great Weapon Master", "Healer", "Heavily Armored", "Heavy Armor Master",
  "Inspiring Leader", "Keen Mind", "Lightly Armored", "Linguist", "Lucky",
  "Mage Slayer", "Magic Initiate", "Martial Adept", "Medium Armor Master", "Mobile",
  "Moderately Armored", "Mounted Combatant", "Observant", "Polearm Master",
  "Resilient", "Ritual Caster", "Savage Attacker", "Sentinel", "Sharpshooter",
  "Shield Master", "Skilled", "Skulker", "Spell Sniper", "Tavern Brawler", "Tough",
  "War Caster", "Weapon Master", "Fey Touched", "Shadow Touched", "Telekinetic",
  "Telepathic", "Eldritch Adept", "Metamagic Adept", "Skill Expert", "Chef",
  "Crusher", "Piercer", "Slasher", "Poisoner", "Gunner",
];

const EXPECTED_RACES = [
  "Aasimar", "Goliath", "Firbolg", "Tabaxi", "Kenku", "Tortle", "Changeling",
  "Warforged", "Goblin", "Bugbear", "Lizardfolk",
];

test("every pick-list a class earns has options and correct counts", () => {
  // These used to be feature names with no way to choose them: a warlock's
  // sheet said "Eldritch Invocations" and the player never got any.
  const cases = [
    ["warlock", "", 2, "invocation", 2],
    ["warlock", "", 12, "invocation", 6],
    ["warlock", "", 18, "invocation", 8],
    ["warlock", "", 3, "pact_boon", 1],
    ["fighter", "Battle Master", 3, "maneuver", 3],
    ["fighter", "Battle Master", 10, "maneuver", 7],
    ["fighter", "Battle Master", 15, "maneuver", 9],
    ["fighter", "Champion", 10, "maneuver", 0],
    ["fighter", "Rune Knight", 3, "rune", 2],
    ["sorcerer", "", 3, "metamagic", 2],
    ["sorcerer", "", 17, "metamagic", 4],
    ["artificer", "", 2, "infusion", 4],
    ["artificer", "", 18, "infusion", 12],
    ["monk", "Way of the Four Elements", 3, "discipline", 2],
    ["monk", "Way of the Open Hand", 3, "discipline", 0],
  ];
  const wrong = [];
  for (const [classId, subclass, level, kind, expected] of cases) {
    const actual = optionSlotsFor(classId, subclass, level, kind);
    if (actual !== expected) {
      wrong.push(`${classId}/${subclass || "-"} L${level} ${kind}: got ${actual}, want ${expected}`);
    }
  }
  assert.deepEqual(wrong, []);

  // Every kind must have options to pick, each with rules text.
  const kinds = ["invocation", "maneuver", "metamagic", "pact_boon", "infusion", "rune", "discipline"];
  const empty = kinds.filter((kind) => optionsOfKind(kind).length === 0);
  assert.deepEqual(empty, [], "these pick-lists have no options");
  const textless = kinds.flatMap((kind) =>
    optionsOfKind(kind).filter((option) => !option.d?.trim()).map((option) => `${kind}: ${option.n}`),
  );
  assert.deepEqual(textless, []);
});

test("an option pick round-trips through its feature name", () => {
  // The sheet stores "Invocation: Agonizing Blast"; it has to resolve back.
  for (const kind of ["invocation", "maneuver", "metamagic", "pact_boon", "infusion", "rune", "discipline"]) {
    for (const option of optionsOfKind(kind)) {
      const featureName = optionFeatureName(kind, option.n);
      const found = findOptionByFeatureName(featureName);
      assert.ok(found, `${featureName} does not resolve back to an option`);
      assert.equal(found.n, option.n);
    }
  }
});

test("the artificer is a real, playable class", () => {
  assert.ok(subclassNamesFor("artificer").length >= 4, "artificer has no subclasses");
  // A half caster that rounds up: slots at level 1, where a ranger has none.
  assert.deepEqual(spellSlotsFor("artificer", 1), { 1: 2 });
  assert.deepEqual(spellSlotsFor("ranger", 1), {});
  assert.ok(Object.keys(spellSlotsFor("artificer", 20)).length === 5);
  assert.ok(classFeaturesFor("artificer", "Battle Smith", 3).length > 0);
});

test("every expected subclass is offered by its class", () => {
  const missing = [];
  for (const [classId, expected] of Object.entries(EXPECTED_SUBCLASSES)) {
    const offered = subclassNamesFor(classId).map((name) => name.toLowerCase());
    for (const name of expected) {
      if (!offered.includes(name.toLowerCase())) {
        missing.push(`${classId}: ${name}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("every expected subclass actually grants features at level 20", () => {
  const empty = [];
  for (const [classId, expected] of Object.entries(EXPECTED_SUBCLASSES)) {
    const base = classFeaturesFor(classId, "", 20).length;
    for (const name of expected) {
      const withSubclass = classFeaturesFor(classId, name, 20).length;
      if (withSubclass <= base) {
        empty.push(`${classId}: ${name}`);
      }
    }
  }
  assert.deepEqual(empty, [], "these subclasses are pickable but grant nothing");
});

test("every expected subclass grants its first feature at the subclass level", () => {
  const late = [];
  for (const [classId, expected] of Object.entries(EXPECTED_SUBCLASSES)) {
    for (const name of expected) {
      const pickLevel = classId === "cleric" || classId === "sorcerer" || classId === "warlock"
        ? 1
        : classId === "druid" || classId === "wizard"
          ? 2
          : 3;
      const base = classFeaturesFor(classId, "", pickLevel).length;
      if (classFeaturesFor(classId, name, pickLevel).length <= base) {
        late.push(`${classId}: ${name}`);
      }
    }
  }
  assert.deepEqual(late, [], "these subclasses grant nothing at the level they are chosen");
});

const packPath = process.env.CONTENT_DB_PATH || join(process.cwd(), "data", "content", "open5e.sqlite");
if (!existsSync(packPath)) {
  console.log(`\ntest-content-completeness: ${passed} passed (pack absent, content checks skipped)`);
} else {
  const { default: Database } = await import("better-sqlite3-multiple-ciphers");
  const db = new Database(packPath, { readonly: true, fileMustExist: true });
  const has = (table, name) =>
    db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE name = ? COLLATE NOCASE`).get(name)
      .count > 0;

  test("every spell in the manifest is in the content pack", () => {
    // The manifest is the checklist of every official 5e spell. This is the
    // assertion that makes "every spell" true rather than claimed: a name
    // listed there and absent here fails the build. Aliases count, because a
    // spell filed under its SRD title is still findable by its book name.
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "src", "lib", "srd", "manifest", "spells.json"), "utf8"),
    ).spells;
    const resolves = (entry) =>
      [entry.n, ...(entry.a ?? [])].some(
        (name) =>
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM spells WHERE name = ? COLLATE NOCASE OR aliases_csv LIKE ?",
            )
            .get(name, `%${name.toLowerCase()}%`).count > 0,
      );
    const missing = manifest.filter((entry) => !resolves(entry)).map((e) => `${e.b}: ${e.n}`);
    assert.deepEqual(
      missing,
      [],
      `${missing.length} manifest spells are not in the pack; author them into src/lib/srd/authored-spells.json`,
    );
  });

  test("every subclass spell grant resolves to a real spell", () => {
    // The check that would have caught 14 broken grants shipping: a Twilight
    // cleric was being handed "Leomund's Tiny Hut" when the pack only knew
    // "Tiny Hut".
    const subclasses = JSON.parse(
      readFileSync(join(process.cwd(), "src", "lib", "srd", "subclasses.json"), "utf8"),
    ).classes;
    const broken = [];
    for (const [classId, entries] of Object.entries(subclasses)) {
      for (const entry of entries) {
        for (const spells of Object.values(entry.spells ?? {})) {
          for (const spell of spells) {
            const found =
              db
                .prepare(
                  "SELECT COUNT(*) AS count FROM spells WHERE name = ? COLLATE NOCASE OR aliases_csv LIKE ?",
                )
                .get(spell, `%${spell.toLowerCase()}%`).count > 0;
            if (!found) {
              broken.push(`${classId}/${entry.name}: ${spell}`);
            }
          }
        }
      }
    }
    assert.deepEqual(broken, []);
  });

  test("every expected feat is in the content pack", () => {
    assert.deepEqual(EXPECTED_FEATS.filter((name) => !has("feats", name)), []);
  });

  test("every expected lineage is in the content pack", () => {
    assert.deepEqual(EXPECTED_RACES.filter((name) => !has("races", name)), []);
  });

  test("every subclass with a feature table is pickable from the pack too", () => {
    const missing = [];
    for (const [classId, expected] of Object.entries(EXPECTED_SUBCLASSES)) {
      const rows = db
        .prepare("SELECT name FROM archetypes WHERE class_slug = ?")
        .all(classId)
        .map((row) => row.name.toLowerCase());
      for (const name of expected) {
        if (!rows.includes(name.toLowerCase())) {
          missing.push(`${classId}: ${name}`);
        }
      }
    }
    assert.deepEqual(missing, [], "run: node scripts/import-open5e.mjs");
  });

  test("authored rows did not duplicate content the open sources already carry", () => {
    const dupes = db
      .prepare(
        `SELECT name FROM spells WHERE document_slug = 'odm-expanded'
           AND lower(name) IN (SELECT lower(name) FROM spells WHERE document_slug != 'odm-expanded')`,
      )
      .all();
    assert.deepEqual(dupes, []);
  });

  db.close();
  console.log(`\ntest-content-completeness: ${passed} passed`);
}
