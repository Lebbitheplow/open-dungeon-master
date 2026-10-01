// Class progression, level 1 to 20, against the SRD 5.1 class tables.
//
// Every class is walked one level at a time through the route a player's
// level-up dialog calls (PATCH /api/campaigns/[id]/sheet), sending what the
// dialog sends: the new level, the fixed hit point gain, the hit dice, the
// subclass at the level the class picks one, and the feature list the engine
// computes for that level. After each level the sheet is read back from the
// database and held against the table the SRD prints, written out by hand
// in scripts/lib/enforce-srd-progression.mjs:
//
//   features   each arrives at its level: none early, none late, none
//              missing, none twice
//   numbers    proficiency bonus, hit dice, hit points, and every counter
//              the class table scales (rages, ki, sorcery points, channel
//              divinity, lay on hands, action surge)
//   riders     what the combat engine reads off the features: extra attacks,
//              sneak attack dice, the martial arts die, brutal critical dice,
//              rage damage, the bardic inspiration and song of rest dice
//   slots      the highest spell level a caster's slots reach, and a
//              warlock's pact slots
//
// A sheet made at a level (a character joining a level 9 table) must hold
// what a sheet walked up to that level holds, so both are checked.
//
// ODM's documented simplifications are pinned as ODM's rule and say so:
// Bardic Inspiration refills on a long rest at every level (the SRD adds
// the short rest at bard 5), and Ability Score Improvements sit at character
// levels 4, 8, 12, 16 and 19 for every class.
import assert from "node:assert/strict";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import {
  CLASS_IDS,
  PACT_SLOTS,
  PACT_SLOT_LEVEL,
  PROFICIENCY_BY_LEVEL,
  SRD_CLASSES,
  UNLIMITED,
  averageHp,
  cleanName,
  expectedFeatureNames,
  expectedResourceMax,
  featurePairs,
  patchSheetAs,
  stepped,
  topSlotLevel,
} from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-class-tables");

const { createSheet } = await import("../src/lib/db/sheets.ts");
const { populateFeaturesForClasses, subclassLevelFor } = await import("../src/lib/srd/features.ts");
const { computeSheetDerived, findClass, spellSlotsFor } = await import("../src/lib/srd/index.ts");
const { combatRiders, songOfRestDieFor } = await import("../src/lib/srd/feature-effects.ts");
const { rageDamageBonus, resourceDef } = await import("../src/lib/srd/class-resources.ts");
const { optionSlotsFor } = await import("../src/lib/srd/options.ts");
const { expertiseSlotsFor } = await import("../src/lib/srd/features.ts");
const { wildShapeCapsFor } = await import("../src/lib/srd/beast-forms.ts");
const { earnedAsiCount, crossedAsiLevels } = await import("../src/lib/srd/asi.ts");
const classFeaturesJson = (
  await import("../src/lib/srd/class-features.json", { with: { type: "json" } })
).default;

// One set of scores for every class, so each ability-scaled counter has a
// known answer: CON 14 is +2 hit points a level, CHA 16 is three Bardic
// Inspirations and four Divine Senses.
const SCORES = { str: 15, dex: 14, con: 14, int: 12, wis: 13, cha: 16 };
const CON_MOD = abilityMod(SCORES.con);

const slotsPatch = (classId, level, before) =>
  Object.fromEntries(
    Object.entries(spellSlotsFor(classId, level)).map(([slotLevel, max]) => [
      slotLevel,
      { max, used: Math.min(before?.[slotLevel]?.used ?? 0, max) },
    ]),
  );

function noProblems(problems) {
  assert.equal(problems.length, 0, `${problems.length} problem(s): ${problems.slice(0, 40).join("; ")}`);
}

