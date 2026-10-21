// Why the party is together (src/lib/dm/party-story.ts): the optional shared
// backstory written in the lobby. It is skippable, and skipped it changes
// nothing: the DM's prompt, the saga planner and the story-setup pass read
// exactly what they read before. Filled in, it reaches all three. The
// campaign creator gains nothing for it: the premise is the setup's place
// for why the group is together. The backstory's edit rule
// (the lead, a DM seat, anyone with a character; the latest save wins) and
// the draft button are driven through the real route against a throwaway
// database and a scripted model.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-party-story");

const story = await import("../src/lib/dm/party-story.ts");
const { normalizeGameSettings } = await import("../src/lib/schemas/game-settings.ts");
const { emptyParty, normalizeParty } = await import("../src/lib/dm/party-logic.ts");
const { buildGameStateBlock } = await import("../src/lib/dm/prompt.ts");
const { generateStoryArc } = await import("../src/lib/dm/arc.ts");
const { runStorySetup } = await import("../src/lib/dm/setup.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { getParty, updateParty } = await import("../src/lib/db/party.ts");
const { setMemberMuted } = await import("../src/lib/db/moderation.ts");

const BACKSTORY = "Mira pulled Brann out of the river at Kell's Ford; he has owed her since.";

// ---- the pure rules ----

await test("A blank backstory builds nothing anywhere", async () => {
  const blank = story.partyStoryOf({ party: { backstory: "  " } });
  assert.deepEqual(blank, { backstory: "" });
  assert.deepEqual(story.partyStoryPromptLines(blank), []);
  assert.equal(story.partyStoryPlannerBlock(blank), "");
  assert.deepEqual(story.partyStorySetupLines(blank), []);
  // A campaign from before the field existed reads the same as a blank one.
  assert.deepEqual(story.partyStoryOf({ party: {} }), blank);
  assert.deepEqual(story.partyStoryOf({}), blank);
});

await test("A written backstory gets one line in each", async () => {
  const lines = story.partyStoryPromptLines({ backstory: BACKSTORY });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Party backstory .*Kell's Ford/);
  const planner = story.partyStoryPlannerBlock({ backstory: BACKSTORY });
  assert.match(planner, /must keep it true/);
  assert.ok(planner.includes(BACKSTORY));
  assert.deepEqual(story.partyStorySetupLines({ backstory: BACKSTORY }), [`Table's shared party backstory: ${BACKSTORY}`]);
});

await test("An over-long backstory is clipped to its cap", async () => {
  const long = story.partyStoryOf({ party: { backstory: "b".repeat(2000) } });
  assert.equal(long.backstory.length, story.PARTY_BACKSTORY_MAX);
});

await test("The edit rule: lead, DM seat or a seated character", async () => {
  const may = story.mayWritePartyBackstory;
  assert.equal(may({ isLead: true, holdsDmSeat: false, hasCharacter: false }), true);
  assert.equal(may({ isLead: false, holdsDmSeat: true, hasCharacter: false }), true);
  assert.equal(may({ isLead: false, holdsDmSeat: false, hasCharacter: true }), true);
  assert.equal(may({ isLead: false, holdsDmSeat: false, hasCharacter: false }), false);
});

await test("Stored shapes default to blank and keep what was written, and the table's settings gain nothing", async () => {
  assert.ok(!("partyHook" in normalizeGameSettings({})), "no setting rides along with the backstory");
  assert.equal(emptyParty().backstory, "");
  // A party record stored before the field reads as no backstory.
  assert.equal(normalizeParty({ copper: 5 }).backstory, "");
  const kept = normalizeParty({ backstory: BACKSTORY, backstoryBy: "mira", backstoryAt: "2026-10-20T00:00:00.000Z" });
  assert.equal(kept.backstory, BACKSTORY);
  assert.equal(kept.backstoryBy, "mira");
});

await test("A draft reply is cleaned for the field", async () => {
  assert.equal(story.cleanPartyDraft('  "They met at the ford."  '), "They met at the ford.");
  assert.equal(story.cleanPartyDraft("```\nThey met.\n```"), "They met.");
  const long = `${"They walked on. ".repeat(80)}`;
  const cleaned = story.cleanPartyDraft(long);
  assert.ok(cleaned.length <= story.PARTY_BACKSTORY_MAX);
  assert.ok(cleaned.endsWith("."));
});

// ---- the DM's prompt ----

function gameState(campaign) {
  return { campaign, members: [], sheets: [], recentRolls: [], storySummary: "" };
}

await test("An empty backstory leaves the DM's game state untouched", async () => {
  const world = await openWorld({ status: "lobby" });
  const before = buildGameStateBlock(gameState(world.campaign()));
  // The same campaign as it read before the field existed.
  const legacy = world.campaign();
  delete legacy.party.backstory;
  assert.equal(buildGameStateBlock(gameState(legacy)), before);
  assert.ok(!/Party backstory/.test(before));
  world.close();
});

await test("Filled in, it rides the game state right after the premise", async () => {
  const world = await openWorld({ status: "lobby", campaign: { description: "A war is ending badly." } });
  updateParty(world.campaignId, (party) => ({ ...party, backstory: BACKSTORY }));
  const block = buildGameStateBlock(gameState(world.campaign()));
  const premise = block.indexOf("Premise: A war is ending badly.");
  const backstory = block.indexOf(BACKSTORY);
  assert.ok(premise >= 0 && backstory > premise, block.slice(0, 800));
  world.close();
});

// ---- the planner and the setup pass ----

await test("The saga planner and story setup read it, and nothing when blank", async () => {
  const model = await fakeModel();
  const userContent = (index) => {
    const messages = model.requests[index]?.messages ?? [];
    return messages.find((message) => message.role === "user")?.content ?? "";
  };

  const blank = await openWorld({ status: "lobby" });
  blank.addHero({ name: "Mira", backstory: "A river pilot." });
  model.pointAt(blank);
  model.script([]);
  await generateStoryArc(blank.campaignId);
  await runStorySetup(blank.campaignId);
  assert.equal(model.requests.length, 2);
  for (const index of [0, 1]) {
    assert.ok(!/party backstory|shared story/i.test(userContent(index)), userContent(index));
  }
  blank.close();

  const filled = await openWorld({ status: "lobby" });
  filled.addHero({ name: "Mira", backstory: "A river pilot." });
  updateParty(filled.campaignId, (party) => ({ ...party, backstory: BACKSTORY }));
  model.pointAt(filled);
  model.script([]);
  await generateStoryArc(filled.campaignId);
  await runStorySetup(filled.campaignId);
  const arc = userContent(0);
  assert.ok(arc.includes(`- Their shared backstory: ${BACKSTORY}`), arc);
  const setup = userContent(1);
  assert.ok(setup.includes(`Table's shared party backstory: ${BACKSTORY}`), setup);
  // The setup pass reads it and never rewrites it.
  assert.equal(getParty(filled.campaignId).backstory, BACKSTORY);
  filled.close();
  model.close();
});

// ---- the routes ----

async function call(mod, method, body, params) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

await test("Who may write the backstory, and the latest save wins", async () => {
  const world = await openWorld({ status: "lobby" });
  const route = await world.route("campaigns/[campaignId]/party/backstory");
  const params = { campaignId: world.campaignId };
  world.addHero({ name: "Mira" });
  const brann = world.addHero({ name: "Brann" });
  const brannUser = { id: brann.userId };
  const watcher = world.addUser("watcher");
  campaigns.joinByInviteCode(watcher.id, world.campaign().inviteCode);

  world.signIn(watcher);
  const refused = await call(route, "POST", { do: "save", text: "We are friends." }, params);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, story.PARTY_BACKSTORY_REFUSAL);

  world.signIn(world.owner);
  const first = await call(route, "POST", { do: "save", text: ` ${BACKSTORY} ` }, params);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(getParty(world.campaignId).backstory, BACKSTORY);
  assert.equal(getParty(world.campaignId).backstoryBy, world.owner.username);

  world.signIn(brannUser);
  const second = await call(route, "POST", { do: "save", text: "Brann tells it differently." }, params);
  assert.equal(second.status, 200);
  assert.equal(getParty(world.campaignId).backstory, "Brann tells it differently.");
  assert.notEqual(getParty(world.campaignId).backstoryBy, world.owner.username);

  // Too long is refused rather than cut, so nobody loses the end of it.
  const long = await call(route, "POST", { do: "save", text: "x".repeat(story.PARTY_BACKSTORY_MAX + 1) }, params);
  assert.equal(long.status, 400);

  // A muted player keeps reading but writes nothing in front of the table.
  setMemberMuted(world.campaignId, brann.userId, true);
  const muted = await call(route, "POST", { do: "save", text: "Muted words." }, params);
  assert.equal(muted.status, 403);
  setMemberMuted(world.campaignId, brann.userId, false);

  // Blank clears it, and the prompt goes back to saying nothing.
  const cleared = await call(route, "POST", { do: "save", text: "   " }, params);
  assert.equal(cleared.status, 200);
  assert.equal(getParty(world.campaignId).backstory, "");
  assert.equal(getParty(world.campaignId).backstoryBy, "");
  assert.ok(!buildGameStateBlock(gameState(world.campaign())).includes("Party backstory"));

  // Editing mid-campaign works the same way, and the rest of the party
  // record is untouched by it.
  campaigns.setCampaignStatus(world.campaignId, "active");
  updateParty(world.campaignId, (party) => ({ ...party, copper: 120 }));
  const midGame = await call(route, "POST", { do: "save", text: BACKSTORY }, params);
  assert.equal(midGame.status, 200);
  assert.equal(getParty(world.campaignId).copper, 120);
  assert.ok(buildGameStateBlock(gameState(world.campaign())).includes(BACKSTORY));
  world.close();
});

