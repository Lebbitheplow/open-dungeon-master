// What a PLAYER can write to their own sheet while the game is running, and
// whether a dying, dead or stunned character's player can write their way out
// of it. Every call here is the route a player's client calls, signed in as
// that player, never the engine.
//
// The rule being guarded is ODM's own (src/lib/schemas/sheet.ts and the
// sheet route): hit points, temporary hit points, conditions, death saves
// and exhaustion are engine state. "Players may self-serve cosmetics any
// time; every other field in the player patch schema exists for the level-up
// flow". A player's counters (slots, hit dice, class resources) are theirs to
// SPEND through /sheet/usage and never to recover. The refusal in a fight is
// pinned here; the recovery the route allows outside one is recorded as a gap
// in test-enforce-usage-route.mjs.
//
// ODM's own rules, pinned here as the code documents them:
//   - Whoever runs the story (the party lead at an AI table, the DM at a
//     human one) may correct ANY sheet through /sheets/[sheetId], death
//     included, with an audit entry. That is the one way back from death.
//   - Character edits and replacement (PUT, POST, DELETE) are lobby-only.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-enforce-player-bypass");
const world = await openWorld();
const kit = conditionsKit(world);
const { XP_THRESHOLDS, levelForXp } = await import("../src/lib/srd/index.ts");

const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
const usageRoute = await world.route("campaigns/[campaignId]/sheet/usage");
const leadRoute = await world.route("campaigns/[campaignId]/sheets/[sheetId]");
const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");

const leader = world.addHero(FIGHTER);
const hero = world.addHero(FIGHTER);
const player = { id: hero.userId };

async function call(mod, method, body, user = player, params = {}) {
  world.signIn(user);
  const response = await mod[method](
    new Request("http://odm.test/", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId, ...params }) },
  );
  return { status: response.status, body: await response.json().catch(() => null) };
}

const DYING = { successes: 0, failures: 2, stable: false, dead: false };
const DEAD = { successes: 0, failures: 3, stable: false, dead: true };
const engineState = () => {
  const sheet = world.sheet(hero.id);
  return {
    currentHp: sheet.currentHp,
    tempHp: sheet.tempHp,
    maxHp: sheet.maxHp,
    conditions: sheet.conditions,
    conditionMeta: sheet.conditionMeta,
    deathSaves: sheet.deathSaves,
    exhaustion: sheet.exhaustion,
    concentratingOn: sheet.concentratingOn,
    level: sheet.level,
    xp: sheet.xp,
    gold: sheet.gold,
    ac: sheet.ac,
  };
};
function down(saves = DYING) {
  kit.reset(hero.id, {
    currentHp: 0,
    deathSaves: saves,
    conditions: ["unconscious", "stunned"],
    exhaustion: 2,
  });
}

// ---- the sheet route, outside a level-up ----

const ENGINE_FIELDS = [
  { currentHp: 40 },
  { tempHp: 50 },
  { maxHp: 200 },
  { conditions: [] },
  { conditions: ["invisible"] },
  { ac: 25 },
  { gold: 5000 },
  { xp: 100000 },
  { hitDice: { die: "d10", total: 5, spent: 0 } },
  { abilities: { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 } },
  { notes: "just a note", currentHp: 40 },
];
for (const body of ENGINE_FIELDS) {
  await test(`a dying player's PATCH of ${Object.keys(body).join(" and ")} is refused`, async () => {
    down();
    const before = engineState();
    const out = await call(sheetRoute, "PATCH", body);
    assert.equal(out.status, 403);
    assert.deepEqual(engineState(), before);
  });
}