// Everything a sheet must satisfy at one level; returns what it does not.
function problemsAt(classId, sheet, level, { withSubclass = true } = {}) {
  const table = SRD_CLASSES[classId];
  const problems = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) {
      problems.push(`L${level} ${label}: ${JSON.stringify(actual)}, the table says ${JSON.stringify(expected)}`);
    }
  };

  expect("level", sheet.level, level);
  expect("proficiency bonus", computeSheetDerived(sheet).proficiencyBonus, PROFICIENCY_BY_LEVEL[level - 1]);
  expect("hit die", sheet.hitDice.die, `d${table.hitDie}`);
  expect("hit dice", sheet.hitDice.total, level);
  expect("hit points", sheet.maxHp, averageHp(table.hitDie, CON_MOD, level) + featureHp(classId, sheet.subclass, level));

  // Features: the class's own entries only, since race and background
  // entries are another suite's.
  const expected = expectedFeatureNames(classId, level, withSubclass);
  const held = sheet.features.filter((feature) => feature.source === "class");
  const seen = new Set();
  for (const feature of held) {
    const key = cleanName(feature.name);
    if (seen.has(key)) {
      problems.push(`L${level} "${feature.name}" is on the sheet twice`);
    }
    seen.add(key);
    if (!expected.has(key)) {
      problems.push(`L${level} "${feature.name}" is on the sheet and not in the table by this level`);
    } else if (feature.level !== expected.get(key)) {
      problems.push(`L${level} "${feature.name}" says level ${feature.level}, the table says ${expected.get(key)}`);
    }
  }
  for (const [key, atLevel] of expected) {
    if (!seen.has(key)) {
      problems.push(`L${level} "${key}" (level ${atLevel}) is missing`);
    }
  }

  // Counters. A level 20 "unlimited" is its own finding below.
  for (const [id, spec] of Object.entries(table.resources ?? {})) {
    const want = expectedResourceMax(spec, level);
    if (want === UNLIMITED) {
      continue;
    }
    // Known gap, recorded below: a paladin's Channel Divinity grows.
    if (classId === "paladin" && id === "channel_divinity" && level >= 6) {
      continue;
    }
    expect(`${id} max`, sheet.resources[id]?.max ?? null, want);
  }
  for (const [id, state] of Object.entries(sheet.resources)) {
    if (!(state.used >= 0 && state.used <= state.max)) {
      problems.push(`L${level} ${id} holds ${state.used} used of ${state.max}`);
    }
  }
  if (classId === "bard") {
    expect("bardic inspiration max", sheet.resources.bardic_inspiration?.max, Math.max(1, abilityMod(SCORES.cha)));
    expect("inspiration die", resourceDef("bardic_inspiration").effect.die(level), stepped(table.inspirationDie, level));
    // Known gap, recorded below: the die stays a d6 from bard 9.
    if (level < 9) {
      expect("song of rest die", songOfRestDieFor(sheet), stepped(table.songOfRest, level, null));
    }
  }
  if (classId === "paladin") {
    expect("divine sense max", sheet.resources.divine_sense?.max, 1 + abilityMod(SCORES.cha));
  }

  // What the combat engine reads off the features.
  const riders = combatRiders(sheet);
  expect("extra attacks", riders.extraAttacks, stepped(table.extraAttacks ?? [], level));
  // Known gap, recorded below: the tiers of Brutal Critical add up from 13.
  if (classId !== "barbarian" || level < 13) {
    expect("brutal critical dice", riders.critExtraDice, stepped(table.critExtraDice ?? [], level));
  }
  expect("critical range", riders.critRange, withSubclass ? stepped(table.critRange ?? [], level, 20) : 20);
  expect("sneak attack dice", riders.sneakAttackDice, table.sneakAttack ? Math.ceil(level / 2) : 0);
  expect("martial arts die", riders.martialArtsDie, stepped(table.martialArts ?? [], level, null));
  expect("speed bonus", riders.unarmoredSpeedBonus, stepped(table.speedBonus ?? [], level));
  expect("smite", riders.canSmite, classId === "paladin" && level >= 2);
  if (table.rageDamage) {
    expect("rage damage", rageDamageBonus(level), stepped(table.rageDamage, level));
  }

  // Pick-lists and expertise the level opens.
  for (const [kind, steps] of Object.entries(table.options ?? {})) {
    expect(`${kind} picks`, optionSlotsFor(classId, sheet.subclass, level, kind), stepped(steps, level));
  }
  expect("expertise picks", expertiseSlotsFor(classId, level), stepped(table.expertise ?? [], level));

  // Spell slots.
  const slots = sheet.spellcasting?.slots ?? {};
  const open = Object.entries(slots).filter(([, slot]) => slot.max > 0).map(([slotLevel]) => Number(slotLevel));
  if (table.caster === "pact") {
    expect("pact slot level", Math.max(0, ...open), stepped(PACT_SLOT_LEVEL, level));
    expect("pact slots", slots[String(stepped(PACT_SLOT_LEVEL, level))]?.max, stepped(PACT_SLOTS, level));
    expect("pact slot levels open", open.length, 1);
  } else {
    expect("top slot level", Math.max(0, ...open), topSlotLevel(table.caster, level));
  }
  for (const [slotLevel, slot] of Object.entries(slots)) {
    if (!(slot.used >= 0 && slot.used <= slot.max)) {
      problems.push(`L${level} slot ${slotLevel} holds ${slot.used} used of ${slot.max}`);
    }
  }
  return problems;
}

