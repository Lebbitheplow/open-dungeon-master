// The legality check on its own (src/lib/srd/sheet-legality.ts): what is
// wrong with a sheet as a level N character, and what the server writes in
// place of what a request claims. Pure, so no database is opened: the class,
// race and background rows are the bundled ones and the price, spell and
// feat lookups are the bundled tables.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { legalizeSheet } = await import("../src/lib/srd/sheet-legality.ts");
const options = await import("../src/lib/characters/options.ts");
const { bundledPrices } = await import("../src/lib/srd/starting-wealth.ts");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { bundledSubclassName } = await import("../src/lib/srd/features.ts");
const { derivedMaxHp, hpRange } = await import("../src/lib/srd/hit-points.ts");
const { asiOwed, readAsiLedger } = await import("../src/lib/srd/asi-ledger.ts");
const { earnedAsiCount, earnedAsiCountFor, crossedAsiLevels } = await import("../src/lib/srd/asi.ts");
const { isMechanicalFeature, unmetPrerequisite } = await import("../src/lib/srd/legality/features.ts");
const { slotTableFor } = await import("../src/lib/srd/multiclass.ts");
const { splitPurse } = options;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

const classes = options.srdClassOptions();
const races = options.srdRaceOptions();
const backgrounds = options.srdBackgroundOptions();
const FEATS = { alert: "", grappler: "Strength 13 or higher", "heavy armor master": "Proficiency with heavy armor" };

function context(sheet, overrides = {}) {
  const race = races.find((entry) => entry.id === sheet.race);
  return {
    door: "table",
    level: 1,
    hpMethod: "average",
    startingWealth: "equipment",
    classOf: (id) => classes.find((entry) => entry.id === id) ?? null,
    race: race ? { ...race, feats: race.id === "variant_human" ? 1 : 0 } : null,
    background: backgrounds.find((entry) => entry.id === sheet.background) ?? null,
    baseline: null,
    abilityPool: null,
    wealthRoll: null,
    priceOf: bundledPrices,
    spellOf: checklistSpell,
    featOf: (name) =>
      name.toLowerCase() in FEATS ? { name, prerequisite: FEATS[name.toLowerCase()] } : null,
    subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)),
    rollDie: () => 3,
    ...overrides,
  };
}

const FIGHTER = {
  name: "Brakka", race: "human", class: "fighter", subclass: "", background: "soldier",
  alignment: "N", gender: "", appearance: "",
  abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 },
  maxHp: 12, ac: 18, acOverride: false, speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 }, classes: [], hitDicePools: null,
  proficiencies: {
    saves: ["str", "con"], skills: ["perception", "survival", "athletics", "intimidation"],
    // The soldier's gaming set, named: the builder's doors want the pick.
    expertise: [], languages: ["Common", "Dwarvish"], tools: ["dice set"], armor: [], weapons: [],
  },
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Chain Mail", qty: 1 }, { name: "Shield", qty: 1 }],
  gold: 10, copper: 0, feats: [],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [], spellcasting: null, portrait: null, notes: "", backstory: "",
};
const WIZARD = {
  ...FIGHTER, name: "Ilvane", race: "high_elf", class: "wizard", background: "sage",
  abilities: { str: 8, dex: 16, con: 13, int: 16, wis: 12, cha: 10 },
  proficiencies: {
    ...FIGHTER.proficiencies, saves: [],
    skills: ["investigation", "insight", "arcana", "history", "perception"],
    languages: ["Common", "Elvish", "Dwarvish", "Giant", "Draconic"],
  },
  equipment: [{ name: "Quarterstaff", qty: 1 }], features: [],
  racialChoices: { asi: [], skills: [], cantrip: "Prestidigitation", tool: "" },
  spellcasting: {
    ability: "cha", slots: { 9: { max: 4, used: 0 } },
    prepared: ["Magic Missile", "Shield", "Sleep", "Mage Armor"], known: [],
    cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation"],
    spellbook: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Burning Hands"],
  },
};

const judge = (sheet, overrides) => legalizeSheet(sheet, context(sheet, overrides));
const refused = (sheet, overrides, label) => {
  const out = judge(sheet, overrides);
  assert.ok(out.problems.length > 0, `${label ?? "the sheet"} was let through`);
  return out.problems;
};
const taken = (sheet, overrides) => {
  const out = judge(sheet, overrides);
  assert.deepEqual(out.problems, []);
  return out.sheet;
};

