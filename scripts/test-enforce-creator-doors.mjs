// What a request can smuggle onto a new character past the builder.
//
// The builder (src/app/characters/builder/useBuilderState.ts) throws away a
// pick that no longer fits when the race, class or background changes, and
// its reconcile step drops the rest. That is the client's courtesy. The
// server is the door, and the server sees only the finished sheet: a race's
// skill choice on a race that offers none, a fighting style on a wizard, a
// subclass before the level that grants one, a feat on a race without one,
// a language, tool, armor or weapon the character was never taught. Each
// case below is a legal character the builder made, with one such thing
// added by hand, posted through both doors (POST /api/campaigns/[id]/sheet
// and POST /api/characters then "use this character"). The rule is the same
// at each: the stored sheet holds what the character is owed and nothing
// more, whether the request is refused or quietly corrected.
//
// The counts come from the rulebook, not the engine: SRD 5.1 Human (one
// extra language, no skill), Fighter (two skills from the class list, one
// fighting style, a subclass at 3rd), Wizard (no armor, no martial weapons,
// no fighting style), Soldier (Athletics, Intimidation, one gaming set,
// vehicles (land)).
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-creator-doors");

const creation = await openCreation();
const builder = await openBuilder();

// A level 1 human soldier fighter, every pick made, straight from the builder.
function fighter(fields = {}) {
  const built = builder.build({
    race: "human",
    class: "fighter",
    background: "soldier",
    level: 1,
    chosenSkills: ["acrobatics", "perception"],
    stylePicks: ["defense"],
    bonusLanguages: ["Dwarvish"],
    ...fields,
  });
  assert.equal(built.blocker, null, built.blocker?.message);
  return built.sheet;
}

// A level 1 high elf wizard.
function wizard(fields = {}) {
  const built = builder.build({
    race: "high_elf",
    class: "wizard",
    background: "sage",
    level: 1,
    // The sage brings Arcana and History; the class picks are two others.
    chosenSkills: ["investigation", "medicine"],
    racialCantrip: "Minor Illusion",
    bonusLanguages: ["Dwarvish", "Giant", "Orc"],
    cantrips: ["Fire Bolt", "Mage Hand", "Prestidigitation"],
    spells: ["Magic Missile", "Shield", "Mage Armor", "Detect Magic", "Sleep", "Burning Hands"],
    // Prepared from the book: Intelligence modifier (12 on the standard
    // array as placed, +1 for the high elf: 13, so +1) + level.
    bookPrepared: ["Magic Missile", "Shield"],
    ...fields,
  });
  assert.equal(built.blocker, null, built.blocker?.message);
  return built.sheet;
}

const lower = (list) => list.map((entry) => String(entry).toLowerCase());
const featureNames = (sheet) => sheet.features.map((feature) => feature.name);

// Post a tampered sheet through both doors; `check(stored, door)` reads
// what each stored, when something was stored.
async function bothDoors(sheet, check) {
  const at = await creation.atTable(sheet);
  if (at.status < 400) {
    assert.ok(at.sheet, "stored at the table");
    check(at.sheet, "the table");
  }
  const through = await creation.throughLibrary(sheet, 1);
  if (through.status < 400) {
    assert.ok(through.sheet, "stored through the library");
    check(through.sheet, "the library");
  }
  return { at, through };
}

// ---- race ----

await test("a skill smuggled in as a racial choice on a race with no skill choice is not stored (SRD 5.1 Human: no skill)", async () => {
  const sheet = fighter();
  const tampered = {
    ...sheet,
    proficiencies: { ...sheet.proficiencies, skills: [...sheet.proficiencies.skills, "stealth"] },
    racialChoices: { ...(sheet.racialChoices ?? {}), skills: ["stealth"] },
  };
  await bothDoors(tampered, (stored, door) => {
    assert.ok(!lower(stored.proficiencies.skills).includes("stealth"), `${door}: stealth stayed (${stored.proficiencies.skills})`);
    assert.equal(stored.proficiencies.skills.length, sheet.proficiencies.skills.length, `${door}: ${stored.proficiencies.skills}`);
  });
});

await test("a human with two extra languages keeps one: Common and one of the player's choice", async () => {
  const sheet = fighter();
  const tampered = {
    ...sheet,
    proficiencies: { ...sheet.proficiencies, languages: [...sheet.proficiencies.languages, "Elvish", "Giant"] },
  };
  await bothDoors(tampered, (stored, door) => {
    assert.equal(stored.proficiencies.languages.length, sheet.proficiencies.languages.length, `${door}: ${stored.proficiencies.languages}`);
  });
});

await test("a feat on a plain human at 1st level is not stored: the variant human has the feat, the human does not", async () => {
  const sheet = fighter();
  await bothDoors({ ...sheet, feats: ["Alert"] }, (stored, door) => {
    assert.deepEqual(stored.feats, [], `${door}: ${stored.feats}`);
  });
});

await test("a racial cantrip on a race that grants none is not stored", async () => {
  const sheet = fighter();
  const tampered = {
    ...sheet,
    racialChoices: { ...(sheet.racialChoices ?? {}), cantrip: "Fire Bolt" },
    features: [...sheet.features, { name: "Racial cantrip: Fire Bolt", source: "story" }],
  };
  await bothDoors(tampered, (stored, door) => {
    assert.ok(!featureNames(stored).some((name) => /racial cantrip/i.test(name)), `${door}: ${featureNames(stored)}`);
    assert.ok(!(stored.spellcasting?.cantrips ?? []).map((n) => n.toLowerCase()).includes("fire bolt"), `${door}: a fighter with Fire Bolt`);
  });
});

