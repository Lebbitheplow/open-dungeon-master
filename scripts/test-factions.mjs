// Factions (docs/vtt-parity-implementation-plan.md section 6): the party's
// standing bends a member's social DC, goals advance on the chapter tick
// with power drifting alongside, and the content import carries factions
// with each member's link renumbered.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-factions-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const {
  advanceFactionGoals,
  clampReputation,
  factionsNamedBy,
  normalizeReputation,
  renderFactionsForPrompt,
  reputationDcOffset,
  reputationLabel,
} = await import("../src/lib/dm/faction-logic.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { insertFaction, listFactions, getFaction, deleteFaction } = await import("../src/lib/db/factions.ts");
const { handleAdjustReputation, handleFactionNote, shiftFactionPower } = await import("../src/lib/dm/faction-tools.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const { createNpcFromDraft, listNpcs } = await import("../src/lib/db/npcs.ts");
const { blankDraft } = await import("../src/lib/npcs/forge.ts");
const { runContentImport } = await import("../src/lib/db/content-import.ts");
const { listActiveFacts: listFacts } = await import("../src/lib/db/facts.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("standing bends the DC one point per step, clamped to the ladder", () => {
  assert.equal(reputationDcOffset(0), 0);
  assert.equal(reputationDcOffset(3), -3);
  assert.equal(reputationDcOffset(-2), 2);
  assert.equal(reputationDcOffset(99), -5);
  assert.equal(clampReputation(-40), -5);
  assert.equal(reputationLabel(5), "honoured");
  assert.equal(reputationLabel(-5), "hunted");
});

test("reputation records tolerate junk", () => {
  assert.deepEqual(normalizeReputation(undefined), {});
  assert.deepEqual(normalizeReputation({ a: 3, b: "x", c: 12 }), { a: 3, c: 5 });
});

const factions = [
  { id: "f1", campaignId: "c", name: "The Reed Court", blurb: "Marsh lords", goal: "Own the ferry", attitude: "wary", power: 2, tags: [], portraitPath: "", createdAt: "", updatedAt: "" },
  { id: "f2", campaignId: "c", name: "Salt Guild", blurb: "", goal: "", attitude: "neutral", power: 3, tags: [], portraitPath: "", createdAt: "", updatedAt: "" },
];

test("the chapter tick advances only factions with a goal, on a background die", () => {
  const gained = advanceFactionGoals(factions, () => 0.1);
  assert.equal(gained.length, 1);
  assert.equal(gained[0].faction.id, "f1");
  assert.equal(gained[0].power, 3);
  assert.match(gained[0].fact, /gained ground/);
  const lost = advanceFactionGoals(factions, () => 0.95);
  assert.equal(lost[0].power, 1);
  assert.match(lost[0].fact, /setback/);
  assert.equal(advanceFactionGoals(factions, () => 0.5).length, 0);
});

test("an arc names a faction when its name appears", () => {
  assert.deepEqual(factionsNamedBy("The salt guild moves on the ferry", factions).map((faction) => faction.id), ["f2"]);
  assert.deepEqual(factionsNamedBy("Nobody here", factions), []);
});

test("the prompt block keeps goal and power for the DM alone", () => {
  const dm = renderFactionsForPrompt(factions, { f1: -2 }, true);
  assert.match(dm, /GOAL \(DM-only\): Own the ferry/);
  assert.match(dm, /power 2\/5/);
  assert.match(dm, /the party is .* to them, -2/);
  const player = renderFactionsForPrompt(factions, { f1: -2 }, false);
  assert.doesNotMatch(player, /GOAL/);
  assert.doesNotMatch(player, /power/);
  assert.equal(renderFactionsForPrompt([], {}, true), "");
});

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });
const court = insertFaction(campaign.id, { name: "The Reed Court", goal: "Own the ferry", attitude: "wary", power: 2, tags: ["marsh", ""] });

test("a faction is stored normalised", () => {
  assert.equal(court.attitude, "wary");
  assert.deepEqual(court.tags, ["marsh"]);
  assert.equal(listFactions(campaign.id).length, 1);
});

test("adjust_reputation moves the party's standing and remembers why", () => {
  const first = handleAdjustReputation(campaign, JSON.stringify({ faction: "reed court", delta: 2, reason: "They returned the ferryman's son." }));
  assert.equal(first.ok, true);
  assert.equal(first.after, 2);
  assert.equal(getParty(campaign.id).reputation[court.id], 2);
  const capped = handleAdjustReputation(campaign, JSON.stringify({ faction: court.id, delta: 2, reason: "" }));
  assert.equal(capped.after, 4);
  assert.ok(listFacts(campaign.id).some((fact) => /standing with The Reed Court rose/.test(fact.fact)));
  assert.match(String(handleAdjustReputation(campaign, JSON.stringify({ faction: "Nobody", delta: 1 })).error), /No faction/);
});

test("faction_note lands as a fact, secret when asked", () => {
  handleFactionNote(campaign, JSON.stringify({ faction: "The Reed Court", note: "They fear the tide.", secret: true }));
  const fact = listFacts(campaign.id).find((entry) => entry.fact === "They fear the tide.");
  assert.ok(fact);
  assert.equal(fact.knownBy, "dm");
});

test("power shifts are clamped and recorded", () => {
  shiftFactionPower(campaign.id, court.id, 9, "The Reed Court took the ferry.");
  assert.equal(getFaction(court.id).power, 5);
});

const marla = createNpcFromDraft(campaign.id, { ...blankDraft(), name: "Marla", factionId: court.id });
const pike = createNpcFromDraft(campaign.id, { ...blankDraft(), name: "Old Pike" });

test("members carry their faction", () => {
  assert.equal(marla.factionId, court.id);
  assert.equal(pike.factionId, "");
});

const target = createCampaign(dm.id, { title: "Target", description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });
const outcome = runContentImport({ sourceId: campaign.id, campaignId: target.id, selection: ["npcs"], houseRulesMode: "replace" });

test("the import copies factions with every member's link renumbered", () => {
  assert.ok(!outcome.error, outcome.error);
  const copied = listFactions(target.id);
  assert.equal(copied.length, 1);
  assert.notEqual(copied[0].id, court.id);
  assert.equal(copied[0].goal, "Own the ferry");
  const npcs = listNpcs(target.id);
  assert.equal(npcs.find((npc) => npc.name === "Marla").factionId, copied[0].id);
  assert.equal(npcs.find((npc) => npc.name === "Old Pike").factionId, "");
});

test("deleting a faction frees its members", () => {
  deleteFaction(court.id);
  assert.equal(listNpcs(campaign.id).find((npc) => npc.name === "Marla").factionId, "");
});

console.log(`factions: ${passed} tests passed`);
removeTempDir(dir);
