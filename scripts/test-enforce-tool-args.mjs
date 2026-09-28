// The AI DM's door into the engine, tried with arguments no honest caller
// sends.
//
// The model reaches the rules through tool calls whose arguments arrive as a
// raw JSON string (src/lib/dm/invoke-dispatch.ts dispatchAdjudication), and a
// person reaches the same handlers through the console (src/lib/dm/invoke.ts
// invokeEngine). mutations.ts states the contract: "Never throws: errors come
// back as {error} results", and every mutation is "server-clamped".
//
// The rules held:
//   for every tool in MUTATION_TOOL_NAMES and ENCOUNTER_TOOL_NAMES, arguments
//   that are not JSON, not an object, of the wrong types, or that name a
//   character or an enemy of ANOTHER campaign are refused without a throw,
//   and both tables are byte for byte what they were;
//   an amount is a whole number inside the bounds the tool declares to the
//   model;
//   a key the tool does not take changes nothing;
//   update_sheet writes the fields its schema names, inside the ceiling
//   mutation-math.ts sheetBuffViolation sets, and no engine-owned field;
//   the agent program's bridge (src/lib/harness/bridge.ts) hands over only
//   the tools the turn allows, and the MCP door opens to a known token only.
//
// ODM's rule pinned here: end_encounter takes any outcome, even unreadable
// arguments, and ends the fight (encounter-tools.ts: "a rejected
// end_encounter used to leave the fight stuck open while the narration
// declared it over").
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-tool-args");
const { MUTATION_TOOL_NAMES, mutationTools } = await import("../src/lib/dm/mutations.ts");
const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
const { ENCOUNTER_TOOL_NAMES } = await import("../src/lib/dm/encounter-tools.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { BridgeSession, bridgeSessionForToken, NARRATE_NOW } = await import("../src/lib/harness/bridge.ts");
const { handleMcpRequest } = await import("../src/lib/agents/mcp-server.ts");

const WIZARD = {
  class: "wizard",
  level: 3,
  gold: 10,
  abilities: { int: 16 },
  equipment: [{ name: "Rope", qty: 2 }],
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } },
    prepared: ["Magic Missile"],
    known: [],
    cantrips: ["Fire Bolt"],
    spellbook: ["Magic Missile"],
  },
};

// A fight whose tokens stand nowhere: start_encounter places them at random,
// and nothing here may turn on where.
async function fight(world) {
  const encounter = await world.beginFight([{ monster: "goblin", count: 1 }]);
  const db = getDatabase();
  db.prepare("DELETE FROM battle_tokens WHERE map_id IN (SELECT id FROM battle_maps WHERE encounter_id = ?)").run(encounter.id);
  db.prepare("DELETE FROM battle_maps WHERE encounter_id = ?").run(encounter.id);
  db.prepare("UPDATE encounter_enemies SET max_hp = 60, current_hp = 60 WHERE encounter_id = ?").run(encounter.id);
  return world.enemies()[0];
}

const here = await openWorld();
const hero = here.addHero({ ...WIZARD, name: "Mage" });
const fighter = here.addHero({ class: "fighter", level: 3, name: "Sword", gold: 10 });
const there = await openWorld();
const foreign = there.addHero({ ...WIZARD, name: "Foreigner" });
const enemy = await fight(here);
const foe = await fight(there);

const tableOf = (world) => ({
  sheets: world.sheets().map((sheet) => Object.fromEntries(Object.entries(sheet).filter(([key]) => key !== "updatedAt"))),
  encounter: world.encounter(),
  enemies: world.enemies(),
});
const state = () => JSON.stringify([tableOf(here), tableOf(there)]);

// The call as the model's turn loop makes it: a name and a raw string.
async function raw(name, text, world = here) {
  const sheets = listSheets(world.campaignId);
  let result;
  try {
    result = await dispatchAdjudication(name, text, {
      campaign: world.campaign(),
      turn: createDmTurn(world.campaignId, [], "human_dm"),
      sheets,
      sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])),
      realDiceUserIds: new Set(),
    });
  } catch (error) {
    assert.fail(`${name} threw on ${String(text).slice(0, 60)}: ${error.message}`);
  }
  world.clearDice();
  return result;
}
const sent = (name, args, world) => raw(name, JSON.stringify(args), world);