// Hit points a class feature adds on top of the dice (SRD 5.1): Draconic
// Resilience one per sorcerer level, and Primal Champion's +4 Constitution,
// which counts for every level held.
function featureHp(classId, subclass, level) {
  if (classId === "sorcerer" && /draconic/i.test(subclass ?? "")) {
    return level;
  }
  if (classId === "barbarian" && level >= 20) {
    return (abilityMod(SCORES.con + 4) - CON_MOD) * level;
  }
  return 0;
}

const heroOf = (classId, level, subclass) => {
  const table = SRD_CLASSES[classId];
  return {
    class: classId,
    level,
    subclass,
    abilities: SCORES,
    maxHp: averageHp(table.hitDie, CON_MOD, level) + featureHp(classId, subclass, level),
    spellcasting: table.ability
      ? { ability: table.ability, slots: slotsPatch(classId, level), prepared: [], known: [], cantrips: [] }
      : null,
  };
};

// A sheet made at a level, through the one function every creation path
// ends in. It belongs to a user of its own who holds no seat: a table takes
// one sheet per player and these are only read.
function newHero(world, classId, level, subclass = "") {
  return createSheet(
    world.campaignId,
    world.addUser().id,
    level,
    heroInput({ name: `${classId} ${level}`, ...heroOf(classId, level, subclass) }),
  );
}

// ---- ODM's bundled tables against the SRD's ----

await test("class-features.json prints every SRD feature at its SRD level, and nothing else", () => {
  const problems = [];
  for (const classId of CLASS_IDS) {
    const table = SRD_CLASSES[classId];
    const bundled = classFeaturesJson.classes[classId];
    assert.ok(bundled, `${classId} is missing from class-features.json`);
    const wanted = new Set(featurePairs(table.features).map((pair) => `${pair.level}:${cleanName(pair.name)}`));
    const printed = new Set(featurePairs(bundled.levels).map((pair) => `${pair.level}:${cleanName(pair.name)}`));
    for (const key of wanted) {
      if (!printed.has(key)) {
        problems.push(`${classId} lacks ${key}`);
      }
    }
    for (const key of printed) {
      if (!wanted.has(key)) {
        problems.push(`${classId} adds ${key}`);
      }
    }
    if (bundled.subclassLevel !== table.subclassAt) {
      problems.push(`${classId} picks a subclass at ${bundled.subclassLevel}, the SRD at ${table.subclassAt}`);
    }
  }
  assert.deepEqual(problems, []);
});

await test("every class has its SRD hit die and picks its subclass at the SRD level", () => {
  for (const classId of CLASS_IDS) {
    assert.equal(findClass(classId)?.hitDie, SRD_CLASSES[classId].hitDie, classId);
    assert.equal(findClass(classId)?.casterType, SRD_CLASSES[classId].caster, classId);
    assert.equal(subclassLevelFor(classId), SRD_CLASSES[classId].subclassAt, classId);
  }
});

