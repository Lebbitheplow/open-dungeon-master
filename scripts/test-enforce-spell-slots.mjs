// Spell slots, as SRD 5.1 prints them, against what ODM hands a caster.
//
// The slot tables (full casters, paladin and ranger, warlock Pact Magic, and
// the artificer ODM ships beside them) are typed out in
// scripts/lib/enforce-spells.mjs and compared here to the bundled JSON, to
// spellSlotsFor for every class at every level, to the multiclass table, and
// to the slots a sheet really carries after it is created, joined at another
// level, levelled up and rested. A slot counter never leaves 0..max whatever
// is thrown at it, a long rest brings every slot back, and a short rest
// brings back a warlock's and nobody else's.
//
// A player may mark slots as spent by their own hand, never as unspent:
// slots come back at a rest, and a correction is the DM's or the party
// lead's to make. The usage route lets a player refill between fights
// (src/app/api/campaigns/[campaignId]/sheet/usage/route.ts), which is
// recorded here as a gap.
import assert from "node:assert/strict";
import { openWorld, heroInput } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import {
  ARTIFICER_SLOTS,
  FULL_CASTERS,
  FULL_CASTER_SLOTS,
  HALF_CASTERS,
  HALF_CASTER_SLOTS,
  NON_CASTERS,
  PACT_SLOTS,
  PORTRAIT,
  PACT_SLOT_LEVEL,
  THIRD_CASTER_SLOTS,
  cleric,
  fightWithoutMap,
  rowToTable,
  slotsOf,
  sorcerer,
  warlock,
  wizard,
} from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-spell-slots");
const world = await openWorld();
const { spellSlotsFor } = await import("../src/lib/srd/index.ts");
const { multiclassSlots, pactSlotsFor, slotTableFor } = await import("../src/lib/srd/multiclass.ts");
const { createCharacter } = await import("../src/lib/db/characters.ts");
const { default: slotJson } = await import("../src/lib/srd/spell-slots.json", { with: { type: "json" } });

const LEVELS = Array.from({ length: 20 }, (_, index) => index + 1);

async function call(mod, method, user, campaignId, body) {
  world.signIn(user);
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve({ campaignId }) });
  return { status: response.status, json: await response.json() };
}

// ---- the tables ----

await test("the bundled slot JSON is the SRD table, row for row", () => {
  for (const level of LEVELS) {
    assert.deepEqual(slotJson.full[String(level)], FULL_CASTER_SLOTS[level - 1], `full caster level ${level}`);
    assert.deepEqual(slotJson.half[String(level)], HALF_CASTER_SLOTS[level - 1], `half caster level ${level}`);
    assert.deepEqual(slotJson.artificer[String(level)], ARTIFICER_SLOTS[level - 1], `artificer level ${level}`);
    assert.deepEqual(
      slotJson.pact[String(level)],
      { slots: PACT_SLOTS[level - 1], slotLevel: PACT_SLOT_LEVEL[level - 1] },
      `warlock level ${level}`,
    );
  }
});

await test("every full caster has the full table at every level", () => {
  for (const classId of FULL_CASTERS) {
    for (const level of LEVELS) {
      assert.deepEqual(
        spellSlotsFor(classId, level),
        rowToTable(FULL_CASTER_SLOTS[level - 1]),
        `${classId} ${level}`,
      );
    }
  }
});

await test("paladin and ranger have no slots at 1st level and the half table after", () => {
  for (const classId of HALF_CASTERS) {
    assert.deepEqual(spellSlotsFor(classId, 1), {});
    for (const level of LEVELS) {
      assert.deepEqual(
        spellSlotsFor(classId, level),
        rowToTable(HALF_CASTER_SLOTS[level - 1]),
        `${classId} ${level}`,
      );
    }
  }
});

