// WorldForge canon and lore visibility agree (audit WF-01). A lore entry
// whose world entry is not canon yet is held back from players however it was
// made, and published by making it canon, with no second step; an entry its
// author kept to the DM stays kept to the DM through a WorldForge file and
// back. The two reproduced cases from the audit's evidence are the first two
// tests.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-canon-privacy");
const { createWorldEntity, updateWorldEntity } = await import("../src/lib/db/world-forge.ts");
const { exportWorldForge, importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { listLoreEntries, updateLoreEntry } = await import("../src/lib/db/lore.ts");
const { loreVisibleTo } = await import("../src/lib/dm/world-lore-logic.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");

const world = await openWorld();
const owner = { id: world.owner.id };
const player = "a-player";
const lore = (campaignId, title) => listLoreEntries(campaignId).find((entry) => entry.title === title);
const playerReads = (campaignId, title) =>
  loreVisibleTo(listLoreEntries(campaignId), false, player).some((entry) => entry.title === title);
const dmReads = (campaignId, title) =>
  loreVisibleTo(listLoreEntries(campaignId), true, owner.id).some((entry) => entry.title === title);

function freshWorkshop(title) {
  return campaigns.createCampaign(owner.id, {
    title,
    description: "",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: {},
  }).id;
}

await test("A draft made in WorldForge is held back from players; the DM still reads it (WF-01 canon_visibility).", () => {
  const made = createWorldEntity(world.campaignId, { typeId: "t_other", name: "The Unwritten Pact", text: "Not settled yet.", canon: "draft" });
  assert.ok(made.entity?.ref, JSON.stringify(made));
  assert.equal(playerReads(world.campaignId, "The Unwritten Pact"), false, "a draft reached a player");
  assert.equal(dmReads(world.campaignId, "The Unwritten Pact"), true, "the DM lost a draft");
});

await test("Making it canon publishes it to the table, with no second step.", () => {
  const entry = lore(world.campaignId, "The Unwritten Pact");
  updateWorldEntity(world.campaignId, `lore:${entry.id}`, { canon: "canon" });
  assert.equal(playerReads(world.campaignId, "The Unwritten Pact"), true, "a canon entry for the table stayed hidden");
  updateWorldEntity(world.campaignId, `lore:${entry.id}`, { canon: "retired" });
  assert.equal(playerReads(world.campaignId, "The Unwritten Pact"), false, "a retired entry stayed readable");
});

await test("Canon kept to the DM stays private; alternate and draft ones are held back too.", () => {
  createWorldEntity(world.campaignId, { typeId: "t_other", name: "The True Heir", text: "Known to the DM.", canon: "canon" });
  updateLoreEntry(lore(world.campaignId, "The True Heir").id, { visibility: "dm" });
  createWorldEntity(world.campaignId, { typeId: "t_other", name: "The Other Telling", text: "A rival version.", canon: "alternate" });
  assert.equal(playerReads(world.campaignId, "The True Heir"), false);
  assert.equal(playerReads(world.campaignId, "The Other Telling"), false);
  assert.equal(dmReads(world.campaignId, "The True Heir"), true);
});

await test("A DM-only canon entry stays DM-only through a WorldForge file and back (WF-01 canon_private_lore_file_roundtrip).", () => {
  const file = exportWorldForge(world.campaignId);
  const target = freshWorkshop("Round trip");
  const result = importWorldForge(target, owner, JSON.parse(JSON.stringify(file)));
  assert.ok(!("error" in result), result.error);
  assert.equal(lore(target, "The True Heir")?.visibility, "dm", "a DM-only entry came back for the table");
  assert.equal(playerReads(target, "The True Heir"), false, "a DM-only entry reached a player after the round trip");
  // A canon entry written for the table is still the table's, and a draft
  // still a draft.
  createWorldEntity(world.campaignId, { typeId: "t_other", name: "The Harbour Song", text: "Everyone knows it.", canon: "canon" });
  const again = freshWorkshop("Round trip two");
  importWorldForge(again, owner, JSON.parse(JSON.stringify(exportWorldForge(world.campaignId))));
  assert.equal(playerReads(again, "The Harbour Song"), true, "a table entry was hidden by the round trip");
  assert.equal(playerReads(again, "The Other Telling"), false, "an alternate entry reached a player after the round trip");
});

finish();
