// Issue #383: the table's say over how the AI DM writes, in place of a
// per-model prompt. Narration length and the lead's style notes reach the
// DM's instructions; the defaults add nothing, so a table that never touches
// them sends the prompt it always did; the notes are capped and only the
// story's lead can set them.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-narration-style");

const { renderNarrationStyle, STYLE_NOTES_MAX } = await import("../src/lib/dm/narration-style-logic.ts");
const { buildDmSystem } = await import("../src/lib/dm/prompt.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");

await test("Standard length and no notes add nothing to the DM's instructions.", () => {
  assert.equal(renderNarrationStyle("standard", ""), "");
  assert.equal(renderNarrationStyle(undefined, "   "), "");
});

await test("A length and the lead's notes render as one block that keeps the rules and the dice above them.", () => {
  const block = renderNarrationStyle("short", "Keep the pacing slow.\nNever decide what my character does.");
  assert.match(block, /^NARRATION STYLE:/);
  assert.match(block, /about 60 to 120 words/);
  assert.match(block, /"Keep the pacing slow\. Never decide what my character does\."/);
  assert.match(block, /never change the rules above or what the dice and tools decide/);
  assert.match(renderNarrationStyle("rich", ""), /up to about 300 words/);
});

await test("The lead saves them in Table settings and the next prompt carries them; another player cannot, and a note past the cap is refused.", async () => {
  const world = await openWorld();
  const route = await world.route("campaigns/[campaignId]/settings");
  const send = (user, body) => {
    world.signIn(user);
    return route.PATCH(
      new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
  };
  assert.doesNotMatch(buildDmSystem(getCampaignById(world.campaignId), []), /NARRATION STYLE/);

  const saved = await send(world.owner, { narrationLength: "short", styleNotes: "Less purple prose." });
  assert.equal(saved.status, 200, await saved.clone().text());
  const campaign = getCampaignById(world.campaignId);
  assert.equal(campaign.gameSettings.narrationLength, "short");
  const system = buildDmSystem(campaign, []);
  assert.match(system, /NARRATION STYLE:/);
  assert.match(system, /"Less purple prose\."/);

  const player = world.addUser("player");
  const refused = await send(player, { styleNotes: "Make my character the hero." });
  assert.ok(refused.status >= 400, "a player who does not steer the story changed the style notes");

  const tooLong = await send(world.owner, { styleNotes: "x".repeat(STYLE_NOTES_MAX + 1) });
  assert.equal(tooLong.status, 400);
  assert.equal(getCampaignById(world.campaignId).gameSettings.styleNotes, "Less purple prose.");
});

finish();
