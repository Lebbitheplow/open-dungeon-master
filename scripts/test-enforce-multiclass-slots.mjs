// A multiclassed caster's spell slots and spell lists, as the level-up route
// builds them and as the casting and rest engines spend and refill them.
//
// The rules guarded here are SRD 5.1's "Multiclassing: Spellcasting" and
// ODM's statement of them (docs/rules-coverage.md, "Multiclassing"):
//
// - With two or more Spellcasting classes the slots come from the multiclass
//   table at the combined caster level: every bard, cleric, druid, sorcerer
//   and wizard level, half the paladin and ranger levels rounded down.
// - With one Spellcasting class the character keeps that class's own table,
//   whatever else they are: a paladin 5 / fighter 3 has a paladin 5's slots.
// - Pact Magic stands apart. Warlock levels add nothing to the shared table,
//   pact slots come back on a short rest, and either kind of slot pays for a
//   spell of either class.
// - Each class knows and prepares spells as if single-classed: its own
//   count, its own ability, and no spell above what its own level reaches,
//   even when the shared slots go higher.
// - A level-up never refunds a spent slot.
//
// ODM's artificer (not an SRD 5.1 class) counts half its levels rounded up.
import assert from "node:assert/strict";
import {
  SRD_MULTICLASS_SLOTS,
  assertCoherent,
  openTable,
  scores,
  slotMap,
  storedSlots,
} from "./lib/enforce-multiclass.mjs";
import { proficiencyBonus, abilityMod, suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-multiclass-slots");
const table = await openTable();
const { world, send, hero, now, levelUp, levelInto, assertRefused } = table;
const { spellSlotsFor, spellSaveDcFor, spellAttackFor } = await import("../src/lib/srd/index.ts");
const { multiclassSlots, pactSlotsFor } = await import("../src/lib/srd/multiclass.ts");

// SRD 5.1, the paladin and ranger tables: slots by class level.
const SRD_HALF_CASTER_SLOTS = [
  [], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2],
  [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 2],
  [4, 3, 3, 3, 1], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2],
];

