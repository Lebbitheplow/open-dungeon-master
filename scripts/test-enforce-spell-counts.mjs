// How many spells a caster may hold, as SRD 5.1 prints it, asked of the
// server on real sheets at every level from 1 to 20.
//
// The rules: each class table has a Cantrips Known column (bard, druid and
// warlock 2/3/4, cleric and wizard 3/4/5, sorcerer 4/5/6, growing at 4th and
// 10th level; paladin and ranger none); bard, sorcerer, warlock and ranger
// have a Spells Known column; cleric, druid and wizard prepare their casting
// modifier plus their level, a paladin the modifier plus half the level
// rounded down, never fewer than one; a wizard's spellbook starts with six
// spells and gains two with each wizard level. No spell held may be of a
// level the caster has no slots for.
//
// The columns are typed out below from the SRD and never read from ODM's
// tables (src/lib/content/mechanics.ts). Each is asked three ways: of the
// pure functions, of a stored sheet, and of the route a player's level-up
// goes through, which must take a list at the limit and refuse one past it
// without touching the sheet.
import assert from "node:assert/strict";
import { openWorld, heroInput } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import {
  FULL_CASTER_SLOTS,
  HALF_CASTER_SLOTS,
  PACT_SLOTS,
  PACT_SLOT_LEVEL,
  PORTRAIT,
  slotsOf,
} from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-spell-counts");
const world = await openWorld();
const { cantripCapOf, spellCapOf, spellListProblems, spellbookAllowance, casterViewsOf } = await import(
  "../src/lib/srd/spell-prep.ts"
);
const { spellLevelOf } = await import("../src/lib/srd/spell-lists.ts");
const sheetRoute = await world.route("campaigns/[campaignId]/sheet");

const LEVELS = Array.from({ length: 20 }, (_, index) => index + 1);
const steps = (first, fourth, tenth) => LEVELS.map((level) => (level >= 10 ? tenth : level >= 4 ? fourth : first));

// SRD 5.1, the Cantrips Known column of each class table. Index = level - 1.
const CANTRIPS_KNOWN = {
  bard: steps(2, 3, 4),
  cleric: steps(3, 4, 5),
  druid: steps(2, 3, 4),
  sorcerer: steps(4, 5, 6),
  warlock: steps(2, 3, 4),
  wizard: steps(3, 4, 5),
};

// SRD 5.1, the Spells Known column.
const SPELLS_KNOWN = {
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
};

const ABILITY = {
  bard: "cha", cleric: "wis", druid: "wis", paladin: "cha", ranger: "wis", sorcerer: "cha", warlock: "cha", wizard: "int",
};
const PREPARES = ["cleric", "druid", "wizard", "paladin"];

// What the class may hold at a level with this casting score, by the book.
function heldCap(classId, level, score) {
  if (SPELLS_KNOWN[classId]) {
    return SPELLS_KNOWN[classId][level - 1];
  }
  if (classId === "paladin") {
    return level < 2 ? 0 : Math.max(1, abilityMod(score) + Math.floor(level / 2));
  }
  return Math.max(1, abilityMod(score) + level);
}

// The highest spell level the class has slots for, from the SRD slot tables.
function topSpellLevel(classId, level) {
  if (classId === "warlock") {
    return PACT_SLOT_LEVEL[level - 1];
  }
  return (classId === "paladin" || classId === "ranger" ? HALF_CASTER_SLOTS : FULL_CASTER_SLOTS)[level - 1].length;
}

const slotsFor = (classId, level) =>
  classId === "warlock"
    ? { [String(PACT_SLOT_LEVEL[level - 1])]: { max: PACT_SLOTS[level - 1], used: 0 } }
    : slotsOf((classId === "paladin" || classId === "ranger" ? HALF_CASTER_SLOTS : FULL_CASTER_SLOTS)[level - 1]);