// Arguments that are wrong for every tool there is.
const BROKEN = {
  "not JSON": "{not json",
  "half an object": '{"characterId": "',
  "an array": "[]",
  "null": "null",
  "a number": "42",
  "a string": '"apply_damage"',
  "wrong types": JSON.stringify({
    characterId: 42, characterIds: "everyone", enemyId: { id: 1 }, targetEnemyId: [], enemyIds: 7,
    amount: "many", delta: "lots", level: "high", qty: "some", name: 7, spell: 9, condition: [],
    item: {}, resource: 3, x: "left", y: "up", enemies: 5, action: 1, kind: 2, weapon: 3,
  }),
  "ids of another table": JSON.stringify({
    characterId: foreign.id, characterIds: [foreign.id], targetCharacterId: foreign.id, casterId: foreign.id,
    enemyId: foe.id, targetEnemyId: foe.id, enemyIds: [foe.id], attackerId: foe.id,
    amount: 5, delta: 5, name: "Rope", item: "Rope", condition: "poisoned", level: 1,
    spell: "Magic Missile", resource: "arcane_recovery", action: "add", weapon: "Dagger",
    x: 1, y: 1, feet: 5, saveAbility: "dex", damage: "1d4", reason: "crossed",
  }),
};

const ALWAYS_ENDABLE = "end_encounter";
const TOOLS = [...MUTATION_TOOL_NAMES, ...ENCOUNTER_TOOL_NAMES];

await test("the two tool lists are the ones this suite walks", () => {
  assert.equal(new Set(TOOLS).size, TOOLS.length, "a tool is on both lists");
  for (const name of ["apply_damage", "update_sheet", "start_encounter", "pc_attack", "damage_enemy", "end_turn"]) {
    assert.ok(TOOLS.includes(name), name);
  }
});

await test("every tool refuses broken arguments, mid fight, and changes nothing", async () => {
  const before = state();
  for (const name of TOOLS.filter((tool) => tool !== ALWAYS_ENDABLE)) {
    for (const [label, text] of Object.entries(BROKEN)) {
      const result = await raw(name, text);
      assert.equal(typeof result?.error, "string", `${name} took ${label}: ${JSON.stringify(result).slice(0, 160)}`);
      assert.equal(state(), before, `${name} changed state on ${label}`);
    }
  }
});

await test("every tool refuses broken arguments at a table with no fight running", async () => {
  const quiet = await openWorld();
  quiet.addHero({ ...WIZARD, name: "Alone" });
  const view = () => JSON.stringify(tableOf(quiet));
  const before = view();
  for (const name of TOOLS) {
    for (const [label, text] of Object.entries(BROKEN)) {
      const result = await raw(name, text, quiet);
      assert.equal(typeof result?.error, "string", `${name} took ${label}: ${JSON.stringify(result).slice(0, 160)}`);
      assert.equal(view(), before, `${name} changed state on ${label}`);
    }
  }
  assert.equal(quiet.encounter(), null);
});

await test("a name the engine does not know is refused by both doors", async () => {
  const before = state();
  for (const name of ["", "grant_wish", "applyDamage", "APPLY_DAMAGE", "__proto__", "constructor"]) {
    const result = await sent(name, { characterId: hero.id, amount: 5 });
    assert.equal(typeof result.error, "string", name);
    const viaConsole = await here.invoke(name, { characterId: hero.id, amount: 5 });
    assert.equal(viaConsole.ok, false, name);
  }
  assert.equal(state(), before);
});

