// A spotlight comes down once the players it names have answered the GM,
// and a party lead's direction is an answer. A playtest's lead sent ten turns
// as directions under a spotlight ("Spend your remaining Hit Dice on your
// sheet"); the GM answered each one, and the spotlight stayed up over all of
// them, because only a move or a line through the actions route counted.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-spotlight-answer");
const { getFloor, setFloor } = await import("../src/lib/db/campaigns.ts");

async function post(world, user, name, body) {
  const route = await world.route(name);
  world.signIn(user);
  const response = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

const spotlight = (userIds) => ({ mode: "spotlight", userIds, prompt: "Spend your remaining Hit Dice on your sheet.", respondedUserIds: [] });
const direction = (world, user, content) => post(world, user, "campaigns/[campaignId]/lead-note", { content, wake: false });

await test("a spotlighted lead's direction answers the spotlight, and the table opens", async () => {
  const world = await openWorld();
  world.addHero({ name: "Krag" });
  setFloor(world.campaignId, spotlight([world.owner.id]));
  const sent = await direction(world, world.owner, "Krag finishes his rest and takes the road to the ford.");
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.deepEqual(getFloor(world.campaignId), { mode: "open" });
});

await test("a lead's direction answers only for the lead: a spotlight on another player waits for them", async () => {
  const world = await openWorld();
  world.addHero({ name: "Krag" });
  const bram = world.addHero({ name: "Bram" });
  setFloor(world.campaignId, spotlight([world.owner.id, bram.userId]));
  assert.equal((await direction(world, world.owner, "The rain lets up.")).status, 201);
  const waiting = getFloor(world.campaignId);
  assert.equal(waiting.mode, "spotlight");
  assert.deepEqual(waiting.respondedUserIds, [world.owner.id]);
  // Bram's own move is the last answer it waits on.
  const moved = await post(world, { id: bram.userId }, "campaigns/[campaignId]/actions", { content: "I check the cart's axle.", kind: "do" });
  assert.equal(moved.status, 202, JSON.stringify(moved.json));
  assert.deepEqual(getFloor(world.campaignId), { mode: "open" });

  setFloor(world.campaignId, spotlight([bram.userId]));
  assert.equal((await direction(world, world.owner, "Night falls.")).status, 201);
  assert.deepEqual(getFloor(world.campaignId), spotlight([bram.userId]), "the lead answers nothing for Bram");
});

finish();
