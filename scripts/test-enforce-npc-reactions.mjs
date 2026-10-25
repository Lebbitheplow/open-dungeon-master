// A reaction roll decides how a stranger takes the party, once (issue 520).
// npc_reaction rolled again for anyone it was called on, so a friendly NPC
// the party knew could come out hostile. An NPC now carries when the party
// first dealt with them (npcs.met_at): the roll itself, a social check, a
// moment that moved their approval, an attitude the story shifted, or
// travelling with them. Only an NPC the party has not met whose attitude is
// still the default is rolled; anyone else is answered with how they feel.
//
// The rules, from the engine's own reaction table (src/lib/dm/social.ts):
// 2d6 of 5 or less is hostile, 9 or more friendly, between indifferent.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-npc-reactions");
const npcs = await import("../src/lib/db/npcs.ts");

const world = await openWorld();
const hero = world.addHero({ class: "bard", level: 3, abilities: { cha: 16 } });
const npc = (name) => npcs.getNpcByName(world.campaignId, name);
const react = async (name, faces) => {
  world.dice(...faces);
  const out = await world.invoke("npc_reaction", { name, gender: "Female" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return out.result;
};

await test("A stranger is rolled, and the roll is the meeting.", async () => {
  const out = await react("Marla", [6, 6]);
  assert.equal(out.attitude, "friendly");
  assert.ok(npc("Marla").metAt, "the roll did not mark her met");
});

await test("A second reaction for someone the party knows rolls nothing and keeps how they feel.", async () => {
  const again = await react("Marla", [1, 1]);
  assert.equal(again.rolled, false);
  assert.equal(again.attitude, "friendly");
  assert.equal(npc("Marla").attitude, "friendly", "a friend came out hostile");
  assert.match(again.note, /already knows the party and is friendly/);
});

await test("Someone registered before the party met them is rolled at the first meeting.", async () => {
  const set = await world.invoke("set_npc", { name: "Oswin", gender: "Male" });
  assert.equal(set.ok, true, set.error);
  assert.equal(npc("Oswin").metAt, "");
  const out = await react("Oswin", [1, 2]);
  assert.equal(out.attitude, "hostile");
  assert.equal(npc("Oswin").attitude, "hostile");
});

await test("An attitude set before the meeting (the story's villain, an author's patron) is not rolled over.", async () => {
  await world.invoke("set_npc", { name: "Captain Vex", attitude: "hostile", gender: "Female" });
  const out = await react("Captain Vex", [6, 6]);
  assert.equal(out.rolled, false);
  assert.equal(npc("Captain Vex").attitude, "hostile");
  assert.match(out.note, /already set before this meeting: hostile/);
  assert.ok(npc("Captain Vex").metAt, "meeting them now marks them met");
});

await test("A social check meets an indifferent stranger, so a reaction after it rolls nothing.", async () => {
  await world.invoke("set_npc", { name: "Tamsin", gender: "Female" });
  // A Persuasion of 12 against DC 15: no shift, but they have met.
  world.dice(12);
  const check = await world.invoke("social_check", { characterId: hero.id, npc: "Tamsin", approach: "persuade" });
  world.clearDice();
  assert.equal(check.ok, true, check.error);
  assert.equal(npc("Tamsin").attitude, "indifferent");
  const out = await react("Tamsin", [6, 6]);
  assert.equal(out.rolled, false);
  assert.equal(npc("Tamsin").attitude, "indifferent");
});

await test("A moment that moves an NPC's approval of a character marks them met.", async () => {
  await world.invoke("set_npc", { name: "Brother Aldo", gender: "Male" });
  const beat = await world.invoke("relationship_beat", { characterId: hero.id, subject: "Brother Aldo", beat: "helped", note: "carried him out of the fire" });
  assert.equal(beat.ok, true, beat.error);
  assert.ok(npc("Brother Aldo").metAt);
});

await test("Two rows merged into one person keep the earlier meeting.", async () => {
  await world.invoke("set_npc", { name: "Pell the Younger", gender: "Male" });
  const keep = npc("Pell the Younger");
  const merged = npcs.mergeNpcs(world.campaignId, keep.id, npc("Marla").id, ["Marla"]);
  assert.equal(merged.metAt, npc("Pell the Younger").metAt);
  assert.ok(merged.metAt);
});

finish();
