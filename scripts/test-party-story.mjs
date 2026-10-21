// Why the party is together (src/lib/dm/party-story.ts): the optional party
// hook written at campaign setup and the optional shared backstory written in
// the lobby. Both are skippable, and a skipped one changes nothing: the DM's
// prompt, the saga planner and the story-setup pass read exactly what they
// read before. Filled in, each reaches all three. The backstory's edit rule
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

const HOOK = "Deserters from the same border company, hunted by their old captain.";
const BACKSTORY = "Mira pulled Brann out of the river at Kell's Ford; he has owed her since.";

// ---- the pure rules ----

await test("Blank texts build nothing anywhere", async () => {
  const blank = story.partyStoryOf({ gameSettings: { partyHook: "  " }, party: { backstory: "" } });
  assert.deepEqual(blank, { hook: "", backstory: "" });
  assert.deepEqual(story.partyStoryPromptLines(blank), []);
  assert.equal(story.partyStoryPlannerBlock(blank), "");
  assert.deepEqual(story.partyStorySetupLines(blank), []);
  // A campaign from before the fields existed reads the same as a blank one.
  assert.deepEqual(story.partyStoryOf({ gameSettings: {} }), blank);
  assert.deepEqual(story.partyStoryOf({}), blank);
});

await test("Each text gets its own line, and only the one written", async () => {
  const hookOnly = story.partyStoryPromptLines({ hook: HOOK, backstory: "" });
  assert.equal(hookOnly.length, 1);
  assert.match(hookOnly[0], /^Party hook .*border company/);
  const both = story.partyStoryPromptLines({ hook: HOOK, backstory: BACKSTORY });
  assert.equal(both.length, 2);
  assert.match(both[1], /^Party backstory .*Kell's Ford/);
  const planner = story.partyStoryPlannerBlock({ hook: "", backstory: BACKSTORY });
  assert.match(planner, /must keep it true/);
  assert.ok(planner.includes(BACKSTORY));
  assert.ok(!planner.includes("How they came together"));
});

await test("Over-long texts are clipped to their caps", async () => {
  const long = story.partyStoryOf({
    gameSettings: { partyHook: "h".repeat(900) },
    party: { backstory: "b".repeat(2000) },
  });
  assert.equal(long.hook.length, story.PARTY_HOOK_MAX);
  assert.equal(long.backstory.length, story.PARTY_BACKSTORY_MAX);
});

await test("The edit rule: lead, DM seat or a seated character", async () => {
  const may = story.mayWritePartyBackstory;
  assert.equal(may({ isLead: true, holdsDmSeat: false, hasCharacter: false }), true);
  assert.equal(may({ isLead: false, holdsDmSeat: true, hasCharacter: false }), true);
  assert.equal(may({ isLead: false, holdsDmSeat: false, hasCharacter: true }), true);
  assert.equal(may({ isLead: false, holdsDmSeat: false, hasCharacter: false }), false);
});

await test("Stored shapes default to blank and keep what was written", async () => {
  assert.equal(normalizeGameSettings({}).partyHook, "");
  assert.equal(normalizeGameSettings({ partyHook: `  ${HOOK}  ` }).partyHook, HOOK);
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

await test("An empty hook and backstory leave the DM's game state untouched", async () => {
  const world = await openWorld({ status: "lobby" });
  const before = buildGameStateBlock(gameState(world.campaign()));
  // The same campaign as it read before the fields existed.
  const legacy = world.campaign();
  delete legacy.gameSettings.partyHook;
  delete legacy.party.backstory;
  assert.equal(buildGameStateBlock(gameState(legacy)), before);
  assert.ok(!/Party hook|Party backstory/.test(before));
  world.close();
});

await test("Filled in, both ride the game state right after the premise", async () => {
  const world = await openWorld({ status: "lobby", campaign: { description: "A war is ending badly." } });
  campaigns.updateGameSettings(world.campaignId, { partyHook: HOOK });
  updateParty(world.campaignId, (party) => ({ ...party, backstory: BACKSTORY }));
  const block = buildGameStateBlock(gameState(world.campaign()));
  const premise = block.indexOf("Premise: A war is ending badly.");
  const hook = block.indexOf(`Party hook (how the group came together, set before the characters existed): ${HOOK}`);
  const backstory = block.indexOf(BACKSTORY);
  assert.ok(premise >= 0 && hook > premise && backstory > hook, block.slice(0, 800));
  world.close();
});

// ---- the planner and the setup pass ----

await test("The saga planner and story setup read both, and neither when blank", async () => {
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
    assert.ok(!/party hook|party backstory|shared story/i.test(userContent(index)), userContent(index));
  }
  blank.close();

  const filled = await openWorld({ status: "lobby", gameSettings: { partyHook: HOOK } });
  filled.addHero({ name: "Mira", backstory: "A river pilot." });
  updateParty(filled.campaignId, (party) => ({ ...party, backstory: BACKSTORY }));
  model.pointAt(filled);
  model.script([]);
  await generateStoryArc(filled.campaignId);
  await runStorySetup(filled.campaignId);
  const arc = userContent(0);
  assert.ok(arc.includes(`- How they came together: ${HOOK}`), arc);
  assert.ok(arc.includes(`- Their shared backstory: ${BACKSTORY}`), arc);
  const setup = userContent(1);
  assert.ok(setup.includes(`Table's party hook (why the group is together): ${HOOK}`), setup);
  assert.ok(setup.includes(`Table's shared party backstory: ${BACKSTORY}`), setup);
  // The setup pass reads them and never rewrites them.
  assert.equal(filled.campaign().gameSettings.partyHook, HOOK);
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

await test("Campaign setup stores the hook, and leaving it out stores blank", async () => {
  const world = await openWorld({ status: "lobby" });
  const campaignsRoute = await world.route("campaigns");
  world.signIn(world.owner);
  const withHook = await call(campaignsRoute, "POST", { title: "Hooked", gameSettings: { partyHook: ` ${HOOK} ` } });
  assert.equal(withHook.status, 201, JSON.stringify(withHook.json));
  assert.equal(campaigns.getCampaignById(withHook.json.campaign.id).gameSettings.partyHook, HOOK);
  const without = await call(campaignsRoute, "POST", { title: "Plain" });
  assert.equal(campaigns.getCampaignById(without.json.campaign.id).gameSettings.partyHook, "");
  world.close();
});

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
  const world = await openWorld({ status: "lobby", gameSettings: { partyHook: HOOK } });
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
  assert.ok(asked.includes(HOOK), asked);
  assert.equal(getParty(world.campaignId).backstory, "");
  world.close();
  model.close();
});

finish();