await test("a warlock's slots are all one level, and few", () => {
  for (const level of LEVELS) {
    assert.deepEqual(
      spellSlotsFor("warlock", level),
      { [String(PACT_SLOT_LEVEL[level - 1])]: PACT_SLOTS[level - 1] },
      `warlock ${level}`,
    );
    assert.deepEqual(pactSlotsFor(level), {
      level: PACT_SLOT_LEVEL[level - 1],
      max: PACT_SLOTS[level - 1],
    });
  }
  assert.equal(pactSlotsFor(0), null);
});

await test("the artificer has its printed table", () => {
  for (const level of LEVELS) {
    assert.deepEqual(spellSlotsFor("artificer", level), rowToTable(ARTIFICER_SLOTS[level - 1]), `artificer ${level}`);
  }
});

await test("barbarian, fighter, monk and rogue have no slots at any level", () => {
  for (const classId of NON_CASTERS) {
    for (const level of LEVELS) {
      assert.deepEqual(spellSlotsFor(classId, level), {}, `${classId} ${level}`);
    }
  }
});

await test("a level outside 1 to 20 is clamped, never extrapolated", () => {
  assert.deepEqual(spellSlotsFor("wizard", 0), rowToTable(FULL_CASTER_SLOTS[0]));
  assert.deepEqual(spellSlotsFor("wizard", 25), rowToTable(FULL_CASTER_SLOTS[19]));
  assert.deepEqual(spellSlotsFor("no-such-class", 5), {});
});

await test("the multiclass table is the full caster table by caster level", () => {
  assert.deepEqual(multiclassSlots(0), {});
  for (const level of LEVELS) {
    assert.deepEqual(multiclassSlots(level), rowToTable(FULL_CASTER_SLOTS[level - 1]), `caster level ${level}`);
  }
});

await test(
  "An Eldritch Knight or Arcane Trickster has spell slots from 3rd level, a third of a full caster's pace (4/3/3/1 at 20th).",
  () => {
    for (const [classId, subclass] of [["fighter", "Eldritch Knight"], ["rogue", "Arcane Trickster"]]) {
      for (const level of [3, 7, 13, 19, 20]) {
        assert.deepEqual(
          slotTableFor({ class: classId, subclass, level, classes: [] }),
          rowToTable(THIRD_CASTER_SLOTS[level - 1]),
          `${subclass} ${level}`,
        );
      }
    }
  },
);

// ---- what a sheet carries ----

const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
const usageRoute = await world.route("campaigns/[campaignId]/sheet/usage");

await test("a character joining at another level is handed that level's slots", async () => {
  for (const [classId, level, row] of [
    ["wizard", 9, FULL_CASTER_SLOTS[8]],
    ["paladin", 9, HALF_CASTER_SLOTS[8]],
    ["cleric", 17, FULL_CASTER_SLOTS[16]],
  ]) {
    const table = await openWorld({ status: "lobby", campaign: { startingLevel: level } });
    const ability = classId === "wizard" ? "int" : classId === "cleric" ? "wis" : "cha";
    // Built at 1st level, with a 1st level caster's slots (none for a paladin).
    const library = createCharacter(
      table.owner.id,
      1,
      heroInput({
        class: classId,
        level: 1,
        abilities: { [ability]: 16 },
        spellcasting: {
          ability,
          slots: classId === "paladin" ? {} : slotsOf(FULL_CASTER_SLOTS[0]),
          known: [],
          prepared: [],
          cantrips: [],
        },
      }),
    );
    const joined = await call(sheetRoute, "POST", table.owner, table.campaignId, {
      libraryCharacterId: library.id,
    });
    assert.equal(joined.status, 201, JSON.stringify(joined.json));
    assert.equal(joined.json.sheet.level, level);
    assert.deepEqual(joined.json.sheet.spellcasting.slots, slotsOf(row), `${classId} ${level}`);
  }
});