// Spells on each class's SRD list, by spell level, enough of them to fill
// the class's limit and one over at every level.
const SPELLS = {
  bard: [
    ["Charm Person", "Cure Wounds", "Detect Magic", "Faerie Fire", "Healing Word", "Sleep", "Thunderwave"],
    ["Hold Person", "Invisibility", "Shatter", "Silence"],
    ["Dispel Magic", "Hypnotic Pattern", "Fear"],
    ["Polymorph", "Dimension Door", "Greater Invisibility"],
    ["Hold Monster", "Raise Dead", "Greater Restoration"],
    ["Mass Suggestion", "True Seeing"],
    ["Teleport", "Resurrection"],
    ["Power Word Stun"],
    ["Power Word Kill", "Foresight"],
  ],
  sorcerer: [
    ["Magic Missile", "Shield", "Burning Hands", "Mage Armor", "Sleep", "Charm Person"],
    ["Hold Person", "Blur", "Misty Step", "Scorching Ray"],
    ["Fireball", "Haste", "Counterspell", "Fly"],
    ["Polymorph", "Banishment"],
    ["Cone of Cold", "Hold Monster"],
    ["Disintegrate", "Chain Lightning"],
  ],
  warlock: [
    ["Charm Person", "Hellish Rebuke", "Comprehend Languages", "Protection from Evil and Good", "Illusory Script", "Unseen Servant"],
    ["Hold Person", "Misty Step", "Invisibility", "Darkness"],
    ["Counterspell", "Fly", "Dispel Magic", "Fear"],
    ["Banishment", "Dimension Door"],
    ["Hold Monster", "Scrying"],
  ],
  ranger: [
    ["Hunter's Mark", "Cure Wounds", "Detect Magic", "Speak with Animals", "Longstrider", "Goodberry", "Jump", "Alarm"],
    ["Pass without Trace", "Lesser Restoration", "Silence", "Spike Growth"],
    ["Conjure Animals", "Water Walk", "Daylight"],
  ],
  cleric: [
    ["Bless", "Cure Wounds", "Healing Word", "Guiding Bolt", "Bane", "Detect Magic", "Inflict Wounds", "Sanctuary", "Shield of Faith", "Command"],
    ["Hold Person", "Spiritual Weapon", "Lesser Restoration", "Silence", "Aid"],
    ["Revivify", "Spirit Guardians", "Dispel Magic", "Daylight"],
    ["Banishment", "Death Ward", "Freedom of Movement"],
    ["Flame Strike", "Raise Dead", "Greater Restoration"],
    ["Heal", "Harm"],
    ["Resurrection", "Fire Storm"],
    ["Earthquake"],
    ["True Resurrection", "Mass Heal"],
  ],
  druid: [
    ["Cure Wounds", "Healing Word", "Faerie Fire", "Thunderwave", "Entangle", "Goodberry", "Detect Magic", "Speak with Animals", "Longstrider", "Jump"],
    ["Moonbeam", "Hold Person", "Barkskin", "Lesser Restoration", "Pass without Trace"],
    ["Call Lightning", "Dispel Magic", "Daylight", "Water Walk"],
    ["Polymorph", "Ice Storm", "Stoneskin"],
    ["Greater Restoration", "Insect Plague", "Tree Stride"],
    ["Heal", "Sunbeam"],
    ["Fire Storm", "Regenerate"],
    ["Sunburst", "Earthquake"],
    ["Shapechange", "Foresight"],
  ],
  wizard: [
    ["Magic Missile", "Shield", "Mage Armor", "Burning Hands", "Sleep", "Detect Magic", "Identify", "Charm Person", "Thunderwave", "Feather Fall"],
    ["Hold Person", "Blur", "Misty Step", "Invisibility", "Web"],
    ["Fireball", "Haste", "Counterspell", "Fly"],
    ["Polymorph", "Banishment", "Dimension Door"],
    ["Cone of Cold", "Hold Monster", "Wall of Force"],
    ["Disintegrate", "Chain Lightning"],
    ["Teleport", "Finger of Death"],
    ["Power Word Stun", "Sunburst"],
    ["Wish", "Meteor Swarm"],
  ],
  paladin: [
    ["Bless", "Cure Wounds", "Divine Favor", "Shield of Faith", "Command", "Detect Magic", "Heroism", "Protection from Evil and Good"],
    ["Aid", "Lesser Restoration", "Find Steed", "Zone of Truth", "Branding Smite"],
    ["Revivify", "Dispel Magic", "Daylight", "Magic Circle"],
    ["Banishment", "Death Ward"],
    ["Raise Dead", "Dispel Evil and Good"],
  ],
};