// Engine-only fields are not in the player's schema at all: the request is
// read without them and nothing is written.
const UNKNOWN_TO_PLAYERS = [
  { deathSaves: null },
  { deathSaves: { successes: 3, failures: 0, stable: true, dead: false } },
  { exhaustion: 0 },
  { conditionMeta: {} },
  { concentratingOn: null },
  { resources: {} },
  { wildShape: null },
];
for (const body of UNKNOWN_TO_PLAYERS) {
  await test(`a player's PATCH of ${Object.keys(body)[0]} writes nothing`, async () => {
    down(DEAD);
    const before = engineState();
    await call(sheetRoute, "PATCH", body);
    assert.deepEqual(engineState(), before);
    assert.deepEqual(world.sheet(hero.id).resources, hero.resources);
  });
}

await test("notes, backstory and portrait are the player's own, even when dead", async () => {
  down(DEAD);
  const before = engineState();
  const out = await call(sheetRoute, "PATCH", { notes: "I regret nothing.", backstory: "Born in a storm." });
  assert.equal(out.status, 200);
  assert.equal(world.sheet(hero.id).notes, "I regret nothing.");
  assert.deepEqual(engineState(), before);
});

await test("a stranger to the table cannot reach the sheet route at all", async () => {
  down();
  const stranger = world.addUser("stranger");
  const out = await call(sheetRoute, "PATCH", { notes: "hello" }, stranger);
  assert.ok(out.status === 403 || out.status === 404, `status ${out.status}`);
});

await test("edits and replacement are lobby-only: a running game refuses them", async () => {
  down(DEAD);
  const before = engineState();
  for (const method of ["PUT", "DELETE"]) {
    const out = await call(sheetRoute, method, {});
    assert.equal(out.status, 409, method);
  }
  assert.deepEqual(engineState(), before);
  assert.ok(world.sheet(hero.id));
});

// ---- the lead's correction ----

await test("an ordinary player cannot use the lead's correction, on anyone", async () => {
  down();
  const before = engineState();
  for (const sheetId of [hero.id, leader.id]) {
    const out = await call(leadRoute, "PATCH", { currentHp: 40, deathSaves: null }, player, { sheetId });
    assert.equal(out.status, 403);
  }
  assert.deepEqual(engineState(), before);
});

await test("whoever runs the story can reverse a death", async () => {
  down(DEAD);
  const out = await call(
    leadRoute,
    "PATCH",
    { currentHp: 1, deathSaves: null, conditions: [], reason: "the table agreed" },
    world.owner,
    { sheetId: hero.id },
  );
  assert.equal(out.status, 200);
  assert.equal(world.sheet(hero.id).currentHp, 1);
  assert.equal(world.sheet(hero.id).deathSaves, null);
});

// ---- counters ----

await test("the usage route cannot carry hit points, conditions or death saves", async () => {
  down();
  const before = engineState();
  const out = await call(usageRoute, "POST", { currentHp: 40, deathSaves: null, conditions: [] });
  assert.equal(out.status, 400);
  await call(usageRoute, "POST", { resources: { second_wind: 1 }, currentHp: 40, deathSaves: null });
  assert.deepEqual(engineState(), before);
  assert.equal(world.sheet(hero.id).resources.second_wind.used, 1);
});

await test("a counter is clamped to its own maximum and unknown counters are ignored", async () => {
  kit.reset(hero.id);
  const out = await call(usageRoute, "POST", { resources: { second_wind: 9, wishes: 1 } });
  assert.equal(out.status, 200);
  const sheet = world.sheet(hero.id);
  assert.deepEqual(sheet.resources.second_wind, { max: 1, used: 1 });
  assert.equal(sheet.resources.wishes, undefined);
});

await world.beginFight([{ monster: "goblin", count: 2 }], {
  heroFaces: { [leader.id]: 20, [hero.id]: 18 },
});

