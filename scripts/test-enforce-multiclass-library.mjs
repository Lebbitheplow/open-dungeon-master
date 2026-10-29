// A multiclassed character leaving the table and coming back: saved to the
// library, taken into another campaign at the same level or a lower one, and
// edited by the lead through the scalar fields.
//
// The rules guarded here are ODM's own (docs/rules-coverage.md,
// "Multiclassing" and its "Kept simplifications"), resting on SRD 5.1:
//
// - Saving progress carries the class list and the per-class hit-die pools
//   to the library, rested: nothing spent.
// - Entering a campaign below the character's level sheds levels from the
//   LAST class taken first, and what is left is a legal character of that
//   level: features, hit dice, resources and spell slots are those of the
//   classes it still has.
// - A character made at a table keeps the class list the builder sent
//   (backlog F9), held to the table's level, each class's prerequisite and
//   the table's multiclassing setting.
// - The lead's edits to class, subclass and level fold into the FIRST class
//   (ODM's documented simplification), and the mirrors still agree.
import assert from "node:assert/strict";
import { heroInput } from "./lib/enforce-world.mjs";
import {
  SRD_MULTICLASS_SLOTS,
  assertCoherent,
  openTable,
  scores,
  slotMap,
  storedSlots,
} from "./lib/enforce-multiclass.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-multiclass-library");
const table = await openTable({ campaign: { startingLevel: 3 } });
const { world, send, hero, adopt, now, levelInto } = table;
const characters = await import("../src/lib/db/characters.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const sheetsDb = await import("../src/lib/db/sheets.ts");
const { multiclassEntryProblem } = await import("../src/lib/srd/sheet-legality.ts");

const all13 = scores({ str: 13, dex: 13, con: 10, int: 13, wis: 13, cha: 13 });
const fighterTraining = {
  saves: ["str", "con"], skills: ["athletics", "perception"], expertise: [], languages: ["Common"], tools: [],
  armor: ["light armor", "medium armor", "heavy armor", "shields"], weapons: ["simple weapons", "martial weapons"],
};
// A portrait on every created character: one without would queue a render.
const portrait = { url: "/uploads/enforce-multiclass.png" };

// A library fighter 3, brought to this table the way the lobby does it.
async function fighterFromLibrary() {
  sheetsDb.deleteSheetForUser(world.campaignId, world.owner.id);
  const stored = characters.createCharacter(
    world.owner.id,
    3,
    heroInput({ class: "fighter", level: 3, abilities: all13, maxHp: 28, proficiencies: fighterTraining, portrait }),
  );
  const joined = await send("sheet", "POST", { libraryCharacterId: stored.id });
  assert.equal(joined.status, 201, joined.error);
  // With the experience to take the levels these cases go on to take.
  adopt(world.patch(joined.sheet.id, { xp: 355000 }));
  return stored.id;
}

// The same library character entering a fresh campaign at `level`.
async function enterAt(libraryId, level) {
  const campaign = campaigns.createCampaign(world.owner.id, {
    title: `Level ${level}`, description: "", theme: "high-fantasy", maxPlayers: 6,
    startingLevel: level, difficulty: "normal", gameSettings: {},
  });
  const out = await send("sheet", "POST", { libraryCharacterId: libraryId }, { campaignId: campaign.id });
  assert.equal(out.status, 201, out.error);
  return out.sheet;
}
const classLevels = (sheet) => sheet.classes.map((entry) => [entry.id, entry.level]);
const classFeatures = (sheet) =>
  sheet.features.filter((feature) => feature.source === "class").map((feature) => feature.name).sort();

await test("saving progress carries the classes and rested pools to the library", async () => {
  const libraryId = await fighterFromLibrary();
  await levelInto("wizard", 1, { levelUpSpells: ["Magic Missile", "Shield", "Sleep"] });
  await levelInto("wizard", 3);
  await levelInto("rogue", 2);
  await send("usage", "POST", { hitDiceSpent: 4, slots: { 1: 2, 2: 1 } });
  assert.equal(now().hitDice.spent, 4);
  const synced = await send("sync", "POST", {});
  assert.equal(synced.status, 200, synced.error);
  const stored = characters.getCharacter(libraryId);
  assert.equal(stored.level, 9);
  assert.deepEqual(classLevels(stored.sheet), [["fighter", 3], ["wizard", 4], ["rogue", 2]]);
  assert.deepEqual(
    stored.sheet.hitDicePools,
    [
      { classId: "fighter", die: "d10", total: 3, spent: 0 },
      { classId: "wizard", die: "d6", total: 4, spent: 0 },
      { classId: "rogue", die: "d8", total: 2, spent: 0 },
    ],
  );
  for (const slot of Object.values(stored.sheet.spellcasting.slots)) {
    assert.equal(slot.used, 0);
  }

  // Back at the same level it is the character that left.
  const back = await enterAt(libraryId, 9);
  assert.deepEqual(classLevels(back), [["fighter", 3], ["wizard", 4], ["rogue", 2]]);
  assert.deepEqual(classFeatures(back), classFeatures(now()));
  assert.deepEqual(Object.keys(back.resources).sort(), Object.keys(now().resources).sort());
  assert.deepEqual(storedSlots(back), slotMap(SRD_MULTICLASS_SLOTS[3]));
  assertCoherent(back, "back at 9");

  // Below it, the last class taken goes first.
  for (const [level, expected] of [
    [8, [["fighter", 3], ["wizard", 4], ["rogue", 1]]],
    [7, [["fighter", 3], ["wizard", 4]]],
    [5, [["fighter", 3], ["wizard", 2]]],
    [4, [["fighter", 3], ["wizard", 1]]],
  ]) {
    const lower = await enterAt(libraryId, level);
    assert.equal(lower.level, level);
    assert.deepEqual(classLevels(lower), expected, `at ${level}`);
    assertCoherent(lower, `at ${level}`);
    const held = new Set(expected.map(([id]) => id));
    for (const feature of lower.features.filter((entry) => entry.source === "class")) {
      assert.ok(held.has(feature.classId), `at ${level}: ${feature.name} belongs to ${feature.classId}`);
    }
    assert.equal("Sneak Attack" in Object.fromEntries(lower.features.map((f) => [f.name, 1])), held.has("rogue"));
    // One Spellcasting class left: the wizard's own table at its level.
    const wizardLevel = expected[1][1];
    assert.deepEqual(storedSlots(lower), slotMap(SRD_MULTICLASS_SLOTS[wizardLevel - 1]), `at ${level}`);
    assert.equal(lower.spellcasting.pact, undefined);
  }

  // The library itself never drops a level for it.
  assert.equal(characters.getCharacter(libraryId).level, 9);
});

await test("stripped to one class it is a single-classed character again", async () => {
  const libraryId = await fighterFromLibrary();
  await levelInto("rogue", 2, { levelUpSkill: "stealth" });
  await send("sync", "POST", {});
  for (const level of [3, 2, 1]) {
    const lower = await enterAt(libraryId, level);
    assert.equal(lower.level, level);
    assert.equal(lower.class, "fighter");
    assert.deepEqual(lower.classes, []);
    assert.equal(lower.hitDicePools, null);
    assert.deepEqual(lower.hitDice, { die: "d10", total: level, spent: 0 });
    for (const name of ["Sneak Attack", "Cunning Action", "Expertise", "Thieves' Cant"]) {
      assert.ok(!lower.features.some((feature) => feature.name === name), `fighter ${level} holds ${name}`);
    }
    assert.equal(lower.features.some((feature) => feature.name === "Action Surge (1 use)"), level >= 2);
    assertCoherent(lower, `fighter ${level}`);
  }
});

await test("a table below the character's level saves gear and leaves the classes alone", async () => {
  const libraryId = await fighterFromLibrary();
  await levelInto("rogue", 3);
  await send("sync", "POST", {});
  const campaign = campaigns.createCampaign(world.owner.id, {
    title: "Low", description: "", theme: "high-fantasy", maxPlayers: 6,
    startingLevel: 4, difficulty: "normal", gameSettings: {},
  });
  const low = await send("sheet", "POST", { libraryCharacterId: libraryId }, { campaignId: campaign.id });
  assert.deepEqual(classLevels(low.sheet), [["fighter", 3], ["rogue", 1]]);
  world.patch(low.sheet.id, { gold: 77 });
  const synced = await send("sync", "POST", {}, { campaignId: campaign.id });
  assert.equal(synced.status, 200, synced.error);
  const stored = characters.getCharacter(libraryId);
  assert.equal(stored.level, 6);
  assert.deepEqual(classLevels(stored.sheet), [["fighter", 3], ["rogue", 3]]);
  assert.equal(stored.sheet.gold, 77);
});

// ODM's documented simplification: the lead edits a multiclass sheet
// through the scalar fields, and they land on the first class.
await test("the lead's scalar edits fold into the first class and the mirrors agree", async () => {
  hero({ class: "rogue", level: 5, abilities: all13 });
  await levelInto("fighter", 3);
  const edit = (patch) =>
    world.invoke("update_sheet", { characterId: now().id, reason: "test", ...patch });
  let out = await edit({ subclass: "Thief" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(now().classes.map((entry) => entry.subclass), ["Thief", ""]);
  assert.equal(now().subclass, "Thief");
  out = await edit({ level: 9 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(classLevels(now()), [["rogue", 6], ["fighter", 3]]);
  assert.equal(now().level, 9);
  // Two levels at once is refused for the lead as for anyone.
  out = await edit({ level: 11 });
  assert.equal(out.ok, false);
  assert.equal(now().level, 9);
});

// ---- made multiclass (backlog F9) ----

// A fighter 2 / rogue 1, as the builder sends one, at a level 3 table.
const splitInput = (overrides = {}) =>
  heroInput({
    name: "Split", class: "fighter", level: 3, portrait,
    abilities: scores({ str: 15, dex: 13, con: 12 }),
    proficiencies: {
      ...fighterTraining,
      skills: ["athletics", "perception", "stealth"],
      expertise: [],
      armor: [...fighterTraining.armor],
      tools: ["thieves' tools"],
    },
    classes: [{ id: "fighter", subclass: "", level: 2 }, { id: "rogue", subclass: "", level: 1 }],
    ...overrides,
  });

await test("a character made at a table keeps the class list it was built with", async () => {
  sheetsDb.deleteSheetForUser(world.campaignId, world.owner.id);
  const out = await send("sheet", "POST", splitInput());
  assert.ok(out.status < 400, `the split was refused: ${JSON.stringify(out.body.problems ?? out.error)}`);
  assert.deepEqual(classLevels(out.sheet), [["fighter", 2], ["rogue", 1]]);
  assert.deepEqual(
    (out.sheet.hitDicePools ?? []).map((pool) => [pool.classId, pool.die, pool.total]),
    [["fighter", "d10", 2], ["rogue", "d8", 1]],
  );
  assertCoherent(out.sheet);
});

await test("a class list made at a table is held to the table's level", async () => {
  sheetsDb.deleteSheetForUser(world.campaignId, world.owner.id);
  const out = await send("sheet", "POST", heroInput({
    name: "Forged", class: "fighter", level: 3, portrait, abilities: scores(),
    classes: [{ id: "fighter", subclass: "Champion", level: 11 }, { id: "wizard", subclass: "", level: 9 }],
  }));
  assert.ok(out.status >= 400, `a level 3 table took ${JSON.stringify(out.sheet && classLevels(out.sheet))}`);
  assert.match(JSON.stringify(out.body.problems), /add up to 20/);
});

await test("a second class made at a table meets its prerequisite", async () => {
  sheetsDb.deleteSheetForUser(world.campaignId, world.owner.id);
  const out = await send("sheet", "POST", splitInput({ abilities: scores({ str: 15, dex: 10, con: 12 }) }));
  assert.ok(out.status >= 400, "a rogue level was made with Dexterity 10");
  assert.match(JSON.stringify(out.body.problems), /Holding levels in Rogue/);
});

await test("a table that turns multiclassing off makes one class", async () => {
  const off = campaigns.createCampaign(world.owner.id, {
    title: "Single", description: "", theme: "high-fantasy", maxPlayers: 6,
    startingLevel: 3, difficulty: "normal", gameSettings: { multiclassingEnabled: false },
  });
  const out = await send("sheet", "POST", splitInput(), { campaignId: off.id });
  assert.ok(out.status >= 400, `a table with multiclassing off took ${JSON.stringify(out.sheet && classLevels(out.sheet))}`);
  assert.match(JSON.stringify(out.body.problems), /turns multiclassing off/);
});

// A level 3 table that turns multiclassing off, and the owner's split
// fighter 2 / rogue 1 kept in the library, for the cases below.
function tableWithout(gameSettings = { multiclassingEnabled: false }) {
  return campaigns.createCampaign(world.owner.id, {
    title: "One Path", description: "", theme: "high-fantasy", maxPlayers: 6,
    startingLevel: 3, difficulty: "normal", gameSettings,
  });
}
const splitInLibrary = () => characters.createCharacter(world.owner.id, 3, splitInput());
// A table where the split sat down while multiclassing was allowed, then
// the GM turned it off: the seat keeps the classes it holds.
async function seatedThenTurnedOff(stored) {
  const table = tableWithout({});
  const joined = await send("sheet", "POST", { libraryCharacterId: stored.id }, { campaignId: table.id });
  assert.equal(joined.status, 201, joined.error);
  assert.deepEqual(classLevels(joined.sheet), [["fighter", 2], ["rogue", 1]]);
  campaigns.updateGameSettings(table.id, { multiclassingEnabled: false });
  return table;
}
const REFUSED = /holds levels in more than one class, and this table turns multiclassing off\. Bring a character with one class, or build one here\./;

await test("a split hero is not let in at a table that turns multiclassing off", async () => {
  // SRD 5.1: multiclassing is an optional rule the table decides on.
  const off = tableWithout();
  const stored = splitInLibrary();
  const out = await send("preview", "POST", { libraryCharacterId: stored.id }, { campaignId: off.id });
  assert.equal(out.status, 200, out.error);
  assert.equal(out.body.preview.ok, false, "the confirm sheet let the split in");
  assert.match(JSON.stringify(out.body.preview.problems), REFUSED);
  const joined = await send("sheet", "POST", { libraryCharacterId: stored.id }, { campaignId: off.id });
  assert.ok(joined.status >= 400, `the split took a seat: ${JSON.stringify(joined.sheet && classLevels(joined.sheet))}`);
  assert.match(JSON.stringify(joined.body), REFUSED);
  // At a table that allows it, the same hero comes in.
  const on = tableWithout({});
  const there = await send("preview", "POST", { libraryCharacterId: stored.id }, { campaignId: on.id });
  assert.equal(there.body.preview.ok, true, JSON.stringify(there.body.preview.problems));
  // A single-class hero comes in at the table without it.
  const single = characters.createCharacter(world.owner.id, 3, heroInput({ class: "fighter", level: 3, abilities: all13, maxHp: 28, proficiencies: fighterTraining, portrait }));
  const plain = await send("preview", "POST", { libraryCharacterId: single.id }, { campaignId: off.id });
  assert.equal(plain.body.preview.ok, true, JSON.stringify(plain.body.preview.problems));
  // A table low enough to strip the split to one class takes it as that.
  const low = campaigns.createCampaign(world.owner.id, {
    title: "Low Path", description: "", theme: "high-fantasy", maxPlayers: 6,
    startingLevel: 2, difficulty: "normal", gameSettings: { multiclassingEnabled: false },
  });
  const stripped = await send("preview", "POST", { libraryCharacterId: stored.id }, { campaignId: low.id });
  assert.equal(stripped.body.preview.ok, true, JSON.stringify(stripped.body.preview.problems));
});

await test("the rule holds the door alone, and a seat keeps what it holds", () => {
  assert.equal(multiclassEntryProblem("Ash", [{ id: "fighter" }], false), null, "one class");
  assert.equal(multiclassEntryProblem("Ash", [{ id: "fighter" }, { id: "rogue" }], true), null, "the table allows it");
  assert.match(multiclassEntryProblem("Ash", [{ id: "fighter" }, { id: "rogue" }], false), /^Ash holds levels in more than one class/);
  assert.equal(multiclassEntryProblem("Ash", [{ id: "fighter" }, { id: "rogue" }], false, [{ id: "Fighter" }, { id: "rogue" }]), null, "the seat holds both");
  assert.match(multiclassEntryProblem("Ash", [{ id: "fighter" }, { id: "rogue" }], false, [{ id: "fighter" }]), /turns multiclassing off/, "the seat holds one");
});

await test("a seated split is rebuilt with the same classes once the table turns multiclassing off, and no new class", async () => {
  const off = await seatedThenTurnedOff(splitInLibrary());
  // The rebuild (PUT, a brand-new sheet) keeps the split it holds.
  const rebuilt = await send("sheet", "PUT", splitInput({ name: "Split Again" }), { campaignId: off.id });
  assert.ok(rebuilt.status < 400, `the same split was refused: ${JSON.stringify(rebuilt.body.problems ?? rebuilt.error)}`);
  assert.deepEqual(classLevels(rebuilt.sheet), [["fighter", 2], ["rogue", 1]]);
  // A class the seat does not hold is refused there.
  const wider = await send(
    "sheet",
    "PUT",
    splitInput({
      abilities: all13,
      classes: [{ id: "fighter", subclass: "", level: 1 }, { id: "rogue", subclass: "", level: 1 }, { id: "wizard", subclass: "", level: 1 }],
    }),
    { campaignId: off.id },
  );
  assert.ok(wider.status >= 400, `a wizard was added at a table without multiclassing: ${JSON.stringify(wider.sheet && classLevels(wider.sheet))}`);
  assert.match(JSON.stringify(wider.body.problems), /turns multiclassing off/);
  // A new character made there is still held to one class.
  sheetsDb.deleteSheetForUser(off.id, world.owner.id);
  const made = await send("sheet", "POST", splitInput(), { campaignId: off.id });
  assert.ok(made.status >= 400, "a new split was made at a table without multiclassing");
  assert.match(JSON.stringify(made.body.problems), /turns multiclassing off/);
});

await test("an in-place edit once the table turns multiclassing off keeps the split and takes no new class", async () => {
  const stored = splitInLibrary();
  const off = await seatedThenTurnedOff(stored);
  // The edit (PUT with the library id) keeps the classes it holds.
  const kept = await send("sheet", "PUT", { editLibraryCharacterId: stored.id, sheet: splitInput({ name: "Split Edited" }) }, { campaignId: off.id });
  assert.ok(kept.status < 400, `the edit was refused: ${JSON.stringify(kept.body.problems ?? kept.error)}`);
  assert.deepEqual(classLevels(kept.sheet), [["fighter", 2], ["rogue", 1]]);
  // A wizard level added through the edit is refused there.
  const wider = await send(
    "sheet",
    "PUT",
    {
      editLibraryCharacterId: stored.id,
      sheet: splitInput({
        abilities: all13,
        classes: [{ id: "fighter", subclass: "", level: 1 }, { id: "rogue", subclass: "", level: 1 }, { id: "wizard", subclass: "", level: 1 }],
      }),
    },
    { campaignId: off.id },
  );
  assert.ok(wider.status >= 400, `a wizard was added by an edit at a table without multiclassing: ${JSON.stringify(wider.sheet && classLevels(wider.sheet))}`);
  assert.match(JSON.stringify(wider.body.problems), /turns multiclassing off/);
});

// ---- not enforced today ----

await test(
  "A character stripped of its only spellcasting class has that class's spell slots no longer.",
  async () => {
    const libraryId = await fighterFromLibrary();
    await levelInto("wizard", 1, { levelUpSpells: ["Magic Missile", "Shield"] });
    await levelInto("wizard", 3);
    await send("sync", "POST", {});
    const lower = await enterAt(libraryId, 3);
    assert.deepEqual(classLevels(lower), []);
    assert.deepEqual(storedSlots(lower), {}, `a fighter 3 holds slots ${JSON.stringify(storedSlots(lower))}`);
  },
);

await test(
  "Hit points come from each class's own hit die: a fighter 3 / wizard 2 with Constitution 10 has 10 + 6 + 6 + 4 + 4 = 30 on fixed values.",
  async () => {
    const libraryId = await fighterFromLibrary();
    await levelInto("wizard", 4);
    await send("sync", "POST", {});
    const lower = await enterAt(libraryId, 5);
    assert.deepEqual(classLevels(lower), [["fighter", 3], ["wizard", 2]]);
    assert.equal(lower.maxHp, 30, `a fighter 3 / wizard 2 has ${lower.maxHp} hit points, a fighter 5's`);
  },
);

await test(
  "The proficiencies a second class granted are part of the character and return with it.",
  async () => {
    const libraryId = await fighterFromLibrary();
    await levelInto("rogue", 1, { levelUpSkill: "stealth" });
    assert.ok(now().proficiencies.tools.includes("thieves' tools"));
    await send("sync", "POST", {});
    const back = await enterAt(libraryId, 4);
    assert.deepEqual(classLevels(back), [["fighter", 3], ["rogue", 1]]);
    assert.deepEqual(
      [back.proficiencies.tools, back.proficiencies.skills],
      [now().proficiencies.tools, now().proficiencies.skills],
      "the rogue's tools and skill did not come back",
    );
  },
);

await test(
  "A character has one hit die per level, of the class each level was taken in.",
  async () => {
    hero({ class: "rogue", level: 5, abilities: all13 });
    await levelInto("fighter", 3);
    const out = await world.invoke("update_sheet", {
      characterId: now().id, field: "level", value: "9", level: 9, reason: "test",
    });
    assert.equal(out.ok, true, out.error);
    assertCoherent(now(), "after the lead's level");
  },
);

await test(
  "A character holds each class once.",
  async () => {
    hero({ class: "rogue", level: 5, abilities: all13 });
    await levelInto("fighter", 3);
    await world.invoke("update_sheet", {
      characterId: now().id, field: "class", value: "fighter", class: "fighter", reason: "test",
    });
    assertCoherent(now(), "after the lead's class");
  },
);

world.close();
finish();