const CANTRIPS = {
  bard: ["Vicious Mockery", "Light", "Mage Hand", "Mending", "Minor Illusion", "Prestidigitation", "Dancing Lights"],
  cleric: ["Sacred Flame", "Guidance", "Light", "Mending", "Resistance", "Spare the Dying", "Thaumaturgy"],
  druid: ["Druidcraft", "Guidance", "Mending", "Poison Spray", "Produce Flame", "Resistance", "Shillelagh"],
  sorcerer: ["Fire Bolt", "Ray of Frost", "Shocking Grasp", "Light", "Mage Hand", "Acid Splash", "Chill Touch", "Prestidigitation"],
  warlock: ["Eldritch Blast", "Chill Touch", "Mage Hand", "Minor Illusion", "Poison Spray", "Prestidigitation", "True Strike"],
  wizard: ["Fire Bolt", "Ray of Frost", "Shocking Grasp", "Light", "Mage Hand", "Acid Splash", "Chill Touch", "Prestidigitation"],
  paladin: [],
  ranger: [],
};

const CLASSES = Object.keys(SPELLS);
const castable = (classId, top) => SPELLS[classId].slice(0, top).flat();

// A sheet's spellcasting with `held` spells and `cantrips` cantrips.
function casting(classId, level, held, cantrips, book) {
  const names = castable(classId, topSpellLevel(classId, level)).slice(0, held);
  assert.equal(names.length, held, `the pool for a ${classId} ${level} holds ${names.length} of ${held}`);
  const known = Boolean(SPELLS_KNOWN[classId]);
  return {
    ability: ABILITY[classId],
    slots: slotsFor(classId, level),
    known: known ? names : [],
    prepared: known ? [] : names,
    cantrips: CANTRIPS[classId].slice(0, cantrips),
    ...(classId === "wizard" ? { spellbook: book ?? names } : {}),
  };
}

const hero = (classId, level, spellcasting, score = 16) => ({
  class: classId, level, abilities: { [ABILITY[classId]]: score }, spellcasting,
});

// One table and one character for each class, rewritten in place to the
// level a check is about: a table seats six, and these checks need hundreds.
const seats = new Map();
async function seated(classId, level, spellcasting, score = 16) {
  if (!seats.has(classId)) {
    const table = await openWorld();
    seats.set(classId, { table, id: table.addHero(hero(classId, 1, casting(classId, 1, 0, 0))).id });
  }
  const { table, id } = seats.get(classId);
  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, [ABILITY[classId]]: score };
  table.patch(id, { level, abilities: scores, spellcasting, xp: 355000 });
  const sheet = table.sheet(id);
  assert.equal(sheet.level, level);
  return { table, sheet };
}