await test(
  "A new character's spell slots are the class table's for its level; a 1st level wizard has two 1st level slots and nothing else.",
  async () => {
    const table = await openWorld({ status: "lobby" });
    const created = await call(
      sheetRoute,
      "POST",
      table.owner,
      table.campaignId,
      heroInput({
        class: "wizard",
        level: 1,
        abilities: { int: 16 },
        portrait: PORTRAIT,
        spellcasting: {
          ability: "int",
          slots: { 1: { max: 9, used: 0 }, 9: { max: 4, used: 0 } },
          known: [],
          prepared: ["Magic Missile"],
          cantrips: ["Fire Bolt"],
        },
      }),
    );
    const stored = created.json.sheet?.spellcasting?.slots;
    assert.ok(
      created.status === 400 || JSON.stringify(stored) === JSON.stringify(slotsOf(FULL_CASTER_SLOTS[0])),
      `a level 1 wizard was stored with slots ${JSON.stringify(stored)}`,
    );
  },
);

await test(
  "Gaining a level gives the caster the next row of the slot table: a wizard reaching 6th level has 4/3/3.",
  async () => {
    const table = await openWorld();
    const hero = table.addHero(wizard(5));
    table.patch(hero.id, { xp: 14000 });
    const leveled = await call(sheetRoute, "PATCH", table.owner, table.campaignId, { level: 6, maxHp: 36 });
    assert.equal(leveled.status, 200, JSON.stringify(leveled.json));
    const stored = table.sheet(hero.id).spellcasting.slots;
    assert.deepEqual(stored, slotsOf(FULL_CASTER_SLOTS[5]), `a level 6 wizard has slots ${JSON.stringify(stored)}`);
  },
);

await test(
  "A level-up cannot hand a caster more slots than the table's row for the new level.",
  async () => {
    const table = await openWorld();
    const hero = table.addHero(wizard(5));
    table.patch(hero.id, { xp: 14000 });
    const before = table.sheet(hero.id).spellcasting;
    const leveled = await call(sheetRoute, "PATCH", table.owner, table.campaignId, {
      level: 6,
      spellcasting: { ...before, slots: { ...slotsOf(FULL_CASTER_SLOTS[5]), 9: { max: 4, used: 0 } } },
    });
    const stored = table.sheet(hero.id).spellcasting.slots;
    assert.ok(
      leveled.status === 400 || stored["9"] === undefined,
      `a level 6 wizard now has ${JSON.stringify(stored["9"])} at 9th level`,
    );
  },
);

await test("outside a level-up a player cannot write their own slots", async () => {
  const table = await openWorld();
  const hero = table.addHero(wizard(5));
  const before = table.sheet(hero.id).spellcasting;
  const patched = await call(sheetRoute, "PATCH", table.owner, table.campaignId, {
    spellcasting: { ...before, slots: { ...before.slots, 9: { max: 4, used: 0 } } },
  });
  assert.equal(patched.status, 403);
  assert.deepEqual(table.sheet(hero.id).spellcasting.slots, before.slots);
});

// ---- spending and resting ----

const mage = world.addHero(wizard(5));
const priest = world.addHero(cleric(5));
const pact = world.addHero(warlock(5));
const sorc = world.addHero(sorcerer(5));
const spend = (hero, level) => world.invoke("use_spell_slot", { characterId: hero.id, level });
const slotsNow = (hero) => world.sheet(hero.id).spellcasting.slots;

function assertInvariant(hero, label) {
  for (const [level, slot] of Object.entries(slotsNow(hero))) {
    assert.ok(Number.isInteger(slot.used), `${label}: level ${level} used is ${slot.used}`);
    assert.ok(slot.used >= 0 && slot.used <= slot.max, `${label}: level ${level} is ${slot.used}/${slot.max}`);
  }
}

await test("a slot is spent one at a time and the last one is the last one", async () => {
  for (let cast = 1; cast <= 2; cast += 1) {
    const out = await spend(mage, 3);
    assert.equal(out.ok, true, out.error);
    assert.equal(slotsNow(mage)["3"].used, cast);
  }
  const third = await spend(mage, 3);
  assert.equal(third.ok, false);
  assert.deepEqual(slotsNow(mage)["3"], { max: 2, used: 2 });
  assert.deepEqual(slotsNow(mage)["1"], { max: 4, used: 0 }, "no other level paid for it");
});

