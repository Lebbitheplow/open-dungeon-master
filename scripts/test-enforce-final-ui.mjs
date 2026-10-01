// What the player's screens send for the engine's newer rules, and what the
// server does with it (workstream final-ui, /tmp/odm-enf2/fixes/final-ui.md):
//
//   - Inspiration spent on a roll parked for the player (the pending roll
//     card's "Spend Inspiration"): SRD 5.1, advantage on an attack roll,
//     saving throw or ability check. The route rewrites the parked d20 before
//     a die is thrown and marks the counter spent; it refuses, spending
//     nothing, what the rule does not allow (no Inspiration held, a roll that
//     is not a d20 test, somebody else's roll).
//   - The Thief's second round-1 turn reaches the trackers as its own row.
// Stored state and route answers are read, never narration.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { fakeModel } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-final-ui");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);

const turns = await import("../src/lib/db/dm-turns.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");

const kara = world.addHero({ name: "Kara", class: "rogue", level: 3, maxHp: 24, abilities: { dex: 16 }, proficiencies: TRAINED });
const bo = world.addHero({ name: "Bo", class: "fighter", level: 3, maxHp: 28, abilities: { str: 16 }, proficiencies: TRAINED });

// A roll parked for Kara on a turn the human DM opened, so resolving it
// closes the turn without waking a model.
function park(extra = {}) {
  const turn = turns.createDmTurn(world.campaignId, [], "human_dm");
  turns.saveDmTurn({ ...turn, status: "awaiting_rolls" });
  return turns.createPendingRoll({
    campaignId: world.campaignId,
    turnId: turn.id,
    toolCallId: null,
    userId: kara.userId,
    characterId: kara.id,
    kind: "skill_check",
    detail: "stealth",
    expression: "1d20+5",
    advantage: "none",
    dc: 15,
    reason: "slipping past the guard",
    ...extra,
  });
}

async function call(route, user, pendingRollId, body = {}) {
  const handler = await world.route(route);
  world.signIn({ id: user });
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId, pendingRollId }) },
  );
  return { status: response.status, json: await response.json() };
}
const inspire = (user, id) => call("campaigns/[campaignId]/pending-rolls/[pendingRollId]/inspiration", user, id);
const submit = (user, id, body) => call("campaigns/[campaignId]/pending-rolls/[pendingRollId]", user, id, body);

await test("A player spends Inspiration on a roll parked for them: the stored roll becomes an advantage roll and the counter is spent.", async () => {
  world.patch(kara.id, { resources: { ...world.sheet(kara.id).resources, inspiration: { max: 1, used: 0 } } });
  const pending = park();
  const answer = await inspire(kara.userId, pending.id);
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const stored = turns.getPendingRoll(pending.id);
  assert.equal(stored.expression, "2d20kh1+5");
  assert.equal(stored.advantage, "advantage");
  assert.equal(world.sheet(kara.id).resources.inspiration.used, 1);
  // The roll then lands as an advantage roll: the higher d20 counts.
  world.dice(4, 17);
  const rolled = await submit(kara.userId, pending.id, { fallback: "digital" });
  world.clearDice();
  assert.equal(rolled.status, 200, JSON.stringify(rolled.json));
  assert.equal(rolled.json.roll.total, 22);
  assert.equal(rolled.json.roll.advantage, "advantage");
});

await test("With no Inspiration held the spend is refused in the rule's words and the parked roll is unchanged.", async () => {
  world.patch(kara.id, { resources: { ...world.sheet(kara.id).resources, inspiration: { max: 1, used: 1 } } });
  const pending = park();
  const answer = await inspire(kara.userId, pending.id);
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, /Kara holds no Inspiration to spend/);
  assert.equal(turns.getPendingRoll(pending.id).expression, "1d20+5");
});

await test("Inspiration on a disadvantage roll makes it a straight roll; a damage roll and somebody else's roll are refused, spending nothing.", async () => {
  world.patch(kara.id, { resources: { ...world.sheet(kara.id).resources, inspiration: { max: 1, used: 0 } } });
  const damage = park({ kind: "damage", detail: "dagger", expression: "1d4+3", dc: null });
  const refused = await inspire(kara.userId, damage.id);
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /attack roll, a saving throw or an ability check/);
  const theirs = park({ kind: "saving_throw", detail: "dex", expression: "2d20kl1+3", advantage: "disadvantage" });
  const stranger = await inspire(bo.userId, theirs.id);
  assert.equal(stranger.status, 403);
  assert.equal(world.sheet(kara.id).resources.inspiration.used, 0, "nothing was spent");
  const straight = await inspire(kara.userId, theirs.id);
  assert.equal(straight.status, 200);
  const stored = turns.getPendingRoll(theirs.id);
  assert.equal(stored.expression, "1d20+3");
  assert.equal(stored.advantage, "none");
  assert.equal(world.sheet(kara.id).resources.inspiration.used, 1);
});

await test("A Thief's second round-1 turn reaches the trackers as a row of its own, marked reflex.", async () => {
  const nim = world.addHero({
    name: "Nim", class: "rogue", subclass: "Thief", level: 17, maxHp: 90, abilities: { dex: 18 }, proficiencies: TRAINED,
    features: [{ name: "Thief's Reflexes", source: "class", level: 17 }],
  });
  const kit = await combatKit(world);
  await kit.fight(1);
  const projected = activePublicEncounter(world.campaignId);
  const rows = projected.order.filter((row) => row.id === nim.id);
  assert.equal(rows.length, 2, JSON.stringify(projected.order));
  assert.deepEqual(rows.map((row) => Boolean(row.reflex)), [false, true]);
  assert.equal(projected.order.filter((row) => row.reflex).length, 1, "only the thief's second entry is marked");
  await kit.endFight();
});

model.close();
world.close();
finish();
