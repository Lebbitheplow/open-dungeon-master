// The build math table (backlog F10). Beside the picks, a real table shows
// every number the sheet will carry with the parts it is made of: scores,
// saves, skills, armor class, hit points, initiative, proficiency, the
// spell save DC and attack, the slots and each weapon's to-hit and damage.
// Each number must be the one the sheet itself works out from the saved
// character, the slots must no longer be empty, and a change is said in one
// short polite line, a burst of changes in one line, not many.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { openBuilder } = await import("./lib/enforce-builder.mjs");
const { buildMathSections, changeLine, createChangeAnnouncer, snapshotOf, workingOf } = await import(
  "../src/app/characters/builder/buildMath.ts"
);
const { computeSheetDerived, deriveAc, formatModifier, SRD_SKILLS } = await import("../src/lib/srd/index.ts");
const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
const { storedSheetSchema } = await import("../src/lib/schemas/sheet.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const builder = await openBuilder();
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

function tableOf(built) {
  return buildMathSections({
    derived: built.derived,
    scores: built.state.scores,
    klass: builder.classes.find((entry) => entry.id === built.state.classId) ?? built.klass,
    atTable: false,
  });
}
const rowsOf = (sections) => new Map(sections.flatMap((section) => section.rows.map((row) => [row.id, row])));

// The sheet's own working, exactly as the library sheet calls it
// (src/app/characters/[characterId]/SheetSections.tsx).
function sheetMath(built) {
  const sheet = built.sheet;
  return computeSheetDerived({
    abilities: sheet.abilities,
    level: built.level,
    proficiencies: sheet.proficiencies,
    spellcasting: sheet.spellcasting ?? null,
    class: sheet.class,
    features: sheet.features,
    feats: sheet.feats,
    equipment: sheet.equipment,
  });
}

function attackCard(built, name) {
  const stored = { resources: {}, conditions: [], level: built.level, ...storedSheetSchema.parse(built.sheet) };
  return deriveHand(stored).find((card) => card.type === "attack" && card.name === name);
}

const CASES = [
  {
    label: "a fighter",
    fields: { race: "human", class: "fighter", background: "soldier", level: 3, stylePicks: ["dueling"], equipment: [{ name: "Longsword", qty: 1 }] },
    weapon: "Longsword",
  },
  {
    label: "a wizard",
    fields: {
      race: "high_elf",
      class: "wizard",
      background: "sage",
      level: 3,
      scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
      equipment: [{ name: "Dagger", qty: 1 }],
    },
    weapon: "Dagger",
  },
  {
    label: "a rogue",
    fields: {
      race: "lightfoot_halfling",
      class: "rogue",
      background: "criminal",
      level: 2,
      scores: { str: 8, dex: 15, con: 14, int: 12, wis: 10, cha: 13 },
      chosenSkills: ["acrobatics", "perception", "investigation", "sleight_of_hand"],
      expertisePicks: ["perception", "stealth"],
      equipment: [{ name: "Rapier", qty: 1 }],
    },
    weapon: "Rapier",
  },
];

for (const { label, fields, weapon } of CASES) {
  const built = builder.build({ subclass: "", ...fields });
  test(`${label}: the build has a sheet to compare with`, () => {
    assert.ok(built.sheet, `no sheet: ${built.blocker}`);
  });
  const rows = rowsOf(tableOf({ ...built, klass: builder.classes.find((entry) => entry.id === fields.class) }));
  const sheet = sheetMath(built);

  test(`${label}: scores, saves and skills are the sheet's`, () => {
    for (const ability of ABILITIES) {
      assert.equal(rows.get(`ability-${ability}`).value, `${built.sheet.abilities[ability]} (${formatModifier(sheet.abilityMods[ability])})`);
      assert.equal(rows.get(`save-${ability}`).value, formatModifier(sheet.saves[ability]), `${ability} save`);
      assert.equal(rows.get(`save-${ability}`).working, workingOf(sheet.parts.saves[ability]));
    }
    assert.equal(SRD_SKILLS.filter((skill) => rows.has(`skill-${skill.id}`)).length, SRD_SKILLS.length);
    for (const skill of SRD_SKILLS) {
      assert.equal(rows.get(`skill-${skill.id}`).value, formatModifier(sheet.skills[skill.id]), skill.id);
    }
  });

  test(`${label}: armor class, hit points, initiative and proficiency are the sheet's`, () => {
    const stored = built.sheet;
    const ac = deriveAc({
      class: stored.class,
      level: built.level,
      abilities: stored.abilities,
      proficiencies: stored.proficiencies,
      equipment: stored.equipment,
      features: stored.features,
      feats: stored.feats,
      race: stored.race,
    });
    assert.equal(rows.get("ac").value, String(ac));
    assert.equal(rows.get("hp").value, String(stored.maxHp));
    assert.equal(rows.get("initiative").value, formatModifier(sheet.initiative));
    assert.equal(rows.get("proficiency").value, formatModifier(sheet.proficiencyBonus));
  });

  test(`${label}: the weapon's line is the attack card's`, () => {
    const card = attackCard(built, weapon);
    assert.ok(card, `no card for ${weapon}`);
    const row = rows.get(`weapon-${weapon}`);
    assert.ok(row, `no row for ${weapon}`);
    assert.equal(row.value, `${formatModifier(card.toHit)} to hit, ${card.damage} ${card.damageType}`);
  });

  test(`${label}: the spellcasting rows are the sheet's, slots included`, () => {
    if (sheet.spellSaveDc === null) {
      assert.equal(rows.get("spell-dc"), undefined);
      assert.ok(![...rows.keys()].some((id) => id.startsWith("slots-")));
      return;
    }
    assert.equal(rows.get("spell-dc").value, String(sheet.spellSaveDc));
    assert.equal(rows.get("spell-attack").value, formatModifier(sheet.spellAttack));
    const stored = built.sheet.spellcasting.slots;
    assert.ok(Object.keys(stored).length > 0, "the saved sheet has slots");
    for (const [level, slot] of Object.entries(stored)) {
      assert.equal(rows.get(`slots-${level}`)?.value, String(slot.max), `level ${level} slots`);
    }
  });
}

test("the working names its parts: a rogue's Dexterity save and an expert's Stealth", () => {
  const built = builder.build(CASES[2].fields);
  const rows = rowsOf(tableOf({ ...built, klass: builder.classes.find((entry) => entry.id === "rogue") }));
  assert.equal(rows.get("save-dex").working, "DEX modifier +3, proficiency +2");
  assert.equal(rows.get("skill-stealth").working, "DEX modifier +3, expertise +4");
  assert.equal(rows.get("skill-athletics").working, "STR modifier -1");
  assert.match(rows.get("weapon-Rapier").working, /^to hit: DEX modifier \+3, proficiency \+2; damage adds DEX modifier/);
});

test("a wizard's spell save DC shows its parts", () => {
  const built = builder.build(CASES[1].fields);
  const rows = rowsOf(tableOf({ ...built, klass: builder.classes.find((entry) => entry.id === "wizard") }));
  assert.equal(rows.get("spell-dc").working, "base +8, proficiency +2, INT modifier +3");
  assert.equal(rows.get("slots-1").label, "1st-level slots");
  assert.equal(rows.get("slots-2").label, "2nd-level slots");
});

test("worn armor and a shield set the armor class, as the sheet works it", () => {
  // The kit's own choices left as they open; the chain mail and shield are
  // bought, so they are what is worn.
  const built = builder.build({
    race: "human",
    class: "fighter",
    background: "soldier",
    level: 3,
    equipment: [{ name: "Chain Mail", qty: 1 }, { name: "Shield", qty: 1 }],
  });
  assert.ok(built.sheet, `no sheet: ${built.blocker}`);
  const rows = rowsOf(tableOf({ ...built, klass: builder.classes.find((entry) => entry.id === "fighter") }));
  const stored = built.sheet;
  const ac = deriveAc({
    class: stored.class,
    level: built.level,
    abilities: stored.abilities,
    proficiencies: stored.proficiencies,
    equipment: stored.equipment,
    features: stored.features,
    feats: stored.feats,
    race: stored.race,
  });
  assert.equal(ac, 18);
  assert.equal(rows.get("ac").value, "18");
  assert.match(rows.get("ac").working, /Chain Mail/);
  assert.match(rows.get("ac").working, /Shield/);
});

test("the preview no longer passes empty slots", () => {
  const wizard = builder.build(CASES[1].fields);
  assert.deepEqual(wizard.derived.spellSlots, wizard.sheet.spellcasting.slots);
  assert.deepEqual(wizard.derived.spellSlots, { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } });
  const fighter = builder.build(CASES[0].fields);
  assert.deepEqual(fighter.derived.spellSlots, {});
  const source = readFileSync(new URL("../src/app/characters/builder/useBuilderDerived.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(!source.includes("slots: {}"), "useBuilderDerived still passes empty slots");
});

test("no table before the hero has a class, ancestry, background and scores", () => {
  const built = builder.build({ race: "human", class: "fighter", background: undefined });
  assert.deepEqual(tableOf(built), []);
});

// The announcement.
const sections = (values) => [
  { id: "core", title: "Core", rows: Object.entries(values).map(([id, value]) => ({ id, label: LABELS[id], value, working: "" })) },
];
const LABELS = { ac: "Armor class", hp: "Hit points", initiative: "Initiative", "spell-dc": "Spell save DC" };

test("one change is said as the number and what it was", () => {
  const before = snapshotOf(sections({ ac: "14", hp: "12" }));
  assert.equal(changeLine(before, sections({ ac: "16", hp: "12" })), "Armor class 16, was 14.");
});

test("several changes are one line: the first, and how many more", () => {
  const before = snapshotOf(sections({ ac: "14", hp: "12", initiative: "+2" }));
  assert.equal(changeLine(before, sections({ ac: "16", hp: "13", initiative: "+3" })), "Armor class 16, was 14. 2 more numbers changed.");
  assert.equal(changeLine(before, sections({ ac: "14", hp: "13", initiative: "+3" })), "Hit points 13, was 12. 1 more number changed.");
});

test("a new number is said with its value; nothing changed says nothing", () => {
  const before = snapshotOf(sections({ ac: "12" }));
  assert.equal(changeLine(before, sections({ ac: "12", "spell-dc": "13" })), "Spell save DC 13.");
  assert.equal(changeLine(before, sections({ ac: "12" })), null);
});

function fakeTimers() {
  const queue = [];
  return {
    queue,
    timers: {
      setTimeout: (run, ms) => {
        const handle = { run, ms, cleared: false };
        queue.push(handle);
        return handle;
      },
      clearTimeout: (handle) => {
        handle.cleared = true;
      },
    },
    fire() {
      const handle = queue.shift();
      if (handle && !handle.cleared) {
        handle.run();
      }
    },
  };
}

test("the first table is not announced", () => {
  const clock = fakeTimers();
  const said = [];
  const announcer = createChangeAnnouncer({ say: (line) => said.push(line), timers: clock.timers });
  announcer.update(sections({ ac: "14" }));
  assert.equal(clock.queue.length, 0);
  assert.deepEqual(said, []);
});

test("a burst of changes is one line, said once the window closes", () => {
  const clock = fakeTimers();
  const said = [];
  const announcer = createChangeAnnouncer({ say: (line) => said.push(line), timers: clock.timers, waitMs: 1200 });
  announcer.update(sections({ ac: "14", hp: "12" }));
  announcer.update(sections({ ac: "15", hp: "12" }));
  announcer.update(sections({ ac: "16", hp: "12" }));
  announcer.update(sections({ ac: "16", hp: "13" }));
  assert.equal(clock.queue.length, 1, "one window, not one per change");
  assert.equal(clock.queue[0].ms, 1200);
  assert.deepEqual(said, []);
  clock.fire();
  assert.deepEqual(said, ["Armor class 16, was 14. 1 more number changed."]);
  // The next change compares with what was said, in a window of its own.
  announcer.update(sections({ ac: "17", hp: "13" }));
  clock.fire();
  assert.deepEqual(said.at(-1), "Armor class 17, was 16.");
});

test("a burst that ends where it started says nothing", () => {
  const clock = fakeTimers();
  const said = [];
  const announcer = createChangeAnnouncer({ say: (line) => said.push(line), timers: clock.timers });
  announcer.update(sections({ ac: "14" }));
  announcer.update(sections({ ac: "16" }));
  announcer.update(sections({ ac: "14" }));
  clock.fire();
  assert.deepEqual(said, []);
});

test("an unmounted table says nothing later", () => {
  const clock = fakeTimers();
  const said = [];
  const announcer = createChangeAnnouncer({ say: (line) => said.push(line), timers: clock.timers });
  announcer.update(sections({ ac: "14" }));
  announcer.update(sections({ ac: "16" }));
  announcer.dispose();
  clock.fire();
  assert.deepEqual(said, []);
});

// The panel: a real table, placed with one slot.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("the panel is a real table with row and column headers and a polite status", () => {
  const panel = read("../src/app/characters/builder/BuildMathPanel.tsx");
  assert.match(panel, /<table/);
  assert.match(panel, /<caption/);
  assert.match(panel, /scope="col"/);
  assert.match(panel, /scope="row"/);
  assert.match(panel, /scope="colgroup"/);
  assert.match(panel, /role="status" aria-live="polite"/);
  assert.match(panel, /aria-expanded=\{open\}/);
  // Folded where the builder is narrow, always open where it is wide, and
  // its scrolling body is a named tab stop.
  assert.match(panel, /open \? "block" : "hidden",\s*"@4xl:block"/);
  assert.match(panel, /role="region"\s*aria-labelledby=\{headingId\}\s*tabIndex=\{0\}/);
  // The page that holds the builder widens for the table on a desktop.
  assert.match(read("../src/app/styles/creator.css"), /main:has\(\[data-build-math\]\)/);
  // A changed row is lit only where the device plays effects.
  assert.match(panel, /useLowEffects\(\)/);
  assert.match(panel, /!low &&/);
});

test("CharacterBuilder places the panel in one slot beside the steps", () => {
  const source = read("../src/app/characters/builder/CharacterBuilder.tsx");
  assert.equal(source.match(/<BuildMathPanel /g)?.length, 1);
});

console.log(`\n${passed} build math checks passed`);
