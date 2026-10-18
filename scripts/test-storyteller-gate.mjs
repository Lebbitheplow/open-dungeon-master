// No storyteller, no AI seat. The campaign creator hides the AI seats when
// /api/capabilities says the server has no text model; these are the server's
// own refusals behind it, for every other caller: a shell, a script, a creator
// whose capability check never answered, Quick start, and a lead handing a
// running table to the AI later. A seat nobody named follows the server: the
// AI where a storyteller exists, a person where none does. A storyteller that
// is set up but down is still set up (an outage is the "not answering" notice,
// not a refusal), and a table whose lead named its own model counts too.
import assert from "node:assert/strict";
import { call, standInStoryteller } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-storyteller-gate");

const world = await openWorld();
const campaignsRoute = await world.route("campaigns");
const settingsRoute = await world.route("campaigns/[campaignId]/settings");
const storyRoute = await world.route("campaigns/[campaignId]/story-settings");
const starterRoute = await world.route("starter");
const { NO_STORYTELLER_MESSAGE } = await import("../src/lib/capabilities.ts");
world.signIn(world.owner);

const make = (gameSettings) => call(campaignsRoute, "POST", { title: "Gate", ...(gameSettings ? { gameSettings } : {}) });

await test("With no storyteller set up, every AI seat is refused with the reason, and the human seat is not.", async () => {
  for (const dmMode of ["ai", "steered", "assisted"]) {
    const answer = await make({ dmMode });
    assert.equal(answer.status, 409, `${dmMode}: ${JSON.stringify(answer.json)}`);
    assert.equal(answer.json.reason, "no_storyteller");
    assert.equal(answer.json.error, NO_STORYTELLER_MESSAGE);
  }
  const human = await make({ dmMode: "human" });
  assert.equal(human.status, 201, JSON.stringify(human.json));
  assert.equal(human.json.campaign.gameSettings.dmMode, "human");
});

await test("A seat nobody named follows the server: a person runs the table where no storyteller exists.", async () => {
  const unsaid = await make(undefined);
  assert.equal(unsaid.status, 201, JSON.stringify(unsaid.json));
  assert.equal(unsaid.json.campaign.gameSettings.dmMode, "human");
  const emptied = await make({});
  assert.equal(emptied.status, 201, JSON.stringify(emptied.json));
  assert.equal(emptied.json.campaign.gameSettings.dmMode, "human");
});

const table = (await make({ dmMode: "human" })).json.campaign.id;

await test("A running table is not handed to the AI without a storyteller; every other setting still saves.", async () => {
  const handed = await call(settingsRoute, "PATCH", { dmMode: "ai" }, { campaignId: table });
  assert.equal(handed.status, 409, JSON.stringify(handed.json));
  assert.equal(handed.json.reason, "no_storyteller");
  const kept = await call(settingsRoute, "PATCH", { dmMode: "human", ttsEnabled: false }, { campaignId: table });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.equal(kept.json.gameSettings.dmMode, "human");
});

await test("Quick start, the AI's own one-shot, is refused the same way.", async () => {
  const started = await call(starterRoute, "POST", { solo: true });
  assert.equal(started.status, 409, JSON.stringify(started.json));
  assert.equal(started.json.reason, "no_storyteller");
});

await test("A table whose lead named its own model may be handed to the AI, though the server has none.", async () => {
  const named = await call(storyRoute, "PATCH", { textProvider: "local", localTextModel: "stand-in:7b" }, { campaignId: table });
  assert.equal(named.status, 200, JSON.stringify(named.json));
  const handed = await call(settingsRoute, "PATCH", { dmMode: "ai" }, { campaignId: table });
  assert.equal(handed.status, 200, JSON.stringify(handed.json));
  assert.equal(handed.json.gameSettings.dmMode, "ai");
});

// From here the server has a storyteller: set up, never answering.
standInStoryteller();

await test("With a storyteller set up, even one that is down, the AI seats are open and an unnamed seat is the AI's.", async () => {
  const ai = await make({ dmMode: "steered" });
  assert.equal(ai.status, 201, JSON.stringify(ai.json));
  assert.equal(ai.json.campaign.gameSettings.dmMode, "steered");
  const unsaid = await make(undefined);
  assert.equal(unsaid.json.campaign.gameSettings.dmMode, "ai");
  const handed = await call(settingsRoute, "PATCH", { dmMode: "ai" }, { campaignId: (await make({ dmMode: "human" })).json.campaign.id });
  assert.equal(handed.status, 200, JSON.stringify(handed.json));
  const started = await call(starterRoute, "POST", { solo: true });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  assert.equal(started.json.campaign.gameSettings.dmMode, "ai");
});

world.close();
finish();