await test("in a fight a player cannot hand a spent counter back to themselves", async () => {
  kit.reset(hero.id);
  world.patch(hero.id, {
    hitDice: { ...world.sheet(hero.id).hitDice, spent: 3 },
    resources: { second_wind: { max: 1, used: 1 } },
  });
  for (const body of [{ hitDiceSpent: 0 }, { resources: { second_wind: 0 } }]) {
    const out = await call(usageRoute, "POST", body);
    assert.equal(out.status, 409);
  }
  assert.equal(world.sheet(hero.id).hitDice.spent, 3);
  assert.equal(world.sheet(hero.id).resources.second_wind.used, 1);
});

await test("a player cannot walk a token that is down, even on its own turn", async () => {
  kit.reset(hero.id);
  assert.equal(kit.skipTurn(), true);
  assert.equal(kit.pointer().id, hero.id);
  for (const saves of [DYING, DEAD]) {
    down(saves);
    const move = await call(moveRoute, "POST", { x: 1, y: 1 });
    assert.equal(move.status, 409);
  }
});
kit.offBoard();
const [goblin] = world.enemies();

// ---- gaps ----

await test(
  "Hit points, temporary hit points and conditions are the engine's to write: a level-up request carries none of them, and a level that was not earned is not taken.",
  async () => {
    down();
    const before = engineState();
    // The sheet holds the experience its level starts at and no more, so the
    // next level has not been earned.
    assert.equal(levelForXp(before.xp), before.level);
    const out = await call(sheetRoute, "PATCH", {
      level: before.level + 1,
      currentHp: 40,
      tempHp: 200,
      conditions: [],
    });
    assert.notEqual(out.status, 200);
    assert.deepEqual(
      engineState(),
      before,
      `status ${out.status}: a dying player's level-up request changed the sheet`,
    );
  },
);

await test("an earned level taken by a player on their feet adds the level's hit points and carries nothing else in", async () => {
  kit.reset(hero.id, { currentHp: 10, tempHp: 0, conditions: ["poisoned"], xp: XP_THRESHOLDS[FIGHTER.level] });
  const before = engineState();
  const out = await call(sheetRoute, "PATCH", {
    level: before.level + 1,
    currentHp: 40,
    tempHp: 200,
    maxHp: 500,
    gold: 9000,
    conditions: [],
  });
  assert.equal(out.status, 200, out.body?.error);
  const after = engineState();
  assert.equal(after.level, before.level + 1);
  assert.equal(after.maxHp, before.maxHp + out.body.hpGained);
  assert.equal(after.currentHp, before.currentHp + out.body.hpGained);
  assert.equal(after.tempHp, 0);
  assert.equal(after.gold, before.gold);
  assert.deepEqual(after.conditions, ["poisoned"]);
});
world.patch(hero.id, { level: FIGHTER.level, maxHp: 40 });

await test("A dead character takes no level and no action; only whoever runs the story reverses a death.", async () => {
  down(DEAD);
  await call(sheetRoute, "PATCH", { level: FIGHTER.level + 1, currentHp: 40, conditions: [] });
  assert.equal(world.sheet(hero.id).deathSaves?.dead, true);
  kit.resetEnemy(goblin.id);
  const out = await kit.swing([17, 4], hero.id, goblin.id, { weapon: "Longsword" });
  assert.equal(out.outcome.ok, false, "a dead character levelled up by PATCH and then attacked");
});
world.patch(hero.id, { level: FIGHTER.level, maxHp: 40 });

await test("a dead character spends nothing: no hit dice, no class resources", async () => {
  down(DEAD);
  world.patch(hero.id, {
    resources: { second_wind: { max: 1, used: 0 } },
    hitDice: { ...world.sheet(hero.id).hitDice, spent: 0 },
  });
  for (const body of [{ resources: { second_wind: 1 } }, { hitDiceSpent: 1 }]) {
    const out = await call(usageRoute, "POST", body);
    assert.notEqual(out.status, 200, `a dead character spent ${JSON.stringify(body)}`);
  }
  assert.equal(world.sheet(hero.id).resources.second_wind.used, 0);
  assert.equal(world.sheet(hero.id).hitDice.spent, 0);
});

world.close();
finish();