await test("an amount is a whole number inside the tool's bounds", async () => {
  const before = state();
  const refused = [
    ["apply_damage", { characterId: hero.id, amount: 0 }],
    ["apply_damage", { characterId: hero.id, amount: -5 }],
    ["apply_damage", { characterId: hero.id, amount: 2.5 }],
    ["heal", { characterId: hero.id, amount: -5 }],
    ["heal", { characterId: hero.id, amount: 0 }],
    ["award_xp", { characterIds: [hero.id], amount: 0 }],
    ["award_xp", { characterIds: [hero.id], amount: -5 }],
    ["award_xp", { characterIds: [hero.id], amount: 20001 }],
    ["party_award", { characterIds: [hero.id], amount: 1000000 }],
    ["party_award", { characterIds: [hero.id] }],
    ["modify_gold", { characterId: hero.id, delta: 0.5 }],
    ["purchase", { characterId: hero.id, item: "Rope", price: -5, action: "buy" }],
    ["purchase", { characterId: hero.id, item: "Rope", price: 100001, action: "sell" }],
    ["set_condition", { characterId: hero.id, condition: "poisoned", rounds: 0 }],
    ["set_condition", { characterId: hero.id, condition: "poisoned", rounds: -1 }],
    ["set_condition", { characterId: hero.id, condition: "poisoned", rounds: 101 }],
    ["set_condition", { characterId: hero.id, condition: "poisoned", saveAbility: "con", saveDc: 31 }],
    ["set_condition", { characterId: hero.id, condition: "poisoned", hours: 25 }],
    ["use_spell_slot", { characterId: hero.id, level: 0, spell: "Magic Missile" }],
    ["use_spell_slot", { characterId: hero.id, level: -1, spell: "Magic Missile" }],
    ["use_spell_slot", { characterId: hero.id, level: 10, spell: "Magic Missile" }],
    ["use_spell_slot", { characterId: hero.id, level: 1.5, spell: "Magic Missile" }],
    ["damage_enemy", { enemyId: enemy.id, amount: 0 }],
    ["damage_enemy", { enemyId: enemy.id, amount: -5 }],
    ["damage_enemy", { enemyId: enemy.id, amount: 2.5 }],
    ["damage_enemy", { enemyId: enemy.id, amount: 1000000 }],
  ];
  for (const [name, args] of refused) {
    const result = await sent(name, args);
    assert.equal(typeof result.error, "string", `${name} ${JSON.stringify(args)}: ${JSON.stringify(result)}`);
    assert.equal(state(), before, `${name} ${JSON.stringify(args)}`);
  }
});

await test("a key the tool does not take changes nothing", async () => {
  const before = here.sheet(fighter.id);
  const extras = JSON.stringify({
    characterId: fighter.id, amount: 4, reason: "a trap",
    currentHp: 999, maxHp: 999, level: 20, gold: 5000, xp: 9999, resources: {}, userId: hero.userId,
  });
  // Written into the text, since an object literal would not carry the key.
  const result = await raw("apply_damage", `${extras.slice(0, -1)},"__proto__":{"amount":1,"crit":true}}`);
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = here.sheet(fighter.id);
  assert.equal(after.currentHp, before.currentHp - 4);
  const rest = (sheet) =>
    JSON.stringify(Object.fromEntries(Object.entries(sheet).filter(([key]) => key !== "currentHp" && key !== "updatedAt")));
  assert.equal(rest(after), rest(before));
  here.patch(fighter.id, { currentHp: before.currentHp });
});

await test("a fight can always be ended, whatever the arguments say", async () => {
  // ODM's rule, stated in encounter-tools.ts above endArgsSchema.
  const table = await openWorld();
  table.addHero({ name: "Lone" });
  for (const text of ["{not json", JSON.stringify({ outcome: 7 }), JSON.stringify({ outcome: "who knows" })]) {
    await fight(table);
    const result = await raw("end_encounter", text, table);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(table.encounter(), null);
  }
});

// ---- the bounds a tool declares ----