await test("the proficiency bonus steps at 5, 9, 13 and 17", () => {
  for (let level = 1; level <= 20; level += 1) {
    const derived = computeSheetDerived({
      abilities: SCORES,
      level,
      proficiencies: { saves: ["str"], skills: ["athletics"], expertise: [] },
      spellcasting: null,
    });
    const bonus = PROFICIENCY_BY_LEVEL[level - 1];
    assert.equal(derived.proficiencyBonus, bonus, `level ${level}`);
    assert.equal(derived.saves.str, abilityMod(SCORES.str) + bonus, `level ${level} save`);
    assert.equal(derived.skills.athletics, abilityMod(SCORES.str) + bonus, `level ${level} skill`);
  }
});

// ---- the walk ----

const world = await openWorld();
const sheetRoute = await world.route("campaigns/[campaignId]/sheet");

for (const classId of CLASS_IDS) {
  const table = SRD_CLASSES[classId];
  const label = table.outsideSrd ? `${classId} (outside SRD 5.1)` : classId;

  await test(`${label}: walked from 1 to 20, every level matches the class table`, async () => {
    const table20 = await openWorld();
    const hero = table20.addHero(
      heroOf(classId, 1, table.subclassAt === 1 ? (table.subclass?.name ?? "") : ""),
    );
    // A level is taken with the experience for it; the walk is about what
    // each level holds, so the hero has the experience of 20th from the start.
    table20.patch(hero.id, { xp: 355000 });
    const problems = problemsAt(classId, table20.sheet(hero.id), 1);
    for (let level = 2; level <= 20; level += 1) {
      const before = table20.sheet(hero.id);
      const subclass =
        level >= table.subclassAt && table.subclass ? table.subclass.name : before.subclass;
      const gain = table.hitDie / 2 + 1 + CON_MOD;
      const response = await patchSheetAs(table20, sheetRoute, table20.owner, {
        level,
        maxHp: before.maxHp + gain,
        currentHp: before.currentHp + gain,
        hitDice: { ...before.hitDice, total: level },
        features: populateFeaturesForClasses(
          before.features,
          [{ id: classId, subclass, level }],
          before.race,
        ),
        ...(subclass !== before.subclass ? { subclass } : {}),
        ...(before.spellcasting
          ? {
              spellcasting: {
                ...before.spellcasting,
                slots: slotsPatch(classId, level, before.spellcasting.slots),
              },
            }
          : {}),
      });
      assert.equal(response.status, 200, `level ${level}: ${response.json.error}`);
      const after = table20.sheet(hero.id);
      // Nothing gained earlier is ever lost on the way up.
      for (const feature of before.features) {
        if (!after.features.some((entry) => cleanName(entry.name) === cleanName(feature.name))) {
          problems.push(`L${level} lost "${feature.name}"`);
        }
      }
      problems.push(...problemsAt(classId, after, level));
    }
    noProblems(problems);
  });

  await test(`${label}: a sheet made at any level holds what that level has earned`, () => {
    const problems = [];
    for (let level = 1; level <= 20; level += 1) {
      const subclass = level >= table.subclassAt && table.subclass ? table.subclass.name : "";
      const made = newHero(world, classId, level, subclass);
      problems.push(...problemsAt(classId, world.sheet(made.id), level));
    }
    noProblems(problems);
  });
}

await test("a druid's beast forms open at the SRD levels", () => {
  const table = SRD_CLASSES.druid;
  for (let level = 2; level <= 20; level += 1) {
    const caps = wildShapeCapsFor(level, false);
    assert.equal(caps.maxCr, stepped(table.wildShapeCr, level), `level ${level} CR`);
    assert.equal(caps.swim, stepped(table.wildShapeSwim, level, false), `level ${level} swim`);
    assert.equal(caps.fly, stepped(table.wildShapeFly, level, false), `level ${level} fly`);
  }
});

// ---- ODM's documented rules ----