// SRD 5.1, the warlock table: [slots, slot level] by warlock level.
const SRD_PACT_SLOTS = [
  [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
  [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

const all13 = scores({ str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 });
const casting = (ability, slots, lists = {}) => ({
  ability, slots, prepared: [], known: [], cantrips: [], ...lists,
});
const used = (max, spent) => ({ max, used: spent });
const cast = (level, spell) =>
  world.invoke("use_spell_slot", { characterId: now().id, level, ...(spell ? { spell } : {}) });

await test("ODM's slot tables are the SRD's, row for row", () => {
  for (let level = 1; level <= 20; level += 1) {
    const shared = slotMap(SRD_MULTICLASS_SLOTS[level - 1]);
    assert.deepEqual(slotMap(Object.values(multiclassSlots(level))), shared, `multiclass ${level}`);
    for (const classId of ["bard", "cleric", "druid", "sorcerer", "wizard"]) {
      assert.deepEqual(slotMap(Object.values(spellSlotsFor(classId, level))), shared, `${classId} ${level}`);
    }
    for (const classId of ["paladin", "ranger"]) {
      assert.deepEqual(
        slotMap(Object.values(spellSlotsFor(classId, level))),
        slotMap(SRD_HALF_CASTER_SLOTS[level - 1]),
        `${classId} ${level}`,
      );
    }
    const [max, slotLevel] = SRD_PACT_SLOTS[level - 1];
    assert.deepEqual(pactSlotsFor(level), { level: slotLevel, max }, `warlock ${level}`);
  }
});

await test("two full casters share the multiclass table at every caster level", async () => {
  for (let casterLevel = 2; casterLevel <= 20; casterLevel += 1) {
    hero({
      class: "wizard", level: casterLevel - 1, abilities: all13,
      spellcasting: casting("int", {}),
    });
    await levelInto("cleric");
    assert.deepEqual(storedSlots(now()), slotMap(SRD_MULTICLASS_SLOTS[casterLevel - 1]), `caster level ${casterLevel}`);
    assertCoherent(now(), `wizard ${casterLevel - 1} / cleric 1`);
  }
});

await test("every pair of full casters counts both classes in full", async () => {
  const full = ["bard", "cleric", "druid", "sorcerer", "wizard"];
  for (const from of full) {
    for (const to of full.filter((id) => id !== from)) {
      hero({ class: from, level: 3, abilities: all13 });
      await levelInto(to, 2);
      assert.deepEqual(storedSlots(now()), slotMap(SRD_MULTICLASS_SLOTS[4]), `${from} 3 / ${to} 2`);
    }
  }
});

await test("paladin and ranger levels count half, rounded down", async () => {
  // [first class, its level, second class, its level, caster level]
  for (const [from, fromLevel, to, toLevel, casterLevel] of [
    ["wizard", 1, "paladin", 1, 1],
    ["wizard", 3, "paladin", 1, 3],
    ["wizard", 3, "paladin", 2, 4],
    ["wizard", 3, "paladin", 3, 4],
    ["wizard", 3, "ranger", 5, 5],
    ["cleric", 1, "ranger", 9, 5],
    ["paladin", 5, "wizard", 3, 5],
    ["paladin", 4, "ranger", 2, 3],
    ["ranger", 6, "paladin", 6, 6],
  ]) {
    hero({ class: from, level: fromLevel, abilities: all13 });
    await levelInto(to, toLevel);
    assert.deepEqual(
      storedSlots(now()),
      slotMap(SRD_MULTICLASS_SLOTS[casterLevel - 1]),
      `${from} ${fromLevel} / ${to} ${toLevel}`,
    );
  }
  // Two half casters one level each: caster level 0, no slots at all.
  hero({ class: "paladin", level: 1, abilities: all13 });
  await levelInto("ranger");
  assert.deepEqual(storedSlots(now()), {});
});

await test("one Spellcasting class keeps its own table", async () => {
  // SRD: the multiclass table is for a character with more than one
  // Spellcasting class. A single-classed paladin 2 has 2 slots; the same
  // paladin with a sorcerer level has the caster level 2 row, 3 slots.
  hero({ class: "paladin", level: 2, abilities: all13, spellcasting: casting("cha", { 1: used(2, 0) }) });
  await levelInto("fighter");
  assert.deepEqual(storedSlots(now()), { 1: 2 });
  await levelInto("paladin", 3);
  assert.deepEqual(storedSlots(now()), slotMap(SRD_HALF_CASTER_SLOTS[4]));

  hero({ class: "paladin", level: 2, abilities: all13, spellcasting: casting("cha", { 1: used(2, 0) }) });
  await levelInto("sorcerer");
  assert.deepEqual(storedSlots(now()), { 1: 3 });

  // A martial class that takes up casting starts on the caster's own table.
  hero({ class: "fighter", level: 5, abilities: all13 });
  await levelInto("wizard", 3);
  assert.deepEqual(storedSlots(now()), slotMap(SRD_MULTICLASS_SLOTS[2]));
  assert.equal(now().spellcasting.ability, "int");
});

// ODM's rule. The artificer is not in SRD 5.1; its own text rounds up.
await test("artificer levels count half, rounded up (ODM's rule)", async () => {
  for (const [artificerLevel, casterLevel] of [[1, 2], [2, 2], [3, 3], [5, 4]]) {
    hero({ class: "wizard", level: 1, abilities: all13 });
    await levelInto("artificer", artificerLevel);
    assert.deepEqual(storedSlots(now()), slotMap(SRD_MULTICLASS_SLOTS[casterLevel - 1]), `artificer ${artificerLevel}`);
  }
});

await test("warlock levels add nothing to the shared table and keep their own pact slots", async () => {
  for (const warlockLevel of [1, 2, 3, 5, 9, 11, 17]) {
    hero({ class: "sorcerer", level: 2, abilities: all13 });
    await levelInto("warlock", warlockLevel);
    const [max, slotLevel] = SRD_PACT_SLOTS[warlockLevel - 1];
    assert.deepEqual(storedSlots(now()), slotMap(SRD_MULTICLASS_SLOTS[1]), `warlock ${warlockLevel}`);
    assert.deepEqual(now().spellcasting.pact, { level: slotLevel, max, used: 0 }, `warlock ${warlockLevel}`);
    assertCoherent(now());
  }
  // A warlock beside a class that casts nothing: pact slots and no others.
  hero({ class: "fighter", level: 2, abilities: all13 });
  await levelInto("warlock", 3);
  assert.deepEqual(storedSlots(now()), {});
  assert.deepEqual(now().spellcasting.pact, { level: 2, max: 2, used: 0 });
});

await test("custom genre casters join the shared table by their kind", async () => {
  // netrunner is a full caster, rigger a half caster, grave_knight a pact one.
  hero({ class: "wizard", level: 2, abilities: all13 });
  await levelInto("netrunner", 3);
  assert.deepEqual(storedSlots(now()), slotMap(SRD_MULTICLASS_SLOTS[4]));
  hero({ class: "wizard", level: 2, abilities: all13 });
  await levelInto("rigger", 3);
  assert.deepEqual(storedSlots(now()), slotMap(SRD_MULTICLASS_SLOTS[2]));
  hero({ class: "wizard", level: 2, abilities: all13 });
  await levelInto("grave_knight", 5);
  assert.deepEqual(storedSlots(now()), slotMap(SRD_MULTICLASS_SLOTS[1]));
  assert.deepEqual(now().spellcasting.pact, { level: 3, max: 2, used: 0 });
});

await test("a level-up keeps the slots already spent", async () => {
  hero({
    class: "wizard", level: 3, abilities: all13,
    spellcasting: casting("int", { 1: used(4, 3), 2: used(2, 2) }),
  });
  await levelInto("cleric");
  assert.deepEqual(now().spellcasting.slots, { 1: used(4, 3), 2: used(3, 2) });
  await levelInto("cleric");
  assert.deepEqual(now().spellcasting.slots, { 1: used(4, 3), 2: used(3, 2), 3: used(2, 0) });
  await levelInto("fighter");
  assert.deepEqual(now().spellcasting.slots, { 1: used(4, 3), 2: used(3, 2), 3: used(2, 0) });
});

await test("pact and shared slots pay for each other's spells, and stop when both are spent", async () => {
  hero({
    class: "sorcerer", level: 3, abilities: all13,
    spellcasting: casting("cha", { 1: used(4, 0), 2: used(2, 0) }, { known: ["Magic Missile", "Scorching Ray"] }),
  });
  await levelInto("warlock", 3, { levelUpSpells: ["Hex"] });
  assert.deepEqual(now().spellcasting.pact, { level: 2, max: 2, used: 0 });
  // Two shared and two pact slots of level 2: four casts, whoever's spell.
  for (const spell of ["Scorching Ray", "Hex", "Scorching Ray", "Hex"]) {
    const out = await cast(2, spell);
    assert.equal(out.ok, true, out.error);
    assertCoherent(now());
  }
  assert.deepEqual([now().spellcasting.slots[2].used, now().spellcasting.pact.used], [2, 2]);
  for (const spell of ["Scorching Ray", "Hex"]) {
    const before = now();
    const out = await cast(2, spell);
    assert.equal(out.ok, false, `a fifth level 2 cast of ${spell} went through`);
    assert.deepEqual(now().spellcasting, before.spellcasting);
  }
  // A warlock spell from a shared slot of another level.
  const low = await cast(1, "Hex");
  assert.equal(low.ok, true, low.error);
  assert.equal(now().spellcasting.slots[1].used, 1);
  // A spell nobody on the sheet knows spends nothing.
  const before = now();
  assert.equal((await cast(1, "Cure Wounds")).ok, false);
  assert.deepEqual(now().spellcasting, before.spellcasting);
});

await test("a short rest refills pact slots only, a long rest refills both", async () => {
  hero({
    class: "sorcerer", level: 3, abilities: all13,
    spellcasting: casting("cha", { 1: used(4, 2), 2: used(2, 2) }, { known: ["Magic Missile"] }),
  });
  await levelInto("warlock", 3);
  await cast(2);
  await cast(2);
  assert.equal(now().spellcasting.pact.used, 2);
  const short = await world.invoke("take_rest", { kind: "short" });
  assert.equal(short.ok, true, short.error);
  assert.equal(now().spellcasting.pact.used, 0);
  assert.deepEqual(now().spellcasting.slots, { 1: used(4, 2), 2: used(2, 2) });
  await cast(2);
  const long = await world.invoke("take_rest", { kind: "long" });
  assert.equal(long.ok, true, long.error);
  assert.equal(now().spellcasting.pact.used, 0);
  assert.deepEqual(now().spellcasting.slots, { 1: used(4, 0), 2: used(2, 0) });
  assertCoherent(now());
});

await test("the player's own counter cannot raise a slot maximum or spend past it", async () => {
  hero({ class: "wizard", level: 3, abilities: all13, spellcasting: casting("int", { 1: used(4, 0), 2: used(2, 0) }) });
  await levelInto("cleric");
  const out = await send("usage", "POST", { slots: { 1: 9, 2: 10, 9: 0 } });
  assert.equal(out.status, 200, out.error);
  assert.deepEqual(now().spellcasting.slots, { 1: used(4, 4), 2: used(3, 3) });
});

await test("each class holds its own spells, counted at its own level and ability", async () => {
  // Sorcerer 1 knows 2 spells. Cleric 1 prepares Wisdom modifier + 1.
  hero({
    class: "wizard", level: 3, abilities: scores({ int: 16, wis: 14, cha: 13 }),
    spellcasting: casting("int", { 1: used(4, 0), 2: used(2, 0) }, {
      prepared: ["Magic Missile", "Shield"], spellbook: ["Magic Missile", "Shield", "Sleep"],
    }),
  });
  await assertRefused(
    { level: 4, levelUpClass: "sorcerer", levelUpSpells: ["Burning Hands", "Chromatic Orb", "Sleep"] },
    "three spells known at sorcerer 1",
  );
  await levelInto("sorcerer", 1, { levelUpSpells: ["Burning Hands", "Chromatic Orb"] });
  await assertRefused(
    { level: 5, levelUpClass: "cleric", levelUpSpells: ["Bless", "Cure Wounds", "Guiding Bolt", "Sanctuary"] },
    "four spells prepared at cleric 1 with Wisdom 14",
  );
  await levelInto("cleric", 1, { levelUpSpells: ["Bless", "Cure Wounds", "Guiding Bolt"] });
  const byClass = Object.fromEntries(now().spellcasting.casters.map((caster) => [caster.classId, caster]));
  assert.deepEqual(Object.keys(byClass), ["wizard", "sorcerer", "cleric"]);
  assert.deepEqual([byClass.wizard.ability, byClass.sorcerer.ability, byClass.cleric.ability], ["int", "cha", "wis"]);
  assert.deepEqual(byClass.wizard.prepared, ["Magic Missile", "Shield"]);
  assert.deepEqual(byClass.sorcerer.known, ["Burning Hands", "Chromatic Orb"]);
  assert.deepEqual(byClass.cleric.prepared, ["Bless", "Cure Wounds", "Guiding Bolt"]);
  // Save DC and attack bonus: the casting class's ability, the CHARACTER's
  // proficiency bonus (level 5: +3).
  const bonus = proficiencyBonus(5);
  for (const [spell, score] of [["Magic Missile", 16], ["Burning Hands", 13], ["Bless", 14]]) {
    assert.equal(spellSaveDcFor(now(), spell), 8 + bonus + abilityMod(score), spell);
    assert.equal(spellAttackFor(now(), spell), bonus + abilityMod(score), spell);
  }
  // The next sorcerer level knows one more, not two.
  await assertRefused(
    { level: 6, levelUpClass: "sorcerer", levelUpSpells: ["Sleep", "Shield"] },
    "two new spells at sorcerer 2",
  );
});

await test("a wizard level writes its two spells in the book, a first one six", async () => {
  hero({ class: "cleric", level: 3, abilities: all13, spellcasting: casting("wis", { 1: used(4, 0), 2: used(2, 0) }) });
  const seven = ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Burning Hands", "Charm Person", "Detect Magic"];
  await assertRefused({ level: 4, levelUpClass: "wizard", levelUpSpells: seven }, "seven spells in a first book");
  await levelInto("wizard", 1, { levelUpSpells: seven.slice(0, 6) });
  assert.equal(now().spellcasting.casters[1].spellbook.length, 6);
  await assertRefused(
    { level: 5, levelUpClass: "wizard", levelUpSpells: ["Detect Magic", "Identify", "Thunderwave"] },
    "three spells at wizard 2",
  );
});

// ---- not enforced today ----

await test(
  "Each class learns and prepares spells as if single-classed: a wizard 1 beside a cleric 5 has 3rd-level slots and still learns 1st-level wizard spells only.",
  async () => {
    hero({ class: "cleric", level: 5, abilities: all13, spellcasting: casting("wis", { 1: used(4, 0), 2: used(3, 0), 3: used(2, 0) }) });
    const out = await levelUp("wizard", { levelUpSpells: ["Fireball", "Wish"] });
    const book = now().spellcasting?.casters?.find((caster) => caster.classId === "wizard")?.spellbook ?? [];
    assert.ok(out.status >= 400 || book.length === 0, `a wizard 1 wrote ${book.join(" and ")} in the book`);
  },
);

await test(
  "A class knows the cantrips its own table gives: three for a cleric 1.",
  async () => {
    hero({ class: "wizard", level: 3, abilities: all13, spellcasting: casting("int", { 1: used(4, 0), 2: used(2, 0) }) });
    const out = await levelUp("cleric", {
      levelUpSpells: ["Sacred Flame", "Guidance", "Light", "Thaumaturgy", "Mending", "Resistance", "Spare the Dying"],
    });
    const cantrips = now().spellcasting?.casters?.find((caster) => caster.classId === "cleric")?.cantrips ?? [];
    assert.ok(out.status >= 400 || cantrips.length <= 3, `a cleric 1 knows ${cantrips.length} cantrips`);
  },
);

await test(
  "A class learns spells from its own spell list: Eldritch Blast is a warlock's, Fireball is not a cleric's.",
  async () => {
    hero({ class: "fighter", level: 4, abilities: all13 });
    const out = await levelUp("cleric", { levelUpSpells: ["Eldritch Blast", "Magic Missile"] });
    const cleric = now().spellcasting?.casters?.find((caster) => caster.classId === "cleric");
    const held = [...(cleric?.cantrips ?? []), ...(cleric?.prepared ?? [])];
    assert.ok(out.status >= 400 || held.length === 0, `a cleric 1 holds ${held.join(" and ")}`);
  },
);

await test(
  "A level-up never refunds a spent spell slot.",
  async () => {
    hero({
      class: "warlock", level: 3, abilities: all13,
      spellcasting: casting("cha", { 2: used(2, 2) }, { known: ["Hex"] }),
    });
    await levelInto("fighter");
    assert.equal(now().spellcasting.pact.used, 2, "both spent pact slots came back with the level");
  },
);

world.close();
finish();