await test("modify_gold and party_award move at most 100,000 gp in one call: the bound both tools declare to the model, beside update_sheet's ceiling of 1,000 gp and award_xp's of 20,000 XP.", async () => {
  const before = here.sheet(hero.id).gold;
  await sent("modify_gold", { characterId: hero.id, delta: 1000000000000, reason: "a generous dragon" });
  await sent("party_award", { characterIds: [hero.id], delta: 1000000000000, reason: "and another" });
  const after = here.sheet(hero.id).gold;
  here.patch(hero.id, { gold: before });
  assert.ok(after - before <= 200000, `${after - before} gp in two calls`);
});

await test("grant_item and remove_item take a quantity from 1 to 99, the bound both declare to the model; any other number is refused.", async () => {
  const before = here.sheet(hero.id).equipment;
  const huge = await sent("grant_item", { characterId: hero.id, name: "Rope", qty: 1000000 });
  const negative = await sent("grant_item", { characterId: hero.id, name: "Rope", qty: -3 });
  const taken = await sent("remove_item", { characterId: hero.id, name: "Rope", qty: 0 });
  const held = here.sheet(hero.id).equipment.find((item) => item.name === "Rope")?.qty;
  here.patch(hero.id, { equipment: before });
  assert.equal(typeof huge.error, "string", `a million ropes granted; the pack holds ${held}`);
  assert.equal(typeof negative.error, "string", "a quantity of -3 granted one");
  assert.equal(typeof taken.error, "string", "a quantity of 0 removed one");
});

await test("a pack holds 60 rows and a row 999 of a thing, however the grants are split", async () => {
  const before = here.sheet(hero.id).equipment;
  try {
    here.patch(hero.id, { equipment: [{ name: "Arrow", qty: 950 }] });
    assert.equal(typeof (await sent("grant_item", { characterId: hero.id, name: "Arrow", qty: 50 })).error, "string");
    assert.equal((await sent("grant_item", { characterId: hero.id, name: "Arrow", qty: 49 })).ok, true);
    assert.equal(here.sheet(hero.id).equipment[0].qty, 999);
    assert.equal(
      typeof (await sent("purchase", { characterId: hero.id, item: "Arrow", price: 0, qty: 1, action: "buy" })).error,
      "string",
    );
    here.patch(hero.id, {
      equipment: Array.from({ length: 60 }, (_, index) => ({ name: `Trinket ${index + 1}`, qty: 1 })),
    });
    assert.equal(typeof (await sent("grant_item", { characterId: hero.id, name: "One more", qty: 1 })).error, "string");
    // More of what is already carried needs no new row.
    assert.equal((await sent("grant_item", { characterId: hero.id, name: "Trinket 7", qty: 2 })).ok, true);
    assert.equal(here.sheet(hero.id).equipment.length, 60);
  } finally {
    here.patch(hero.id, { equipment: before });
  }
});

await test("gold moves inside the purse's own ceiling, in coins as in gold pieces", async () => {
  const before = here.sheet(hero.id);
  try {
    here.patch(hero.id, { gold: 950000, copper: 0 });
    assert.equal(typeof (await sent("modify_gold", { characterId: hero.id, delta: 60000 })).error, "string");
    assert.equal(typeof (await sent("modify_gold", { characterId: hero.id, delta: 1, coins: "20000000 sp" })).error, "string");
    assert.equal(here.sheet(hero.id).gold, 950000);
    assert.equal((await sent("modify_gold", { characterId: hero.id, delta: 50000 })).ok, true);
    assert.equal(here.sheet(hero.id).gold, 1000000);
    assert.equal((await sent("modify_gold", { characterId: hero.id, delta: -100000 })).ok, true);
    assert.equal(here.sheet(hero.id).gold, 900000);
    // A refused purse leaves the experience that came with it unawarded.
    const xp = here.sheet(hero.id).xp;
    const spoils = await sent("party_award", { characterIds: [hero.id], amount: 50, delta: 100001 });
    assert.equal(typeof spoils.error, "string");
    assert.equal(here.sheet(hero.id).xp, xp);
  } finally {
    here.patch(hero.id, { gold: before.gold, copper: before.copper });
  }
});

