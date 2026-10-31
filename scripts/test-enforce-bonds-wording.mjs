// What the engine writes where the table reads its bonds (issue 644): the
// Bonds tab's memory lines, the first-move card's quote, the Log's
// milestones, the pinned vow and the table note time leaves. Found in two
// romance playtests: "asked for married", a memory cut mid-word, the NPC's
// words in two sets of quotes, and "..." where a GM's reason ended in its
// own full stop.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-bonds-wording");
const relationships = await import("../src/lib/db/relationships.ts");
const proposals = await import("../src/lib/db/item-proposals.ts");
const messages = await import("../src/lib/db/messages.ts");
const facts = await import("../src/lib/db/facts.ts");
const { setOpenToAdvances } = await import("../src/lib/db/sheets.ts");

const world = await openWorld({ gameSettings: { dmMode: "human" } });
const player = world.addUser("tamsin");
const tamsin = world.addHero({ user: player, name: "Tamsin", gender: "Female", attraction: { genders: ["Male"], note: "" } });
await world.invoke("set_npc", { name: "Hollis", gender: "Male", attitude: "friendly", drawnTo: ["women"] });
await world.invoke("set_npc", { name: "Lucan", gender: "Male", attitude: "friendly", drawnTo: ["women"] });

function bond(subject, patch) {
  const row = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: tamsin.id, characterName: "Tamsin", subjectKind: "npc", subjectName: subject });
  return relationships.patchRelationship(row.id, patch);
}
const lastMemory = (subject) => relationships.getRelationship(world.campaignId, tamsin.id, subject).memories.at(-1).text;

await test("a refused step reads as words, not the rung's name", async () => {
  const steps = [
    ["none", "interested", 40, "Hollis was not ready to return Tamsin's interest"],
    ["interested", "courting", 55, "Hollis was not ready when Tamsin asked to court them"],
    ["courting", "together", 70, "Hollis was not ready when Tamsin asked to be partners"],
    ["together", "betrothed", 85, "Hollis was not ready when Tamsin asked to be betrothed"],
    ["betrothed", "married", 95, "Hollis was not ready when Tamsin asked to marry them"],
  ];
  for (const [from, to, approval, text] of steps) {
    bond("Hollis", { romance: from, approval, lastShiftTurn: "" });
    // The lowest die: a step short of certain is refused.
    world.dice(1);
    const out = await world.invoke("romance_advance", { characterId: tamsin.id, subject: "Hollis", to });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.accepted, false, `${to} was refused`);
    assert.doesNotMatch(out.result.note, /enough for (interested|courting|together|betrothed|married)/);
    assert.equal(lastMemory("Hollis"), text);
  }
});

await test("a memory too long for the card ends at a word, with an ellipsis", async () => {
  bond("Lucan", { approval: 20 });
  const note =
    "Tamsin intervened calmly to spare hungry Ned a flogging, asked that Lucan settle the recovered record's attempted theft, and promised to accompany Ned to seek a fair hearing at dawn.";
  const out = await world.invoke("relationship_beat", { characterId: tamsin.id, subject: "Lucan", beat: "defended", note });
  assert.equal(out.ok, true, out.error);
  const text = lastMemory("Lucan");
  assert.ok(text.length <= 160, `bounded (${text.length})`);
  assert.ok(text.endsWith("…"), `marked as cut: ${text}`);
  assert.ok(note.startsWith(text.slice(0, -1)), "the start of the note, as written");
  assert.match(note.slice(text.length - 1), /^\s/, "cut between words, never inside one");
});

await test("an NPC's first move keeps their words bare, for the card to quote once", async () => {
  bond("Lucan", { approval: 60, lastShiftTurn: "" });
  setOpenToAdvances(tamsin.id, true);
  const out = await world.invoke("romance_advance", {
    characterId: tamsin.id,
    subject: "Lucan",
    to: "courting",
    initiator: "npc",
    note: "\"“I'm fond of you, Tamsin. Would you welcome that?”\"",
  });
  assert.equal(out.ok, true, out.error);
  const offer = proposals.listOpenItemProposals(world.campaignId).find((row) => row.toolName === "romance_advance");
  assert.ok(offer, "a pending advance");
  assert.equal(offer.reason, "I'm fond of you, Tamsin. Would you welcome that?");
});

await test("a vow's pinned fact and the time line never end in two full stops", async () => {
  bond("Hollis", { romance: "together", approval: 100, lastShiftTurn: "" });
  world.dice(20);
  const out = await world.invoke("romance_advance", { characterId: tamsin.id, subject: "Hollis", to: "betrothed", note: "Under the rose arch at dusk." });
  world.clearDice();
  assert.equal(out.result.accepted, true, out.error ?? out.result.note);
  const vow = facts.listActiveFacts(world.campaignId).find((fact) => fact.fact.includes("were betrothed"));
  assert.equal(vow?.fact, "Tamsin and Hollis were betrothed: Under the rose arch at dusk.");

  const passed = await world.invoke("pass_time", { amount: 1, unit: "hours", reason: "Lifting the cart with the plank and shield." });
  assert.equal(passed.ok, true, passed.error);
  const line = messages.listRecentMessages(world.campaignId, 5).map((row) => row.content).find((content) => content.includes("passes"));
  assert.match(line, /passes: Lifting the cart with the plank and shield\. It is now /);
  assert.doesNotMatch(line, /\.\./);
  await world.invoke("pass_time", { amount: 1, unit: "hours" });
  const bare = messages.listRecentMessages(world.campaignId, 5).map((row) => row.content).filter((content) => content.includes("passes")).at(-1);
  assert.match(bare, /^1 hour passes\. It is now /);
});

finish();