// ---- class ----

await test("a fighting style on a wizard is not stored", async () => {
  const sheet = wizard();
  const tampered = { ...sheet, features: [...sheet.features, { name: "Fighting Style: Defense", source: "choice" }] };
  await bothDoors(tampered, (stored, door) => {
    assert.ok(!featureNames(stored).some((name) => /^fighting style: /i.test(name)), `${door}: ${featureNames(stored)}`);
  });
});

await test("a second fighting style on a 1st-level fighter is not stored: one at 1st, a Champion's second at 10th", async () => {
  const sheet = fighter();
  const tampered = { ...sheet, features: [...sheet.features, { name: "Fighting Style: Dueling", source: "choice" }] };
  await bothDoors(tampered, (stored, door) => {
    const styles = featureNames(stored).filter((name) => /^fighting style: /i.test(name));
    assert.equal(styles.length, 1, `${door}: ${styles}`);
  });
});

await test("a subclass on a 1st-level fighter is not stored, nor its feature: a fighter chooses at 3rd", async () => {
  const sheet = fighter();
  const tampered = { ...sheet, subclass: "Champion", features: [...sheet.features, { name: "Improved Critical", source: "class" }] };
  await bothDoors(tampered, (stored, door) => {
    assert.equal(stored.subclass ?? "", "", `${door}: subclass ${stored.subclass}`);
    assert.ok(!featureNames(stored).includes("Improved Critical"), `${door}: ${featureNames(stored)}`);
  });
});

await test("expertise on a fighter is not stored", async () => {
  const sheet = fighter();
  const tampered = { ...sheet, proficiencies: { ...sheet.proficiencies, expertise: ["athletics"] } };
  await bothDoors(tampered, (stored, door) => {
    assert.deepEqual(stored.proficiencies.expertise, [], `${door}: ${stored.proficiencies.expertise}`);
  });
});

await test("another class's option on a fighter is not stored: a ranger's favored enemy", async () => {
  const sheet = fighter();
  const tampered = { ...sheet, features: [...sheet.features, { name: "Favored Enemy: Undead", source: "choice" }] };
  await bothDoors(tampered, (stored, door) => {
    assert.ok(!featureNames(stored).some((name) => /favored enemy/i.test(name)), `${door}: ${featureNames(stored)}`);
  });
});

await test("a third class skill on a fighter is not stored: the class offers two", async () => {
  const sheet = fighter();
  const tampered = { ...sheet, proficiencies: { ...sheet.proficiencies, skills: [...sheet.proficiencies.skills, "survival"] } };
  await bothDoors(tampered, (stored, door) => {
    assert.equal(stored.proficiencies.skills.length, sheet.proficiencies.skills.length, `${door}: ${stored.proficiencies.skills}`);
  });
});

// ---- training ----

await test("heavy armor and martial weapons on a wizard are not stored", async () => {
  const sheet = wizard();
  const tampered = {
    ...sheet,
    proficiencies: { ...sheet.proficiencies, armor: ["light", "medium", "heavy", "shields"], weapons: [...sheet.proficiencies.weapons, "martial"] },
  };
  await bothDoors(tampered, (stored, door) => {
    assert.ok(!lower(stored.proficiencies.armor).includes("heavy"), `${door}: armor ${stored.proficiencies.armor}`);
    assert.ok(!lower(stored.proficiencies.weapons).includes("martial"), `${door}: weapons ${stored.proficiencies.weapons}`);
  });
});

await test("a tool nobody taught is not stored: thieves' tools on a soldier fighter", async () => {
  const sheet = fighter();
  const tampered = { ...sheet, proficiencies: { ...sheet.proficiencies, tools: [...sheet.proficiencies.tools, "Thieves' Tools"] } };
  await bothDoors(tampered, (stored, door) => {
    assert.ok(!lower(stored.proficiencies.tools).some((tool) => /thieves/.test(tool)), `${door}: tools ${stored.proficiencies.tools}`);
  });
});

await test("a third saving throw is not stored", async () => {
  const sheet = fighter();
  const tampered = { ...sheet, proficiencies: { ...sheet.proficiencies, saves: ["str", "con", "dex"] } };
  await bothDoors(tampered, (stored, door) => {
    assert.deepEqual([...stored.proficiencies.saves].sort(), ["con", "str"], `${door}: saves ${stored.proficiencies.saves}`);
  });
});

// ---- scores and speed ----

await test("a speed the race does not give is not stored: a human walks 30", async () => {
  const sheet = fighter();
  await bothDoors({ ...sheet, speed: 40 }, (stored, door) => {
    assert.equal(stored.speed, 30, `${door}: speed ${stored.speed}`);
  });
});

await test("a 1st-level character arrives with no experience, no spent hit dice and full hit points, whatever the request says", async () => {
  const sheet = fighter();
  await bothDoors({ ...sheet, xp: 5000, hitDice: { ...sheet.hitDice, spent: 1 }, currentHp: 3 }, (stored, door) => {
    assert.equal(stored.xp ?? 0, 0, `${door}: xp ${stored.xp}`);
    assert.equal(stored.hitDice.spent, 0, `${door}: spent ${stored.hitDice.spent}`);
    assert.equal(stored.currentHp, stored.maxHp, `${door}: ${stored.currentHp}/${stored.maxHp}`);
  });
});

creation.world.close();
finish();