// ---- update_sheet ----
// ---- update_sheet ----

await test("update_sheet keeps the sheet's bounds and its own ceiling", async () => {
  const before = state();
  const refused = [
    { level: 21 }, { level: 0 }, { level: 1.5 }, { level: "4" },
    { maxHp: 0 }, { maxHp: 501 }, { currentHp: -1 }, { tempHp: 201 },
    { ac: 0 }, { ac: 31 }, { speed: -5 }, { speed: 121 },
    { gold: -1 }, { xp: -1 },
    { abilities: { str: 31, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    { abilities: { str: 0, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    { abilities: { str: 12 } },
    { name: "" },
    // The ceiling: one level, a modest hit point gain, 1,000 gp, scores to 20.
    { level: 5 },
    { xp: 6500 },
    { maxHp: 30 + 12 * 3 + 1 },
    { gold: 1011 },
    { abilities: { str: 21, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
  ];
  for (const fields of refused) {
    const result = await sent("update_sheet", { characterId: fighter.id, reason: "asked nicely", ...fields });
    assert.equal(typeof result.error, "string", `${JSON.stringify(fields)}: ${JSON.stringify(result)}`);
    assert.equal(state(), before, JSON.stringify(fields));
  }
});

await test("update_sheet writes no field the engine owns", async () => {
  const before = state();
  const owned = {
    resources: { second_wind: { max: 9, used: 0 } },
    deathSaves: { successes: 3, failures: 0, stable: true, dead: false },
    equipment: [{ name: "Vorpal Sword", qty: 1 }],
    spellcasting: WIZARD.spellcasting,
    exhaustion: 0,
    concentratingOn: "Haste",
    hitDice: { die: "d12", total: 20, spent: 0 },
    classes: [{ id: "wizard", subclass: "", level: 20 }],
    proficiencies: { saves: ["str", "dex", "con", "int", "wis", "cha"] },
    acOverride: true,
    notes: "written by the DM",
    id: "another", userId: hero.userId, campaignId: there.campaignId, isCompanion: true,
  };
  const alone = await sent("update_sheet", { characterId: fighter.id, reason: "a wish", ...owned });
  assert.equal(typeof alone.error, "string", JSON.stringify(alone));
  assert.equal(state(), before);

  const beside = await sent("update_sheet", { characterId: fighter.id, reason: "a wish", alignment: "LG", ...owned });
  assert.deepEqual(beside.changed, ["alignment"], JSON.stringify(beside));
  const after = here.sheet(fighter.id);
  assert.equal(after.alignment, "LG");
  here.patch(fighter.id, { alignment: "" });
  assert.equal(state(), before);
});

await test(
  "The DM console's Correct a sheet changes the field it names to the value it is given, as a named field or as the sheet's own key.",
  async () => {
    const before = here.sheet(fighter.id);
    const typed = await here.invoke("update_sheet", {
      characterId: fighter.id, field: "alignment", value: "LG", reason: "a change of heart",
    });
    const keyed = await here.invoke("update_sheet", {
      characterId: fighter.id, alignment: "LG", reason: "a change of heart",
    });
    const after = here.sheet(fighter.id);
    here.patch(fighter.id, { alignment: before.alignment });
    assert.equal(after.alignment, "LG", `the form answered "${typed.error}", the keys answered "${keyed.error}"`);
  },
);

await test("a console form sends the arguments its tool takes, under the names the handler reads", async () => {
  const drift = [];
  for (const name of MUTATION_TOOL_NAMES.filter((tool) => tool !== "update_sheet")) {
    const parameters = mutationTools.find((tool) => tool.function.name === name).function.parameters;
    const fields = adjudication(name).fields.map((field) => field.name);
    const unread = fields.filter((field) => !(field in parameters.properties));
    const unsent = (parameters.required ?? []).filter((argument) => !fields.includes(argument));
    if (unread.length || unsent.length) {
      drift.push(`${name} sends ${unread.join(", ") || "nothing"} unread and never sends ${unsent.join(", ") || "nothing"}`);
    }
  }
  const before = here.sheet(hero.id).spellcasting;
  // What the form sends now: the spell and whether it is learned or
  // forgotten. A cantrip, because copying a spell into a book takes hours
  // a fight does not have (src/lib/dm/learn-rules.ts).
  const learned = await here.invoke("learn_spell", { characterId: hero.id, action: "add", spell: "Light", reason: "a mentor" });
  here.patch(hero.id, { spellcasting: before });
  assert.equal(learned.ok, true, `the form's own request answered "${learned.error}"`);
  assert.deepEqual(drift, [], drift.join("; "));
});

// The console's form state, as src/app/campaigns/[campaignId]/DmActionForm.tsx
// holds it and posts it: every field of the catalog entry, a switch false and
// an untouched text empty unless the DM set it, a number as a number. The
// route hands it to invokeEngine as a human DM, which runs normalizeArgs.
function consoleForm(name, filled) {
  const initial = (field) => (field.kind === "boolean" ? field.default === true : field.kind === "characters" ? [] : "");
  return Object.fromEntries(
    adjudication(name).fields.map((field) => [field.name, field.name in filled ? filled[field.name] : initial(field)]),
  );
}

await test("the DM console's Spend a slot and Learn a spell forms, sent as the console sends them, spend the slot and learn or forget the spell on the stored sheet", async () => {
  const calm = await openWorld();
  // Copying a 1st-level spell into a book costs 50 gp.
  const mage = calm.addHero({ ...WIZARD, name: "Calm Mage", gold: 60 });
  const spent = await calm.invoke("use_spell_slot", consoleForm("use_spell_slot", {
    characterId: mage.id, level: 1, spell: "Magic Missile",
  }));
  assert.equal(spent.ok, true, spent.error);
  assert.deepEqual(calm.sheet(mage.id).spellcasting.slots["1"], { max: 4, used: 1 });
  const upcast = await calm.invoke("use_spell_slot", consoleForm("use_spell_slot", {
    characterId: mage.id, level: 2, spell: "Magic Missile",
  }));
  assert.equal(upcast.ok, true, upcast.error);
  assert.deepEqual(calm.sheet(mage.id).spellcasting.slots["2"], { max: 2, used: 1 });

  const learned = await calm.invoke("learn_spell", consoleForm("learn_spell", {
    characterId: mage.id, action: "add", spell: "Light",
  }));
  assert.equal(learned.ok, true, learned.error);
  assert.ok(calm.sheet(mage.id).spellcasting.cantrips.includes("Light"), "the cantrip was not learned");
  const forgot = await calm.invoke("learn_spell", consoleForm("learn_spell", {
    characterId: mage.id, action: "remove", spell: "Light", reason: "a curse",
  }));
  assert.equal(forgot.ok, true, forgot.error);
  assert.equal(calm.sheet(mage.id).spellcasting.cantrips.includes("Light"), false, "the cantrip was not forgotten");
  const copied = await calm.invoke("learn_spell", consoleForm("learn_spell", {
    characterId: mage.id, action: "add", spell: "Shield", reason: "a scroll copied",
  }));
  assert.equal(copied.ok, true, copied.error);
  assert.ok(calm.sheet(mage.id).spellcasting.spellbook.includes("Shield"), "the spell was not copied into the book");
  assert.equal(calm.sheet(mage.id).gold, 10, "the copy's 50 gp");
});

await test("The ceiling on a DM's direct edits holds however the edit is split: one level, 1,000 gp and a modest hit point gain are what a single story moment gives.", async () => {
  const before = here.sheet(fighter.id);
  for (let step = 1; step <= 3; step += 1) {
    await sent("update_sheet", {
      characterId: fighter.id, level: before.level + step, gold: before.gold + 1000 * step, reason: "training",
    });
  }
  const after = here.sheet(fighter.id);
  here.patch(fighter.id, { level: before.level, gold: before.gold });
  assert.ok(after.level <= before.level + 1, `level ${before.level} became ${after.level}`);
  assert.ok(after.gold - before.gold <= 1000, `${after.gold - before.gold} gp`);
});

// ---- the agent program's bridge ----

await test("the bridge hands over only the tools the turn allows", async () => {
  const session = new BridgeSession("hash", here.dir, {
    campaignId: here.campaignId,
    catalogue: [],
    allowed: new Set(["apply_damage"]),
    isTurn: true,
  }, () => {});
  const before = state();
  for (const name of ["update_sheet", "award_xp", "start_encounter", "", "apply_damage "]) {
    const refused = await session.call(name, { characterId: hero.id, amount: 5 });
    assert.equal(refused.isError, true, name);
  }
  session.narrateOnly = true;
  const late = await session.call("apply_damage", { characterId: hero.id, amount: 5 });
  assert.deepEqual(late, { text: NARRATE_NOW, isError: true });
  session.closed = true;
  assert.equal((await session.call("apply_damage", { characterId: hero.id, amount: 5 })).isError, true);
  // The bridge runs nothing itself: a call is only ever queued for the loop.
  assert.equal(state(), before);
});

await test("an allowed call reaches the game only as the loop's own tool call, and is answered only by the loop", async () => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  // close() removes the session's run folder, so it gets one of its own.
  const cwd = mkdtempSync(path.join(os.tmpdir(), "odm-bridge-"));
  const session = new BridgeSession("hash-round-trip", cwd, {
    campaignId: here.campaignId,
    catalogue: [],
    allowed: new Set(["apply_damage", "award_xp"]),
    isTurn: true,
  }, () => {});
  const tools = ["apply_damage", "award_xp"].map((name) => ({
    type: "function",
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  }));
  const before = state();
  const args = { characterId: hero.id, amount: 5, reason: "a trap" };
  const damage = session.call("apply_damage", args, "call-1");
  const xp = session.call("award_xp", { amount: 999999 }, "call-2");
  const round = await session.next([], { tools }, 5000);
  // The loop is handed the calls exactly as the program made them, and the
  // bridge has run nothing.
  assert.deepEqual(
    round.message.tool_calls.map((call) => [call.id, call.function.name, JSON.parse(call.function.arguments)]),
    [["call-1", "apply_damage", args], ["call-2", "award_xp", { amount: 999999 }]],
  );
  assert.equal(state(), before);
  // The loop answers the one it ran; the one it chose not to run (a cap, a
  // duplicate) is answered as not run, never as done.
  void session.next(
    [{ role: "assistant", content: "" }, { role: "tool", tool_call_id: "call-1", content: '{"ok":true}' }],
    { tools },
    5000,
  );
  assert.deepEqual(await damage, { text: '{"ok":true}', isError: false });
  const skipped = await xp;
  assert.equal(skipped.isError, true);
  assert.match(skipped.text, /did not run/);
  // Tools taken away by the loop (narration only) are refused at the door.
  const last = session.next([], { tools: [], toolChoice: "none" }, 5000);
  assert.deepEqual(await session.call("apply_damage", args), { text: NARRATE_NOW, isError: true });
  session.close();
  assert.ok((await last).error, "closing the session answers the loop's last ask");
  assert.equal(state(), before);
});

await test("the MCP door opens to a known token, from a program, and to nothing else", async () => {
  const knock = (headers) =>
    handleMcpRequest(new Request("http://127.0.0.1/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));
  assert.equal((await knock({})).status, 401);
  assert.equal((await knock({ authorization: "Bearer made-up-token" })).status, 401);
  assert.equal((await knock({ authorization: "Basic abc" })).status, 401);
  assert.equal((await knock({ authorization: "Bearer made-up-token", origin: "https://example.com" })).status, 403);
  assert.equal(bridgeSessionForToken("made-up-token"), null);
});

here.close();
finish();
