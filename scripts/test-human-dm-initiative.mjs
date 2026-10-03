// A fight a human DM starts asks the table for initiative (issue 63).
//
// The rule: when a person starts a fight from the console (or deploys a
// prepared one, or resets the order), every fielded character who can roll
// is asked for initiative at once. The server throws the dice for a player
// who lets it; a player who holds their rolls or rolls real dice gets an
// initiative roll card, and the order locks when the last one lands. The
// dead are not waited on. Before the fix the console only repeated the AI's
// instruction ("call request_roll ... for EACH character") as "Waiting on
// initiative from ...", nobody was asked, and the fight never began.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-human-dm-initiative");
const { getFloor, setMemberHoldRolls } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls, getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { describeAdjudicationResult } = await import("../src/lib/dm/catalog-result.ts");

// A human-run table: the owner sits in the DM's chair and plays nobody.
async function humanTable(heroCount) {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const players = [];
  const heroes = [];
  for (let index = 0; index < heroCount; index += 1) {
    const user = world.addUser();
    players.push(user);
    heroes.push(world.addHero({ user, class: "fighter", level: 3 }));
  }
  return { world, players, heroes };
}

const pcIds = (encounter) =>
  encounter.order.filter((entry) => entry.kind === "pc").map((entry) => entry.characterId);

async function start(world, faces) {
  world.clearDice();
  world.dice(1, ...faces);
  const out = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return out.result;
}

await test("starting a fight rolls every player's initiative the server throws, and combat begins", async () => {
  const { world, heroes } = await humanTable(2);
  const result = await start(world, [15, 10]);
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true, "the order never locked");
  assert.deepEqual(new Set(pcIds(encounter)), new Set(heroes.map((hero) => hero.id)));
  assert.equal(getFloor(world.campaignId).mode, "initiative");
  assert.match(String(result.next), /combat has begun/i);
  // The console speaks to a person: no instruction to a model, and no claim
  // that someone is being waited on when nobody is.
  const text = describeAdjudicationResult(result).map((line) => line.text).join(" ");
  assert.doesNotMatch(JSON.stringify(result), /request_roll/);
  assert.doesNotMatch(text, /Waiting on initiative/);
  assert.match(text, /Hero 1 \d+/);
});

await test("a player who holds their rolls gets an initiative roll card, and the order locks when it lands", async () => {
  const { world, players, heroes } = await humanTable(2);
  setMemberHoldRolls(world.campaignId, players[1].id, true);
  const result = await start(world, [15]);
  assert.equal(world.encounter().orderReady, false);
  const pending = listOpenPendingRolls(world.campaignId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, "initiative");
  assert.equal(pending[0].userId, players[1].id);
  assert.equal(pending[0].characterId, heroes[1].id);
  assert.match(String(result.next), /Hero 2 has an initiative roll to make/);

  // The player releases it from their card.
  const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  world.signIn(players[1]);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ dice: ["digital"] }) }),
    { params: Promise.resolve({ campaignId: world.campaignId, pendingRollId: pending[0].id }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true, "the last roll did not lock the order");
  assert.deepEqual(new Set(pcIds(encounter)), new Set(heroes.map((hero) => hero.id)));
  assert.equal(getFloor(world.campaignId).mode, "initiative");
  // The person's turn the roll hung on is closed, so the next console
  // action starts a fresh one.
  assert.equal(getDmTurn(pending[0].turnId).status, "done");
});

await test("the dead are not asked and not waited on", async () => {
  const { world, heroes } = await humanTable(2);
  world.patch(heroes[1].id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  await start(world, [15]);
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true, "the fight waited on a dead character");
  assert.deepEqual(pcIds(encounter), [heroes[0].id]);
  assert.equal(listOpenPendingRolls(world.campaignId).length, 0);
});

await test("resetting the order asks everyone again", async () => {
  const { world, heroes } = await humanTable(2);
  await start(world, [15, 10]);
  assert.equal(world.encounter().orderReady, true);
  const route = await world.route("campaigns/[campaignId]/dm/initiative");
  world.signIn(world.owner);
  world.dice(4, 18);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ op: "reset" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  world.clearDice();
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true, "the reset order was never collected again");
  assert.deepEqual(new Set(pcIds(encounter)), new Set(heroes.map((hero) => hero.id)));
  assert.match(String(body.next), /combat has begun/i);
});

await test("deploying a prepared fight asks for initiative the same way", async () => {
  const { world, heroes } = await humanTable(1);
  const { deployTemplate } = await import("../src/lib/dm/encounter-templates.ts");
  const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
  const { EMPTY_TEMPLATE_MAP } = await import("../src/lib/dm/encounter-template-logic.ts");
  const template = insertEncounterTemplate({
    campaignId: world.campaignId,
    name: "The ford",
    enemies: [{ monster: "goblin", count: 1 }],
    battlefield: "",
    map: EMPTY_TEMPLATE_MAP,
    notes: "Ambush at the ford",
    createdByUserId: world.owner.id,
  });
  world.dice(1, 12);
  const out = await deployTemplate(world.campaign(), world.owner.id, template);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true);
  assert.deepEqual(pcIds(encounter), [heroes[0].id]);
});

finish();
