// Life between adventures, as SRD 5.1 (Between Adventures, Expenses) states
// it and the engine holds it: a lifestyle paid for each day in town, and the
// downtime activities with their costs, progress and results.
//
//   Lifestyle Expenses: wretched free, squalid 1 sp, poor 2 sp, modest 1 gp,
//     comfortable 2 gp, wealthy 4 gp, aristocratic 10 gp a day.
//   Crafting: 5 gp of market value a day, raw materials half the value, the
//     tools' proficiency required; a modest lifestyle free while crafting.
//   Practicing a Profession: a modest lifestyle without paying.
//   Recuperating: after three days a DC 15 CON save; a success gives
//     advantage on saves against a disease or poison for 24 hours.
//   Researching: 1 gp a day. Training: 250 days at 1 gp a day for a
//     language or a tool.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-downtime");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const { lifestyleLine } = await import("../src/lib/dm/lifestyle.ts");

const purse = (id) => world.sheet(id).gold * 100 + (world.sheet(id).copper ?? 0);
const profs = (extra = {}) => ({ saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [], ...extra });

await test("A modest lifestyle costs 1 gp at each dawn that passes in town; with none chosen nothing is charged.", async () => {
  const townie = world.addHero({ class: "fighter", level: 1, gold: 10 });
  const wanderer = world.addHero({ class: "fighter", level: 1, gold: 10 });
  const set = await world.invoke("set_lifestyle", { characterIds: [townie.id], lifestyle: "modest" });
  assert.equal(set.ok, true, set.error);
  await world.invoke("pass_time", { amount: 2, unit: "days" });
  assert.equal(purse(townie.id), 800);
  assert.equal(purse(wanderer.id), 1000);
  assert.match(lifestyleLine(world.campaignId, townie.id) ?? "", /lifestyle modest/);
  await world.invoke("set_lifestyle", { characterIds: [townie.id], lifestyle: "none" });
});

await test("A purse that cannot keep up its lifestyle lives the best it can pay for.", async () => {
  const spendthrift = world.addHero({ class: "fighter", level: 1, gold: 0, copper: 50 });
  await world.invoke("set_lifestyle", { characterIds: [spendthrift.id], lifestyle: "wealthy" });
  const out = await world.invoke("pass_time", { amount: 1, unit: "days" });
  assert.equal(purse(spendthrift.id), 30, "a day cost more than a poor lifestyle's 2 sp");
  assert.match(JSON.stringify(out.result.lifestyle ?? []), /lives poor/);
  await world.invoke("set_lifestyle", { characterIds: [spendthrift.id], lifestyle: "none" });
});

await test("Practicing a profession keeps a modest lifestyle without paying; the clock moves by the days.", async () => {
  const smith = world.addHero({ class: "fighter", level: 1, gold: 10 });
  await world.invoke("set_lifestyle", { characterIds: [smith.id], lifestyle: "modest" });
  const before = world.campaign().clock.instant;
  const out = await world.invoke("downtime", { days: 3, characterId: smith.id, activity: "profession" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.campaign().clock.instant - before, 3 * 1440);
  assert.equal(purse(smith.id), 1000);
  await world.invoke("set_lifestyle", { characterIds: [smith.id], lifestyle: "none" });
});

await test("Crafting needs proficiency with the tools: refused without it, and no time passes.", async () => {
  const clumsy = world.addHero({ class: "fighter", level: 1, gold: 100 });
  const before = world.campaign().clock.instant;
  const out = await world.invoke("downtime", { days: 2, characterId: clumsy.id, activity: "crafting", item: "Shield", tool: "smith's tools" });
  assert.equal(out.ok, false);
  assert.equal(world.campaign().clock.instant, before);
});

if (world.hasPack) {
  await test("Crafting a 10 gp shield: 5 gp of raw materials up front, 5 gp of work a day, and the shield in the pack after two days.", async () => {
    const crafter = world.addHero({ class: "fighter", level: 1, gold: 100, proficiencies: profs({ tools: ["Smith's tools"] }) });
    const first = await world.invoke("downtime", { days: 1, characterId: crafter.id, activity: "crafting", item: "Shield", tool: "smith's tools" });
    assert.equal(first.ok, true, first.error);
    assert.equal(purse(crafter.id), 9500);
    assert.equal(world.sheet(crafter.id).equipment.some((item) => item.name === "Shield"), false);
    await world.invoke("downtime", { days: 1, characterId: crafter.id, activity: "crafting", item: "Shield", tool: "smith's tools" });
    assert.equal(world.sheet(crafter.id).equipment.some((item) => item.name === "Shield"), true);
    assert.equal(purse(crafter.id), 9500, "finishing cost more than the materials");
  });
}

await test("Training takes 250 days at 1 gp a day and then teaches the language.", async () => {
  const student = world.addHero({ class: "wizard", level: 1, gold: 300 });
  await world.invoke("downtime", { days: 200, characterId: student.id, activity: "training", subject: "Elvish", kind: "language" });
  assert.equal(world.sheet(student.id).proficiencies.languages.includes("Elvish"), false);
  assert.match(lifestyleLine(world.campaignId, student.id) ?? "", /Elvish 200\/250/);
  await world.invoke("downtime", { days: 50, characterId: student.id, activity: "training", subject: "Elvish", kind: "language" });
  assert.equal(world.sheet(student.id).proficiencies.languages.includes("Elvish"), true);
  assert.equal(purse(student.id), 5000);
});

await test("Research costs 1 gp a day and keeps count of the days.", async () => {
  const sage = world.addHero({ class: "wizard", level: 1, gold: 10 });
  await world.invoke("downtime", { days: 4, characterId: sage.id, activity: "research", topic: "the lich's phylactery" });
  assert.equal(purse(sage.id), 600);
  assert.match(lifestyleLine(world.campaignId, sage.id) ?? "", /phylactery \(4 days\)/);
});

await test("Three days recuperating earn a DC 15 CON save, and a success gives advantage against the disease for 24 hours.", async () => {
  const invalid = world.addHero({ class: "fighter", level: 3, abilities: { con: 10 } });
  world.clearDice();
  world.dice(15);
  const out = await world.invoke("downtime", { days: 3, characterId: invalid.id, activity: "recuperating" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(invalid.id).conditions.includes("recuperated"), true);
});

await test("Downtime is refused while a fight runs.", async () => {
  const soldier = world.addHero({ class: "fighter", level: 3 });
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  const out = await world.invoke("downtime", { days: 1, characterId: soldier.id, activity: "profession" });
  await world.invoke("end_encounter", { outcome: "truce" });
  assert.equal(out.ok, false);
});

world.close();
finish();