await test("ODM's rule: Bardic Inspiration refills on a long rest at every level", () => {
  // SRD 5.1 adds the short rest from bard 5 (Font of Inspiration). ODM
  // declares the long rest at every level in src/lib/srd/class-resources.ts
  // ("modeled as long for simplicity, the server errs toward scarcity").
  assert.equal(resourceDef("bardic_inspiration").recharge, "long");
});

await test("ODM's rule: improvements sit at character levels 4, 8, 12, 16 and 19", () => {
  // docs/rules-coverage.md, "Kept simplifications". The count is by
  // character level and takes no class.
  const counts = [];
  for (let level = 1; level <= 20; level += 1) {
    counts.push(earnedAsiCount(level));
  }
  assert.deepEqual(counts, [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5]);
  assert.deepEqual(crossedAsiLevels(1, 20), [4, 8, 12, 16, 19]);
});

// ---- findings ----

await test(
  "A fighter gains Ability Score Improvements at 4, 6, 8, 12, 14, 16 and 19 (seven), a rogue at 4, 8, 10, 12, 16 and 19 (six).",
  () => {
    const earned = (classId) =>
      SRD_CLASSES[classId].asi.filter((level) => crossedAsiLevels(level - 1, level, classId).length === 1);
    assert.deepEqual(earned("fighter"), SRD_CLASSES.fighter.asi, `a fighter improves at ${earned("fighter").join(", ")}`);
    assert.deepEqual(earned("rogue"), SRD_CLASSES.rogue.asi, `a rogue improves at ${earned("rogue").join(", ")}`);
  },
);

await test("A paladin has one use of Channel Divinity per rest at every level; only the cleric's grows to two at 6 and three at 18.", () => {
  for (const level of [3, 5, 6, 17, 18, 20]) {
    const paladin = newHero(world, "paladin", level, "Oath of Devotion");
    const uses = world.sheet(paladin.id).resources.channel_divinity.max;
    assert.equal(uses, 1, `a paladin ${level} holds ${uses} uses`);
  }
});

await test("Brutal Critical adds one extra weapon die to a critical hit at barbarian 9, two at 13 and three at 17.", () => {
  for (const [level, dice] of [[9, 1], [13, 2], [17, 3], [20, 3]]) {
    const barbarian = newHero(world, "barbarian", level, "Path of the Berserker");
    const rolled = combatRiders(world.sheet(barbarian.id)).critExtraDice;
    assert.equal(rolled, dice, `a barbarian ${level} adds ${rolled} dice to a critical hit`);
  }
});

await test("Song of Rest heals a d6 at bard 2, a d8 at 9, a d10 at 13 and a d12 at 17.", () => {
  for (const [level, die] of SRD_CLASSES.bard.songOfRest) {
    const bard = newHero(world, "bard", level, "College of Lore");
    const rolled = songOfRestDieFor(world.sheet(bard.id));
    assert.equal(rolled, die, `a bard ${level} sings a ${rolled}`);
  }
});

await test("A level 20 barbarian rages without limit.", () => {
  const barbarian = newHero(world, "barbarian", 20, "Path of the Berserker");
  const rages = world.sheet(barbarian.id).resources.rage.max;
  assert.ok(rages > 6, `a barbarian 20 holds ${rages} rages`);
});

await test("A level 20 druid (Archdruid) uses Wild Shape without limit.", () => {
  const druid = newHero(world, "druid", 20, "Circle of the Land");
  const uses = world.sheet(druid.id).resources.wild_shape.max;
  assert.ok(uses > 2, `a druid 20 holds ${uses} uses`);
});

await test("Indomitable rerolls a failed save once per long rest at fighter 9, twice at 13, three times at 17.", () => {
  for (const level of [9, 13, 17]) {
    const fighter = newHero(world, "fighter", level, "Champion");
    const counter = Object.entries(world.sheet(fighter.id).resources).find(([id]) => /indomitable/.test(id));
    assert.equal(
      counter?.[1].max,
      stepped(SRD_CLASSES.fighter.indomitable, level),
      `a fighter ${level} holds no Indomitable counter`,
    );
  }
});

world.close();
finish();