await test("a slot level the caster does not have cannot be spent", async () => {
  const before = JSON.stringify(slotsNow(mage));
  for (const level of [4, 5, 9, 0, -1, 10]) {
    const out = await spend(mage, level);
    assert.equal(out.ok, false, `level ${level} was spent`);
  }
  assert.equal(JSON.stringify(slotsNow(mage)), before);
});

await test("a counter stays inside 0..max through any run of casts and rests", async () => {
  // A fixed shuffle, so a failure reproduces.
  let seed = 7;
  const next = (below) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % below;
  };
  for (let step = 0; step < 120; step += 1) {
    const hero = [mage, priest, pact][next(3)];
    const roll = next(10);
    if (roll === 0) {
      await world.invoke("take_rest", { kind: "short" });
    } else if (roll === 1) {
      await world.invoke("pass_time", { amount: 1, unit: "days" });
      await world.invoke("take_rest", { kind: "long" });
    } else {
      await spend(hero, 1 + next(4));
    }
    for (const each of [mage, priest, pact]) {
      assertInvariant(each, `step ${step}`);
    }
  }
});

await test("a long rest brings every slot back", async () => {
  await spend(mage, 1);
  await spend(priest, 2);
  await spend(pact, 3);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  const rested = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rested.ok, true, rested.error);
  assert.deepEqual(slotsNow(mage), slotsOf(FULL_CASTER_SLOTS[4]));
  assert.deepEqual(slotsNow(priest), slotsOf(FULL_CASTER_SLOTS[4]));
  assert.deepEqual(slotsNow(pact), { 3: { max: 2, used: 0 } });
});

await test("a short rest brings back a warlock's slots and nobody else's", async () => {
  await spend(sorc, 1);
  await spend(priest, 2);
  await spend(pact, 3);
  await spend(pact, 3);
  assert.equal((await spend(pact, 3)).ok, false, "a 5th level warlock has two slots");
  const rested = await world.invoke("take_rest", { kind: "short" });
  assert.equal(rested.ok, true, rested.error);
  assert.deepEqual(slotsNow(pact), { 3: { max: 2, used: 0 } });
  assert.equal(slotsNow(sorc)["1"].used, 1);
  assert.equal(slotsNow(priest)["2"].used, 1);
});

await test("Arcane Recovery returns half the wizard's level in slot levels, once a day", async () => {
  const spentLevels = (hero) =>
    Object.entries(slotsNow(hero)).reduce((sum, [level, slot]) => sum + Number(level) * slot.used, 0);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  await spend(mage, 3);
  await spend(mage, 3);
  await world.invoke("take_rest", { kind: "short" });
  // A 5th level wizard recovers slots totalling 3 levels (5 / 2, rounded up):
  // one 3rd level slot, not both.
  assert.equal(spentLevels(mage), 3);
  await world.invoke("take_rest", { kind: "short" });
  assert.equal(spentLevels(mage), 3, "the second short rest of the day recovers nothing");
  // ODM's rule: the server picks, lowest slots first (rest-tools.ts
  // applySlotRecovery); the SRD leaves the choice to the wizard. Either way
  // the total never passes the allowance.
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  for (const level of [1, 1, 2, 2, 3, 3]) {
    await spend(mage, level);
  }
  await world.invoke("take_rest", { kind: "short" });
  const recovered = 12 - spentLevels(mage);
  assert.ok(recovered >= 1 && recovered <= 3, `recovered ${recovered} slot levels`);
  assertInvariant(mage, "after Arcane Recovery");
});

await test("Arcane Recovery never returns a slot of 6th level or higher", async () => {
  const table = await openWorld();
  const hero = table.addHero(wizard(12, { spellcasting: { prepared: ["Magic Missile"] } }));
  await table.invoke("use_spell_slot", { characterId: hero.id, level: 6 });
  await table.invoke("take_rest", { kind: "short" });
  assert.deepEqual(table.sheet(hero.id).spellcasting.slots["6"], { max: 1, used: 1 });
});

