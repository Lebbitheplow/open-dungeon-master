// A held roll carrier is spent by the roll it rides, on every roll path.
//
// SRD 5.1: a Bardic Inspiration die is added to one ability check, attack
// roll or saving throw and is then gone; the Help action gives advantage on
// the next ability check; Guidance adds a d4 to one ability check. ODM holds
// each as a condition on the sheet ("bardic inspiration (d8)", "helped",
// "guidance"), and resolveRollExpression folds it into the roll and names it
// in spendInspiration. The first repair spent it on request_roll and
// group_check; the other doors that roll a character's check or save rolled
// the die and kept the carrier, so one die rode every roll after it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-roll-carriers");
const world = await openWorld();

const profs = (skills = []) => ({
  saves: [], skills, expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [],
});
const INSPIRED = "bardic inspiration (d8)";
const hold = (id, condition = INSPIRED) => world.patch(id, { conditions: [condition], conditionMeta: {} });
const holds = (id, condition = INSPIRED) => world.sheet(id).conditions.includes(condition);
const d8Rolled = () => world.diceLog().some((die) => die.sides === 8);

const bard = world.addHero({ class: "bard", level: 5, abilities: { cha: 16 }, proficiencies: profs(["persuasion", "medicine"]) });

await test("A Bardic Inspiration die held by a character is spent by the social_check it rides.", async () => {
  await world.invoke("set_npc", { name: "Guard Captain", attitude: "indifferent" });
  hold(bard.id);
  world.diceLog();
  world.dice(10, 8);
  const out = await world.invoke("social_check", { characterId: bard.id, npc: "Guard Captain", approach: "persuade" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(d8Rolled(), "the inspiration die did not ride the check");
  assert.equal(holds(bard.id), false, "the die is still held after the check");
});

await test("A Bardic Inspiration die held by a character is spent by the haggling check it rides.", async () => {
  const opened = await world.invoke("open_shop", { name: "Marla's Sundries", kind: "general", size: "town" });
  assert.equal(opened.ok, true, opened.error);
  hold(bard.id);
  world.diceLog();
  world.dice(10, 8);
  const out = await world.invoke("haggle", { characterId: bard.id, shop: "Marla's Sundries" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(d8Rolled());
  assert.equal(holds(bard.id), false);
});

await test("A Bardic Inspiration die held by a character is spent by the relationship beat's check it rides.", async () => {
  hold(bard.id);
  world.diceLog();
  world.dice(10, 8);
  const out = await world.invoke("relationship_beat", { characterId: bard.id, subject: "Guard Captain", beat: "gift" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(d8Rolled());
  assert.equal(holds(bard.id), false);
});

await test("A Bardic Inspiration die held by the healer is spent by the Medicine check that stabilizes a dying friend.", async () => {
  const fallen = world.addHero({ class: "fighter", level: 5 });
  world.patch(fallen.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  hold(bard.id);
  world.diceLog();
  world.dice(10, 8);
  const out = await world.invoke("stabilize", { characterId: fallen.id, healerId: bard.id, method: "check" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(d8Rolled());
  assert.equal(holds(bard.id), false);
});

await test("A Bardic Inspiration die held by a traveller is spent by the first forced-march save it rides.", async () => {
  const walker = world.addHero({ class: "fighter", level: 3 });
  hold(walker.id);
  world.diceLog();
  world.dice(15, 8, 15, 15, 15);
  await world.invoke("travel", { hours: 12, pace: "normal", characterIds: [walker.id] });
  world.clearDice();
  assert.ok(d8Rolled());
  assert.equal(holds(walker.id), false);
});

await test("a held Help is spent by the social check it rides, and not by the one after", async () => {
  hold(bard.id, "helped");
  world.dice(3, 3);
  await world.invoke("social_check", { characterId: bard.id, npc: "Guard Captain", approach: "persuade" });
  world.clearDice();
  assert.equal(holds(bard.id, "helped"), false);
});

world.close();
finish();