test("a legal fighter passes, and what has one answer is the server's", () => {
  const sheet = taken({
    ...FIGHTER, maxHp: 500, speed: 120, acOverride: true,
    hitDice: { die: "d12", total: 20, spent: 20 },
    proficiencies: { ...FIGHTER.proficiencies, saves: ["str", "dex", "con", "int", "wis", "cha"], armor: ["power armor"] },
    gold: 1000000,
  });
  assert.equal(sheet.maxHp, 12);
  assert.equal(sheet.speed, 30);
  assert.equal(sheet.acOverride, false);
  assert.deepEqual(sheet.hitDice, { die: "d10", total: 1, spent: 0 });
  assert.deepEqual(sheet.proficiencies.saves, ["str", "con"]);
  assert.deepEqual(sheet.proficiencies.armor, ["light", "medium", "heavy", "shields"]);
  assert.deepEqual(sheet.proficiencies.tools, ["vehicles (land)", "dice set"]);
  // The soldier's purse, whatever the request said.
  assert.equal(sheet.gold, 10);
  assert.deepEqual(sheet.classes, []);
});

test("ability scores are held to a method", () => {
  const scores = (value) => ({ str: value, dex: value, con: value, int: value, wis: value, cha: value });
  refused({ ...FIGHTER, abilities: scores(30) });
  refused({ ...FIGHTER, abilities: { ...FIGHTER.abilities, str: 21 } });
  refused({ ...FIGHTER, abilities: scores(19) }, {}, "six 18s with no roll on record");
  refused({ ...FIGHTER, abilities: { ...FIGHTER.abilities, cha: 1 } });
  // A 27 point buy: 15, 15, 15, 8, 8, 8 and the human's +1.
  taken({ ...FIGHTER, abilities: { str: 16, dex: 16, con: 16, int: 9, wis: 9, cha: 9 } });
  refused({ ...FIGHTER, abilities: { str: 16, dex: 16, con: 16, int: 10, wis: 9, cha: 9 } }, {}, "28 points");
  // A pool the server rolled, placed in any order.
  taken({ ...FIGHTER, abilities: scores(19) }, { abilityPool: [18, 18, 18, 18, 18, 18] });
  taken({ ...FIGHTER, abilities: { str: 19, dex: 4, con: 17, int: 12, wis: 12, cha: 8 } }, { abilityPool: [7, 18, 11, 3, 16, 11] });
  refused({ ...FIGHTER, abilities: { str: 19, dex: 5, con: 17, int: 12, wis: 12, cha: 8 } }, { abilityPool: [7, 18, 11, 3, 16, 11] });
});

test("a file's scores are held to what dice can give", () => {
  const door = { door: "import", hpMethod: null };
  taken({ ...FIGHTER, abilities: { str: 19, dex: 19, con: 14, int: 13, wis: 11, cha: 9 } }, door);
  refused({ ...FIGHTER, abilities: { str: 20, dex: 15, con: 14, int: 13, wis: 11, cha: 9 } }, door, "19 before the race");
  refused({ ...FIGHTER, abilities: { str: 3, dex: 15, con: 14, int: 13, wis: 11, cha: 9 } }, door, "2 before the race");
  refused({ ...FIGHTER, maxHp: 500 }, door);
  refused({ ...FIGHTER, gold: 1000000 }, door);
  refused({ ...FIGHTER, class: "demigod" }, door);
});

test("an improvement explains two points and no more", () => {
  const at4 = { level: 4 };
  const base = { ...FIGHTER, maxHp: 36 };
  taken({ ...base, abilities: { ...FIGHTER.abilities, str: 18 }, asiChoices: [{ mode: "plus2", ability: "str" }] }, at4);
  refused({ ...base, abilities: { ...FIGHTER.abilities, str: 19 }, asiChoices: [{ mode: "plus2", ability: "str" }] }, at4);
  refused({ ...base, asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }] }, at4, "two improvements at 4th");
  // A score on the cap may have lost a point to it.
  taken(
    { ...base, race: "mountain_dwarf", proficiencies: { ...FIGHTER.proficiencies, languages: ["Common", "Dwarvish"] },
      abilities: { str: 20, dex: 14, con: 15, int: 12, wis: 10, cha: 8 },
      asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }] },
    { level: 8 },
  );
});