await test("a long rest takes back slots the table does not give", async () => {
  // The Font of Magic claw-back: a created slot lasts until the long rest.
  const current = world.sheet(mage.id).spellcasting;
  world.patch(mage.id, {
    spellcasting: { ...current, slots: { ...current.slots, 1: { max: 6, used: 0 }, 5: { max: 1, used: 0 } } },
  });
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  assert.deepEqual(slotsNow(mage), slotsOf(FULL_CASTER_SLOTS[4]));
});

await test("After a long rest a caster has the slots of their class and level, no fewer.", async () => {
  const table = await openWorld();
  const hero = table.addHero(wizard(5, { spellcasting: { slots: slotsOf([4, 3]) } }));
  await table.invoke("take_rest", { kind: "long" });
  const stored = table.sheet(hero.id).spellcasting.slots;
  assert.deepEqual(stored, slotsOf(FULL_CASTER_SLOTS[4]), `a rested level 5 wizard has slots ${JSON.stringify(stored)}`);
});

// ---- the player's own hand ----

await test("a player's correction of their slots is clamped to 0..max and never moves max", async () => {
  const table = await openWorld();
  const hero = table.addHero(wizard(5));
  const over = await call(usageRoute, "POST", table.owner, table.campaignId, { slots: { 1: 10, 3: 2, 7: 1 } });
  assert.equal(over.status, 200, JSON.stringify(over.json));
  assert.deepEqual(table.sheet(hero.id).spellcasting.slots, {
    1: { max: 4, used: 4 },
    2: { max: 3, used: 0 },
    3: { max: 2, used: 2 },
  });
  const negative = await call(usageRoute, "POST", table.owner, table.campaignId, { slots: { 1: -1 } });
  assert.equal(negative.status, 400);
  const max = await call(usageRoute, "POST", table.owner, table.campaignId, { slots: { 1: { max: 9, used: 0 } } });
  assert.equal(max.status, 400);
  assert.equal(table.sheet(hero.id).spellcasting.slots["1"].max, 4);
});

await test("in a fight a player cannot hand themselves slots back", async () => {
  const table = await openWorld();
  // The owner is the table's lead, who corrects; the rule is about a player.
  table.addHero(wizard(5));
  const hero = table.addHero(wizard(5));
  await table.invoke("use_spell_slot", { characterId: hero.id, level: 3 });
  await fightWithoutMap(table, [{ monster: "goblin", count: 1 }]);
  const back = await call(usageRoute, "POST", { id: hero.userId }, table.campaignId, { slots: { 3: 0 } });
  assert.equal(back.status, 409);
  assert.equal(table.sheet(hero.id).spellcasting.slots["3"].used, 1);
});

await test(
  "spent spell slots come back at a rest and no other way: a player cannot lower their own used count",
  async () => {
    const table = await openWorld();
    table.addHero(wizard(5));
    // A plain member, not the owner, who may be the table's lead.
    const player = table.addHero(cleric(5));
    for (const level of [3, 1]) {
      await table.invoke("use_spell_slot", { characterId: player.id, level });
    }
    const before = JSON.stringify(table.sheet(player.id));
    const back = await call(usageRoute, "POST", { id: player.userId }, table.campaignId, { slots: { 3: 0, 1: 0 } });
    assert.ok(back.status >= 400, `the refill answered ${back.status}`);
    assert.equal(JSON.stringify(table.sheet(player.id)), before, "the stored sheet changed");
    // The lead's correction of that same sheet is accepted.
    const corrected = await call(usageRoute, "POST", table.owner, table.campaignId, {
      characterId: player.id,
      slots: { 3: 0 },
    });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.json));
    assert.equal(table.sheet(player.id).spellcasting.slots["3"].used, 0);
    assert.equal(table.sheet(player.id).spellcasting.slots["1"].used, 1);
  },
);

await test("a character with no spellcasting has no slots to adjust", async () => {
  const table = await openWorld();
  table.addHero({ class: "fighter", level: 5 });
  const out = await call(usageRoute, "POST", table.owner, table.campaignId, { slots: { 1: 0 } });
  assert.equal(out.status, 403);
});

world.close();
finish();