async function call(method, user, campaignId, body) {
  world.signIn(user);
  const request = new Request("http://test/", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const response = await sheetRoute[method](request, { params: Promise.resolve({ campaignId }) });
  return { status: response.status, json: await response.json() };
}

// ---- the tables themselves ----

await test("the pool of spells is the rulebook's: every name at its printed level", () => {
  for (const classId of CLASSES) {
    SPELLS[classId].forEach((names, index) => {
      for (const name of names) {
        assert.equal(spellLevelOf(name), index + 1, `${name} (${classId})`);
      }
    });
    for (const name of CANTRIPS[classId]) {
      assert.equal(spellLevelOf(name), 0, name);
    }
  }
});

await test("cantrips known are the class table's column at every level", () => {
  for (const classId of CLASSES) {
    for (const level of LEVELS) {
      const expected = CANTRIPS_KNOWN[classId]?.[level - 1] ?? null;
      assert.equal(cantripCapOf({ classId, level }), expected, `${classId} ${level}`);
    }
  }
});

await test("spells known and spells prepared are the book's at every level and score", async () => {
  for (const classId of CLASSES) {
    for (const level of LEVELS) {
      for (const score of [8, 10, 13, 16, 20]) {
        const { sheet } = await seated(classId, level, casting(classId, level, 0, 0), score);
        const [view] = casterViewsOf(sheet);
        const cap = spellCapOf(view, sheet.abilities);
        const expected = heldCap(classId, level, score);
        assert.equal(cap?.count ?? 0, expected, `${classId} ${level} with ${ABILITY[classId]} ${score}`);
        if (cap) {
          assert.equal(cap.label, PREPARES.includes(classId) ? "spells prepared" : "spells known");
        }
        if (SPELLS_KNOWN[classId]) {
          break;
        }
      }
    }
  }
});

await test("a wizard's spellbook holds six spells at 1st level and two more each level", () => {
  for (const level of LEVELS) {
    assert.equal(spellbookAllowance(level), 6 + 2 * (level - 1), `level ${level}`);
  }
  assert.equal(spellbookAllowance(1), 6);
  assert.equal(spellbookAllowance(20), 44);
});

// ---- on a stored sheet ----

await test("a stored sheet at the limit has no problem, and one past it has exactly that one", async () => {
  for (const classId of CLASSES) {
    for (const level of LEVELS) {
      const cap = heldCap(classId, level, 16);
      const cantrips = CANTRIPS_KNOWN[classId]?.[level - 1] ?? 0;
      const problems = async (held, tricks) =>
        spellListProblems((await seated(classId, level, casting(classId, level, held, tricks))).sheet, { bookAllowance: false });
      const label = `${classId} ${level}`;
      assert.deepEqual(await problems(cap, cantrips), [], label);
      if (topSpellLevel(classId, level) > 0) {
        assert.equal((await problems(cap + 1, cantrips)).length, 1, `${label}, a spell over`);
      }
      if (CANTRIPS_KNOWN[classId]) {
        assert.equal((await problems(cap, cantrips + 1)).length, 1, `${label}, a cantrip over`);
      }
    }
  }
});

await test("a spell above what the slots reach is a problem at every level", async () => {
  for (const classId of CLASSES) {
    for (const level of LEVELS) {
      const top = topSpellLevel(classId, level);
      const above = SPELLS[classId][top]?.[0];
      if (!above) {
        continue;
      }
      const lists = casting(classId, level, 0, 0);
      const list = SPELLS_KNOWN[classId] ? "known" : "prepared";
      const { sheet } = await seated(classId, level, { ...lists, [list]: [above] });
      const problems = spellListProblems(sheet, { bookAllowance: false });
      // A 1st level ranger holds no spell at all, which is a problem of its own.
      assert.equal(problems.filter((problem) => problem.includes(above)).length, 1, `${above} (level ${top + 1}) on a ${classId} ${level}: ${problems.join(" ")}`);
    }
  }
});

// ---- through the door a player uses ----

await test("a level-up takes a list at the limit and refuses one spell or one cantrip past it", async () => {
  for (const classId of CLASSES) {
    for (const level of LEVELS.slice(1)) {
      const before = level - 1;
      const cap = heldCap(classId, level, 16);
      const cantrips = CANTRIPS_KNOWN[classId]?.[level - 1] ?? 0;
      // A wizard's book is everything castable the level before, so nothing
      // prepared here is a spell the level-up wrote.
      const book = classId === "wizard" ? castable("wizard", topSpellLevel("wizard", before)) : undefined;
      const from = casting(classId, before, 0, CANTRIPS_KNOWN[classId]?.[before - 1] ?? 0, book);
      const { table, sheet } = await seated(classId, before, from);
      const stored = () => JSON.stringify(table.sheet(sheet.id));
      const untouched = stored();
      const lists = (held, tricks) => {
        const next = { ...casting(classId, level, 0, tricks, book), slots: from.slots };
        const pool = classId === "wizard" ? book : castable(classId, topSpellLevel(classId, level));
        return { ...next, [SPELLS_KNOWN[classId] ? "known" : "prepared"]: pool.slice(0, held) };
      };
      const label = `${classId} ${before} to ${level}`;
      const attempt = (spellcasting) => call("PATCH", { id: sheet.userId }, table.campaignId, { level, spellcasting });

      const spellOver = await attempt(lists(cap + 1, cantrips));
      assert.equal(spellOver.status, 400, `${label}, ${cap + 1} spells: ${JSON.stringify(spellOver.json).slice(0, 200)}`);
      assert.equal(stored(), untouched, `${label}: a refused level-up changed the sheet`);
      if (CANTRIPS_KNOWN[classId]) {
        const cantripOver = await attempt(lists(cap, cantrips + 1));
        assert.equal(cantripOver.status, 400, `${label}, ${cantrips + 1} cantrips`);
        assert.equal(stored(), untouched);
      }
      const atLimit = await attempt(lists(cap, cantrips));
      assert.equal(atLimit.status, 200, `${label} at the limit: ${JSON.stringify(atLimit.json).slice(0, 200)}`);
      const now = table.sheet(sheet.id);
      assert.equal(now.level, level);
      assert.equal((SPELLS_KNOWN[classId] ? now.spellcasting.known : now.spellcasting.prepared).length, cap, label);
      assert.equal((now.spellcasting.cantrips ?? []).length, cantrips, label);
    }
  }
});

await test("a low casting score still prepares one spell, and a high one prepares more", async () => {
  for (const [classId, level, score] of [["cleric", 1, 8], ["paladin", 2, 8], ["druid", 3, 6], ["wizard", 4, 20], ["paladin", 5, 20]]) {
    const from = casting(classId, level, 0, 0, castable(classId, topSpellLevel(classId, level)));
    const { table, sheet } = await seated(classId, level, from, score);
    const cap = heldCap(classId, level + 1, score);
    const pool = castable(classId, topSpellLevel(classId, level));
    const over = await call("PATCH", { id: sheet.userId }, table.campaignId, {
      level: level + 1, spellcasting: { ...from, prepared: pool.slice(0, cap + 1) },
    });
    assert.equal(over.status, 400, `${classId} ${level + 1} with a score of ${score} prepared ${cap + 1}`);
    const fits = await call("PATCH", { id: sheet.userId }, table.campaignId, {
      level: level + 1, spellcasting: { ...from, prepared: pool.slice(0, cap) },
    });
    assert.equal(fits.status, 200, JSON.stringify(fits.json).slice(0, 200));
  }
});

await test("a new character's lists are held to the same columns", async () => {
  for (const [classId, held, cantrips, status] of [
    ["sorcerer", 2, 4, 201], ["sorcerer", 3, 4, 400], ["sorcerer", 2, 5, 400],
    ["bard", 4, 2, 201], ["bard", 5, 2, 400],
    ["warlock", 2, 2, 201], ["warlock", 2, 3, 400],
    ["cleric", 4, 3, 201], ["cleric", 5, 3, 400],
    ["wizard", 4, 3, 201], ["wizard", 4, 4, 400],
  ]) {
    const table = await openWorld({ status: "lobby" });
    // A bard names the three instruments its class leaves to it.
    const tools = classId === "bard" ? { proficiencies: { ...heroInput().proficiencies, tools: ["lute", "drum", "flute"] } } : {};
    const created = await call("POST", table.owner, table.campaignId, heroInput({
      ...hero(classId, 1, casting(classId, 1, held, cantrips)), portrait: PORTRAIT, ...tools,
    }));
    assert.equal(created.status, status, `${classId} with ${held} spells and ${cantrips} cantrips: ${JSON.stringify(created.json).slice(0, 200)}`);
    assert.equal(table.sheets().length, status === 201 ? 1 : 0);
  }
});

await test("a wizard starts with six spells in the book and no more", async () => {
  const pool = castable("wizard", 1);
  for (const [written, status] of [[6, 201], [7, 400]]) {
    const table = await openWorld({ status: "lobby" });
    const created = await call("POST", table.owner, table.campaignId, heroInput({
      ...hero("wizard", 1, casting("wizard", 1, 4, 3, pool.slice(0, written))), portrait: PORTRAIT,
    }));
    assert.equal(created.status, status, `${written} spells in the book: ${JSON.stringify(created.json).slice(0, 200)}`);
  }
});

world.close();
finish();