test("hit points follow the table's method", () => {
  const at5 = (hpMethod) => judge({ ...FIGHTER, subclass: "Champion" }, { level: 5, hpMethod });
  assert.equal(at5("average").sheet.maxHp, 12 + 4 * 8);
  assert.equal(at5("max").sheet.maxHp, 12 + 4 * 12);
  const rolled = at5("rolled");
  assert.deepEqual(rolled.rolled.hp, [3, 3, 3, 3]);
  assert.equal(rolled.sheet.maxHp, 12 + 4 * 5);
  assert.deepEqual(at5("average").sheet.hitDice, { die: "d10", total: 5, spent: 0 });
  // Every level adds at least 1.
  assert.equal(derivedMaxHp("average", { classes: [{ die: 6, level: 20 }], con: 3 }), 2 + 19);
  assert.deepEqual(hpRange({ classes: [{ die: 10, level: 3 }, { die: 6, level: 2 }], con: 10 }), { min: 14, max: 42 });
  assert.equal(derivedMaxHp("average", { classes: [{ die: 10, level: 3 }, { die: 6, level: 2 }], con: 10 }), 30);
});

test("skills, expertise and languages need a grant that offers them", () => {
  const profs = (overrides) => ({ ...FIGHTER, proficiencies: { ...FIGHTER.proficiencies, ...overrides } });
  refused(profs({ skills: ["arcana", "stealth", "athletics", "intimidation"] }), {}, "arcana on a fighter");
  refused(profs({ skills: ["perception", "survival", "insight", "athletics", "intimidation"] }), {}, "three class skills");
  refused(profs({ skills: ["lockpicking", "athletics"] }));
  refused(profs({ expertise: ["athletics"] }), {}, "a fighter's expertise");
  refused(profs({ languages: ["Common", "Dwarvish", "Elvish"] }), {}, "two chosen languages");
  // The background's skills arrive whether or not the request names them.
  assert.deepEqual(taken(profs({ skills: ["perception"] })).proficiencies.skills, ["athletics", "intimidation", "perception"]);
  const rogue = {
    ...FIGHTER, class: "rogue", background: "criminal", features: [], equipment: [],
    proficiencies: { ...FIGHTER.proficiencies, skills: ["acrobatics", "athletics", "insight", "perception"], expertise: ["stealth", "acrobatics"] },
  };
  assert.deepEqual(taken(rogue).proficiencies.expertise, ["stealth", "acrobatics"]);
  refused({ ...rogue, proficiencies: { ...rogue.proficiencies, expertise: ["stealth", "acrobatics", "insight"] } });
  refused({ ...rogue, proficiencies: { ...rogue.proficiencies, expertise: ["arcana"] } });
});

test("features and feats come from what grants them", () => {
  refused({ ...FIGHTER, features: [{ name: "Extra Attack (3)", source: "story" }] });
  refused({ ...FIGHTER, features: [{ name: "A kind word from the queen", source: "story" }] });
  refused({ ...FIGHTER, feats: ["Alert"] });
  const kept = taken({
    ...FIGHTER,
    features: [
      { name: "Rage", source: "class" }, { name: "Darkvision 120 ft", source: "race" },
      { name: "Extra Attack (3)", source: "choice" }, { name: "Fighting Style: Archery", source: "choice" },
    ],
  });
  assert.deepEqual(kept.features, [
    { name: "Fighting Style: Archery", source: "choice" },
    { name: "Military Rank (Soldier)", source: "background" },
  ]);
  // The variant human's one feat, and a feat paid for with an improvement.
  const variant = {
    ...FIGHTER, race: "variant_human", abilities: { str: 16, dex: 15, con: 13, int: 12, wis: 10, cha: 8 },
    racialChoices: { asi: ["str", "dex"], skills: ["stealth"], cantrip: "", tool: "" },
    proficiencies: { ...FIGHTER.proficiencies, skills: ["perception", "survival", "stealth"] },
  };
  assert.deepEqual(taken({ ...variant, feats: ["Alert"] }).feats, ["Alert"]);
  refused({ ...variant, feats: ["Alert", "Grappler"] });
  refused({ ...variant, feats: ["Immune to all damage"] });
  assert.deepEqual(
    taken({ ...FIGHTER, maxHp: 36, asiChoices: [{ mode: "feat", feat: "Grappler" }] }, { level: 4 }).feats,
    ["Grappler"],
  );
  // A file may carry a boon that does nothing in the engines.
  const file = { door: "import", hpMethod: null };
  taken({ ...FIGHTER, features: [{ name: "Blessing of the Tide", source: "story" }] }, file);
  refused({ ...FIGHTER, features: [{ name: "Sneak Attack", source: "story" }] }, file);
  assert.equal(isMechanicalFeature("Blessing of the Tide"), false);
  for (const name of ["Rage", "Extra Attack (3)", "Sneak Attack", "Fighting Style: Archery", "Second Wind"]) {
    assert.equal(isMechanicalFeature(name), true, name);
  }
});