await test("The draft asks the model from the characters' backstories and saves nothing", async () => {
  const model = await fakeModel();
  const world = await openWorld({ status: "lobby", campaign: { description: "A war is ending badly." } });
  const route = await world.route("campaigns/[campaignId]/party/backstory");
  const params = { campaignId: world.campaignId };
  model.pointAt(world);

  world.signIn(world.owner);
  const nobody = await call(route, "POST", { do: "draft" }, params);
  assert.equal(nobody.status, 409);

  world.addHero({ name: "Mira", backstory: "A river pilot who lost her boat." });
  world.addHero({ name: "Brann", backstory: "A smith's son who cannot swim." });
  model.script([reply({ text: '"Mira and Brann met when the river took her boat."' })]);
  const drafted = await call(route, "POST", { do: "draft" }, params);
  assert.equal(drafted.status, 200, JSON.stringify(drafted.json));
  assert.equal(drafted.json.text, "Mira and Brann met when the river took her boat.");
  const asked = model.requests[0].messages.find((message) => message.role === "user").content;
  assert.ok(asked.includes("A river pilot who lost her boat."), asked);
  assert.ok(asked.includes("A smith's son who cannot swim."), asked);
  assert.ok(asked.includes("A war is ending badly."), "the premise is what the setup said of the group");
  assert.equal(getParty(world.campaignId).backstory, "");
  world.close();
  model.close();
});

finish();
