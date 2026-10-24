// The lore check's evidence follows the seat that runs it. Any member may
// flag a passage, and the checker quotes its evidence back verbatim in its
// citations, so the evidence it is given is the asker's to read: a plain
// player's check sees party facts, their own characters' facts and the
// record; the lead who steers an AI table also sees the DM's secrets (as
// ?secrets=1 shows them) but never the storyteller's (src/lib/dm/viewer.ts);
// a person running the table sees what ?secrets=1 shows them, the
// storyteller's own secrets included. An NPC's goals and ambitions
// are the DM's side of a tone check, and stay out of a player's.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-lore-check-secrets");
const facts = await import("../src/lib/db/facts.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const messages = await import("../src/lib/db/messages.ts");

const VERDICT = JSON.stringify({ verdict: "consistent", explanation: "It matches the record.", citations: [], rewrite: null });
const model = await fakeModel();

// What the checker was handed for one check, as the seat named runs it.
async function evidenceFor(table, user, category = "wrong_fact") {
  const narration = messages.insertCampaignMessage({
    campaignId: table.campaignId,
    seq: campaigns.allocateSeq(table.campaignId),
    authorType: "dm",
    content: "Marla waves from the bridge, Ilse at her side.",
  });
  model.script([reply({ text: VERDICT })]);
  table.signIn(user);
  const route = await table.route("campaigns/[campaignId]/lore-check");
  const response = await route.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ messageId: narration.id, category, ...(category === "wrong_fact" ? {} : { npcName: "Marla" }) }) }),
    { params: Promise.resolve({ campaignId: table.campaignId }) },
  );
  await settleQueue(table.campaignId);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const asked = model.requests.at(-1);
  return asked.messages.map((message) => String(message.content ?? "")).join("\n");
}

function seed(table, hero) {
  const add = (fact, knownBy) => facts.insertFact({ campaignId: table.campaignId, category: "npc", subject: "Marla", fact, knownBy, pinned: true, source: "manual" });
  add("Marla keeps the bridge toll.", "party");
  add("Marla is secretly the smugglers' fence.", "dm");
  add("Marla's kindness to Kael is an act for the guild.", "storyteller");
  add("Kael alone saw Marla burn the letter.", [hero.id]);
}

// ---- an AI table ----

const world = await openWorld();
model.pointAt(world);
// The owner leads this AI table and plays Bram.
world.addHero({ name: "Bram" });
const kaelUser = world.addUser("kael");
const kael = world.addHero({ user: kaelUser, name: "Kael" });
const nysaUser = world.addUser("nysa");
world.addHero({ user: nysaUser, name: "Nysa" });
seed(world, kael);
await world.invoke("set_npc", { name: "Marla", attitude: "friendly", trait: "Toll keeper", goal: "own the river trade" });

await test("a plain player's check is handed party facts and their own, never a DM or storyteller secret", async () => {
  const nysa = await evidenceFor(world, nysaUser);
  assert.match(nysa, /Marla keeps the bridge toll/);
  assert.doesNotMatch(nysa, /smugglers' fence/, "no DM secret");
  assert.doesNotMatch(nysa, /an act for the guild/, "no storyteller secret");
  assert.doesNotMatch(nysa, /burn the letter/, "not another character's private fact");
  const kaelSees = await evidenceFor(world, kaelUser);
  assert.match(kaelSees, /burn the letter/, "a character's own fact is their player's");
  assert.doesNotMatch(kaelSees, /smugglers' fence/);
});

await test("the lead who steers an AI table is handed the DM's secrets, as ?secrets=1 shows them, never the storyteller's", async () => {
  const lead = await evidenceFor(world, world.owner);
  assert.match(lead, /smugglers' fence/);
  assert.doesNotMatch(lead, /an act for the guild/);
});

await test("a tone check gives a player an NPC's manner, and the lead their goals too", async () => {
  const nysa = await evidenceFor(world, nysaUser, "out_of_character");
  assert.match(nysa, /Marla: friendly, Toll keeper/);
  assert.doesNotMatch(nysa, /river trade/, "no goals for a player");
  const lead = await evidenceFor(world, world.owner, "out_of_character");
  assert.match(lead, /river trade/);
});

// ---- a table a person runs ----

await test("a person running the table is handed the DM's and the storyteller's secrets; its lead is a player", async () => {
  const table = await openWorld({ gameSettings: { dmMode: "human" } });
  model.pointAt(table);
  const leadUser = table.addUser("lead");
  const hero = table.addHero({ user: leadUser, name: "Kael" });
  seed(table, hero);
  const dm = await evidenceFor(table, table.owner);
  assert.match(dm, /smugglers' fence/);
  assert.match(dm, /an act for the guild/);
  assert.doesNotMatch(dm, /burn the letter/, "a character's private fact is their player's, as in ?secrets=1");
  const player = await evidenceFor(table, leadUser);
  assert.doesNotMatch(player, /smugglers' fence|an act for the guild/);
  assert.match(player, /burn the letter/);
});

model.close();
finish();