test("feat prerequisites", () => {
  const weak = { abilities: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, armor: [], casts: false, raceId: "human", raceName: "Human" };
  const strong = { abilities: { str: 13, dex: 13, con: 8, int: 13, wis: 8, cha: 13 }, armor: ["light", "medium", "heavy"], casts: true, raceId: "half_elf", raceName: "Half-Elf" };
  for (const text of [
    "Strength 13 or higher", "Prerequisite: Strength 13 or higher", "Intelligence or Wisdom 13 or higher",
    "Proficiency with heavy armor", "The ability to cast at least one spell", "Spellcasting or Pact Magic", "Elf or half-elf",
  ]) {
    assert.ok(unmetPrerequisite(text, weak), text);
    assert.equal(unmetPrerequisite(text, strong), null, text);
  }
  assert.equal(unmetPrerequisite("", weak), null);
  refused({ ...FIGHTER, maxHp: 36, abilities: { str: 9, dex: 16, con: 15, int: 14, wis: 11, cha: 13 }, asiChoices: [{ mode: "feat", feat: "Grappler" }] }, { level: 4 });
});

test("a caster's slots and ability are the class's, and the race's cantrip is on top", () => {
  const sheet = taken(WIZARD);
  assert.equal(sheet.spellcasting.ability, "int");
  assert.deepEqual(sheet.spellcasting.slots, { 1: { max: 2, used: 0 } });
  assert.equal(sheet.spellcasting.cantrips.length, 4);
  const casting = (overrides) => ({ ...WIZARD, spellcasting: { ...WIZARD.spellcasting, ...overrides } });
  refused(casting({ cantrips: [...WIZARD.spellcasting.cantrips, "Ray of Frost"] }), {}, "a fifth cantrip");
  refused(casting({ cantrips: ["Fire Bolt", "Fireball", "Prestidigitation"] }), {}, "Fireball as a cantrip");
  refused(casting({ prepared: ["Cure Wounds"], spellbook: ["Cure Wounds"] }), {}, "a cleric's spell");
  refused(casting({ prepared: ["Magic Missile", "Thunderwave"] }), {}, "prepared outside the book");
  refused(casting({ prepared: ["Arcane Detonation"], spellbook: ["Arcane Detonation"] }), {}, "a spell nobody wrote");
  refused({ ...WIZARD, racialChoices: { ...WIZARD.racialChoices, cantrip: "Sacred Flame" }, spellcasting: { ...WIZARD.spellcasting, cantrips: ["Fire Bolt", "Light", "Mage Hand", "Sacred Flame"] } });
  refused({ ...FIGHTER, spellcasting: { ability: "int", slots: {}, prepared: ["Wish"], known: [], cantrips: [] } });
  assert.equal(taken({ ...FIGHTER, spellcasting: { ability: "int", slots: { 9: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: [] } }).spellcasting, null);
});

test("third casters have a third of the slots", () => {
  assert.deepEqual(slotTableFor({ class: "fighter", subclass: "Eldritch Knight", level: 7, classes: [] }), { 1: 4, 2: 2 });
  assert.deepEqual(slotTableFor({ class: "rogue", subclass: "Arcane Trickster", level: 2, classes: [] }), {});
  assert.deepEqual(slotTableFor({ class: "fighter", subclass: "Champion", level: 20, classes: [] }), {});
  // Beside a wizard the knight's levels count a third.
  assert.deepEqual(
    slotTableFor({ class: "fighter", classes: [{ id: "fighter", subclass: "Eldritch Knight", level: 6 }, { id: "wizard", subclass: "", level: 1 }] }),
    { 1: 4, 2: 2 },
  );
});

test("a new character's gear is the kit, or bought from the purse", () => {
  refused({ ...FIGHTER, equipment: [{ name: "Plate", qty: 1 }] });
  refused({ ...FIGHTER, equipment: [{ name: "Shield +3", qty: 1 }] });
  refused({ ...FIGHTER, equipment: [{ name: "Moonlit heirloom", qty: 1 }] });
  refused({ ...FIGHTER, equipment: [{ name: "Dagger", qty: 999 }] });
  // Two daggers at 2 gp from the soldier's 10.
  const bought = taken({ ...FIGHTER, equipment: [...FIGHTER.equipment, { name: "Dagger", qty: 2, attuned: true }] });
  assert.equal(bought.gold, 6);
  assert.ok(bought.equipment.every((item) => !item.attuned));
  // Rolled wealth: nothing is free, and the coin is the server's roll.
  const rolled = { startingWealth: "rolled", wealthRoll: 120 };
  assert.equal(taken({ ...FIGHTER, equipment: [{ name: "Chain Mail", qty: 1 }, { name: "Longsword", qty: 1 }] }, rolled).gold, 30);
  refused({ ...FIGHTER, equipment: [{ name: "Chain Mail", qty: 1 }, { name: "Longbow", qty: 1 }] }, rolled);
  // The kit comes out under its catalog names (src/lib/srd/adventuring-gear.ts, issue #113).
  assert.deepEqual(splitPurse(["holy symbol", "15 gp"]), { equipment: ["Holy Symbol"], purse: 15 });
  assert.deepEqual(splitPurse(["a belt pouch containing 10 gp"]), { equipment: ["Pouch"], purse: 10 });
});

test("a character is made single-class, and a played one keeps a split it could have", () => {
  const split = {
    ...FIGHTER, maxHp: 30,
    abilities: { str: 16, dex: 15, con: 10, int: 14, wis: 11, cha: 9 },
    classes: [{ id: "fighter", subclass: "Champion", level: 3 }, { id: "wizard", subclass: "", level: 2 }],
  };
  const made = taken({ ...split, abilities: FIGHTER.abilities }, { level: 5 });
  assert.deepEqual(made.classes, []);
  const stored = { door: "stored", level: 5 };
  const entered = taken(split, stored);
  assert.deepEqual(entered.classes.map((entry) => [entry.id, entry.level]), [["fighter", 3], ["wizard", 2]]);
  assert.deepEqual(entered.hitDicePools.map((pool) => [pool.die, pool.total]), [["d10", 3], ["d6", 2]]);
  assert.equal(entered.maxHp, 30);
  assert.deepEqual(entered.spellcasting.slots, { 1: { max: 3, used: 0 } });
  assert.ok(entered.proficiencies.saves.includes("str") && !entered.proficiencies.saves.includes("int"));
  refused({ ...split, classes: [{ id: "fighter", subclass: "", level: 11 }, { id: "wizard", subclass: "", level: 9 }] }, stored, "twenty levels at 5th");
  refused({ ...split, abilities: { ...split.abilities, int: 12 } }, stored, "a wizard with Intelligence 12");
  refused({ ...split, abilities: { ...split.abilities, str: 30 } }, stored);
  // A stored character keeps what play gave it.
  const played = taken({ ...FIGHTER, gold: 900, features: [{ name: "Extra Attack (3)", source: "story" }], feats: ["Alert", "Lucky"] }, { door: "stored", level: 1 });
  assert.equal(played.gold, 900);
  assert.equal(played.feats.length, 2);
  assert.equal(played.acOverride, false);
});

test("a subclass waits for its level and belongs to its class", () => {
  assert.equal(taken({ ...FIGHTER, subclass: "Champion" }).subclass, "");
  assert.equal(taken({ ...FIGHTER, subclass: "Champion" }, { level: 3 }).subclass, "Champion");
  refused({ ...FIGHTER, subclass: "Life Domain" }, { level: 3 });
});

test("improvements by class, and what an older sheet is owed", () => {
  assert.deepEqual([4, 6, 8, 12, 14, 16, 19].map((level) => crossedAsiLevels(level - 1, level, "fighter").length), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(crossedAsiLevels(9, 10, "rogue"), [10]);
  assert.deepEqual(crossedAsiLevels(5, 6, "wizard"), []);
  assert.equal(earnedAsiCount(20, "fighter"), 7);
  assert.equal(earnedAsiCount(20, "rogue"), 6);
  assert.equal(earnedAsiCount(20), 5);
  // By class level: a fighter 3 / rogue 1 has earned none.
  assert.equal(earnedAsiCountFor([{ id: "fighter", level: 3 }, { id: "rogue", level: 1 }]), 0);
  // A fighter 8 from before the per-class table took the ones at 4 and 8.
  assert.equal(asiOwed({ level: 8, features: [] }, [{ id: "fighter", level: 8 }]), 1);
  assert.equal(asiOwed({ level: 8, features: [] }, [{ id: "wizard", level: 8 }]), 0);
  assert.equal(asiOwed({ level: 8, features: [{ name: "Ability Score Improvements taken: 3" }] }, [{ id: "fighter", level: 8 }]), 0);
  // A character made at a level has taken what it earned.
  const made = taken({ ...FIGHTER, subclass: "Champion" }, { level: 6 });
  assert.equal(readAsiLedger(made.features), 2);
  assert.equal(readAsiLedger(taken(FIGHTER).features), null);
});

console.log(`test-sheet-legality: ${passed} passed`);
