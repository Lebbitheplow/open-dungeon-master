// A hand-built monster in a prepared roster (src/lib/bestiary rosterLabel,
// src/lib/dm/encounter-templates.ts templateDifficulty): a roster line names
// a monster by its own name only when that name finds it again. A homebrew
// construct its author called "Bandit" is written by its ref
// ("homebrew:<id>"), because the name would deploy the rulebook bandit, and
// the rows that list the roster show its name from the readout, never the
// ref. Found by M6's journey 62 (PR 497): the roster picker deployed the
// rulebook bandit, and the console's row read "homebrew:...".
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-roster-homebrew-names");
const world = await openWorld();
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { rosterLabel } = await import("../src/lib/bestiary/index.ts");
const { templateDifficulty } = await import("../src/lib/dm/encounter-templates.ts");
const { rosterSummary } = await import("../src/lib/dm/encounter-template-logic.ts");

const named = (name, type) => {
  const draft = draftFromCr(name, 1);
  return createHomebrewMonster(world.owner.id, { ...draft, stats: { ...draft.stats, type } }, "");
};
const bandit = named("Bandit", "construct");
const sentinel = named("Brassbound Tidewarden", "construct");
const authors = { userIds: [world.owner.id] };

await test("a homebrew monster whose name is a rulebook monster's is written by its ref; one with a name of its own, by name", () => {
  const setting = world.campaign().gameSettings;
  assert.equal(rosterLabel(bandit.slug, "Bandit", setting, authors), bandit.slug, "the name would deploy the rulebook bandit");
  assert.equal(rosterLabel(sentinel.slug, "Brassbound Tidewarden", setting, authors), "Brassbound Tidewarden");
});

await test("the DM's monster search says what a roster line calls each of the DM's own monsters", async () => {
  const route = await world.route("campaigns/[campaignId]/dm/bestiary");
  const campaigns = await import("../src/lib/db/campaigns.ts");
  // The console's search answers the person in the DM seat.
  campaigns.setDmMode(world.campaignId, "human", world.owner.id);
  world.signIn(world.owner);
  let body;
  try {
    const response = await route.GET(new Request(`http://odm.test/?q=band`), { params: Promise.resolve({ campaignId: world.campaignId }) });
    assert.equal(response.status, 200);
    body = await response.json();
  } finally {
    campaigns.setDmMode(world.campaignId, "ai", world.owner.id);
  }
  const rosterName = (slug) => body.monsters.find((monster) => monster.slug === slug)?.rosterName;
  assert.equal(rosterName(bandit.slug), bandit.slug);
  assert.equal(rosterName(sentinel.slug), "Brassbound Tidewarden");
});

await test("the readout names a hand-built monster its roster row carries by ref, and the row shows the name", () => {
  const enemies = [{ monster: bandit.slug, count: 2 }, { monster: "goblin", count: 1 }];
  const readout = templateDifficulty(world.campaign(), enemies);
  assert.equal(readout.unknownMonster, null, "the ref resolves to the homebrew bandit");
  assert.deepEqual(readout.names, { [bandit.slug]: "Bandit" });
  assert.equal(rosterSummary(enemies, readout.names), "Bandit x2, goblin");
  assert.doesNotMatch(rosterSummary(enemies, readout.names), /homebrew:/);
});

finish();
