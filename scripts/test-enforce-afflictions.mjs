// Diseases, madness and poisons, as the SRD 5.1 Running the Game chapter
// states them, held by the engine through the afflict tool, the clock, the
// long rest and damage.
//
//   Sewer Plague: DC 11 CON or infected; 1d4 days to symptoms; a level of
//     exhaustion, hit dice heal half, a long rest restores no hit points;
//     after each long rest a DC 11 CON save adds or removes a level, cured
//     below 1.
//   Cackle Fever: a level of exhaustion no rest removes; great stress (a
//     fight, damage) is a DC 13 CON save or 1d10 psychic and a minute of
//     mad laughter (incapacitated); a DC 13 CON save after each long rest
//     lowers the DC by 1d6, cured at 0.
//   Sight Rot: -1 to attack rolls and sight checks, 1 worse after each long
//     rest; Eyebright ointment before a rest stops the worsening.
//   Madness: short-term 1d10 minutes, long-term 1d10 x 10 hours, indefinite
//     a flaw, each rolled on its d100 table; lesser restoration ends a
//     short- or long-term madness.
//   Poisons: the listed DC, damage and conditions; Serpent Venom 3d6 (half
//     on a success), Drow Poison unconscious on a failure by 5 or more,
//     Midnight Tears at midnight, Pale Tincture a save every 24 hours.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-afflictions");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);
const { afflictionLines } = await import("../src/lib/dm/between-lines.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");

const has = (id, name) => world.sheet(id).conditions.map((entry) => entry.toLowerCase()).includes(name);
const afflict = (args, faces = []) => {
  world.clearDice();
  world.dice(...faces);
  return world.invoke("afflict", args).finally(() => world.clearDice());
};
const days = (amount) => world.invoke("pass_time", { amount, unit: "days" });
const longRest = async (faces = []) => {
  await days(1);
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("take_rest", { kind: "long" });
  world.clearDice();
  return out;
};

// ---- sewer plague ----

const sick = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { con: 10 } });

await test("Sewer Plague: a failed DC 11 CON save infects, symptoms show after 1d4 days with a level of exhaustion.", async () => {
  const out = await afflict({ characterId: sick.id, kind: "disease", name: "Sewer Plague" }, [1, 2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(has(sick.id, "sewer plague"), false, "symptoms showed before the incubation");
  await days(1);
  assert.equal(has(sick.id, "sewer plague"), false);
  await days(1);
  assert.equal(has(sick.id, "sewer plague"), true);
  assert.equal(world.sheet(sick.id).exhaustion, 1);
});

await test("Sewer Plague: a long rest restores no hit points, a failed save adds a level, and a success below 1 cures it.", async () => {
  world.patch(sick.id, { currentHp: 20 });
  // The rest's own level comes off (1 to 0), the failed save puts one back.
  const rested = await longRest([1]);
  assert.equal(rested.ok, true, rested.error);
  assert.equal(world.sheet(sick.id).currentHp, 20, "the long rest restored hit points");
  assert.equal(world.sheet(sick.id).exhaustion, 1);
  await longRest([20]);
  assert.equal(world.sheet(sick.id).exhaustion, 0);
  assert.equal(has(sick.id, "sewer plague"), false, "a success below 1 did not cure it");
});

await test("Sewer Plague: spent hit dice heal half.", async () => {
  const patient = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { con: 10 }, hitDice: { die: "d10", total: 5, spent: 0 } });
  await afflict({ characterId: patient.id, kind: "disease", name: "sewer plague", save: false, symptomsNow: true });
  world.patch(patient.id, { currentHp: 10 });
  world.clearDice();
  world.dice(8);
  await world.invoke("take_rest", { kind: "short", spend: [{ characterId: patient.id, dice: 1 }] });
  world.clearDice();
  assert.equal(world.sheet(patient.id).currentHp, 14, "a d10 of 8 healed more than half");
  await world.invoke("clear_condition", { characterId: patient.id, condition: "sewer plague" });
});

// ---- cackle fever ----

const laugher = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { con: 10 } });

await test("Cackle Fever: damage is great stress, a failed DC 13 CON save is 1d10 psychic and incapacitated with laughter.", async () => {
  await afflict({ characterId: laugher.id, kind: "disease", name: "Cackle Fever", save: false, symptomsNow: true });
  assert.equal(has(laugher.id, "cackle fever"), true);
  assert.equal(world.sheet(laugher.id).exhaustion, 1);
  world.patch(laugher.id, { currentHp: 40 });
  world.clearDice();
  world.dice(2, 6);
  await world.invoke("apply_damage", { characterId: laugher.id, amount: 5, type: "slashing", reason: "a goblin's blade" });
  world.clearDice();
  assert.equal(world.sheet(laugher.id).currentHp, 40 - 5 - 6);
  assert.equal(has(laugher.id, "incapacitated"), true);
  world.patch(laugher.id, { conditions: world.sheet(laugher.id).conditions.filter((name) => name !== "incapacitated") });
});

await test("Cackle Fever: its level of exhaustion stays through a long rest, and a successful rest save lowers the DC by 1d6.", async () => {
  await longRest([15, 4]);
  assert.equal(world.sheet(laugher.id).exhaustion, 1, "the long rest removed cackle fever's exhaustion");
  assert.match(afflictionLines(world.campaignId, world.sheet(laugher.id)).join(" "), /Cackle Fever \(DC 9/);
});

// ---- sight rot ----

await test("Sight Rot: -1 to sight checks and attack rolls, 1 worse after a long rest, and Eyebright ointment stops it.", async () => {
  const squinter = world.addHero({ class: "ranger", level: 1, abilities: { wis: 10 }, equipment: [{ name: "Eyebright ointment", qty: 1 }] });
  await afflict({ characterId: squinter.id, kind: "disease", name: "Sight Rot", save: false, symptomsNow: true });
  assert.equal(has(squinter.id, "sight rot (-1)"), true);
  world.clearDice();
  world.dice(10);
  await world.invoke("request_roll", { characterId: squinter.id, kind: "skill_check", skill: "perception", reason: "a look around" });
  world.clearDice();
  const roll = listRecentRolls(world.campaignId, 5).find((entry) => entry.characterId === squinter.id && entry.kind === "skill_check");
  assert.equal(roll.total, 9);
  // Each long rest also rolls the cackle fever save above: a 1 fails it.
  await longRest([1]);
  assert.equal(has(squinter.id, "sight rot (-2)"), true);
  await world.invoke("use_item", { characterId: squinter.id, item: "Eyebright ointment" });
  await longRest([1]);
  assert.equal(has(squinter.id, "sight rot (-2)"), true, "the ointment did not stop the worsening");
});

// ---- madness ----

await test("Short-term madness 01-20: paralyzed for 1d10 minutes, and it ends when the character takes damage.", async () => {
  const shaken = world.addHero({ class: "fighter", level: 3, maxHp: 30 });
  const out = await afflict({ characterId: shaken.id, kind: "madness", name: "short" }, [15, 3]);
  assert.equal(out.ok, true, out.error);
  assert.equal(has(shaken.id, "paralyzed"), true);
  assert.equal(world.sheet(shaken.id).conditionMeta.paralyzed.rounds, 30);
  await world.invoke("apply_damage", { characterId: shaken.id, amount: 2, type: "bludgeoning", reason: "a slap" });
  assert.equal(has(shaken.id, "paralyzed"), false);
});

await test("Long-term madness 21-30: paranoid, disadvantage on Wisdom checks, for 1d10 x 10 hours by the clock.", async () => {
  const paranoid = world.addHero({ class: "fighter", level: 3, maxHp: 30 });
  await afflict({ characterId: paranoid.id, kind: "madness", name: "long" }, [25, 2]);
  assert.equal(has(paranoid.id, "paranoid"), true);
  world.clearDice();
  world.diceLog();
  world.dice(10, 10);
  await world.invoke("request_roll", { characterId: paranoid.id, kind: "skill_check", skill: "insight", reason: "who can be trusted" });
  world.clearDice();
  assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 2, "no disadvantage on a Wisdom check");
  await world.invoke("pass_time", { amount: 19, unit: "hours" });
  assert.equal(has(paranoid.id, "paranoid"), true);
  await world.invoke("pass_time", { amount: 2, unit: "hours" });
  assert.equal(has(paranoid.id, "paranoid"), false, "the madness outlived its 20 hours");
});

await test("Indefinite madness gains a flaw from the table, shown for the narrator; a madness a save resists takes no hold.", async () => {
  const lost = world.addHero({ class: "wizard", level: 3, maxHp: 20, abilities: { wis: 10 } });
  const resisted = await afflict({ characterId: lost.id, kind: "madness", name: "indefinite", saveDc: 10 }, [15]);
  assert.equal(resisted.result.resisted, true);
  assert.equal(has(lost.id, "indefinite madness"), false);
  await afflict({ characterId: lost.id, kind: "madness", name: "indefinite" }, [60]);
  assert.equal(has(lost.id, "indefinite madness"), true);
  assert.match(afflictionLines(world.campaignId, world.sheet(lost.id)).join(" "), /smartest, wisest/);
});

// ---- poisons ----

await test("Serpent Venom: a failed DC 11 CON save is 3d6 poison, a success half.", async () => {
  const bitten = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.patch(bitten.id, { currentHp: 44 });
  await afflict({ characterId: bitten.id, kind: "poison", name: "Serpent Venom" }, [2, 4, 4, 4]);
  assert.equal(world.sheet(bitten.id).currentHp, 32);
  await afflict({ characterId: bitten.id, kind: "poison", name: "serpent venom" }, [18, 4, 4, 4]);
  assert.equal(world.sheet(bitten.id).currentHp, 26);
});

await test("Drow Poison: a failure is poisoned for an hour, and unconscious as well when it fails by 5 or more.", async () => {
  const dozy = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { con: 10 } });
  await afflict({ characterId: dozy.id, kind: "poison", name: "Drow Poison" }, [2]);
  assert.equal(has(dozy.id, "poisoned"), true);
  assert.equal(has(dozy.id, "unconscious"), true);
  assert.equal(world.sheet(dozy.id).conditionMeta.poisoned.rounds, 600);
});

await test("Midnight Tears waits for midnight, then a DC 17 CON save against 9d6 poison.", async () => {
  const guest = world.addHero({ class: "fighter", level: 10, maxHp: 90 });
  world.patch(guest.id, { currentHp: 90 });
  await afflict({ characterId: guest.id, kind: "poison", name: "Midnight Tears" });
  assert.equal(world.sheet(guest.id).currentHp, 90);
  world.clearDice();
  world.dice(1, 6, 6, 6, 6, 6, 6, 6, 6, 6);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  world.clearDice();
  assert.equal(world.sheet(guest.id).currentHp, 90 - 54);
});

await test("A vial of Serpent Venom coats a blade: the next creature hit makes a DC 11 CON save or takes 3d6 poison.", async () => {
  const assassin = world.addHero({ class: "rogue", level: 5, abilities: { dex: 16 }, proficiencies: TRAINED, equipment: [{ name: "Dagger", qty: 1 }, { name: "Serpent Venom (vial)", qty: 1 }] });
  const coated = await world.invoke("use_item", { characterId: assassin.id, item: "Serpent Venom (vial)" });
  assert.equal(coated.ok, true, coated.error);
  assert.equal(has(assassin.id, "poisoned weapon"), true);
  await kit.fight(1, { heroFaces: { [assassin.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.giveTurn(assassin.id);
  kit.place(assassin.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const swing = await kit.swing(assassin.id, enemy.id, [15, 2, 1, 5, 5, 5, 3, 3, 3]);
  const hp = world.enemies()[0].currentHp;
  await kit.endFight();
  assert.equal(swing.ok, true, swing.error);
  assert.ok(hp <= 200 - 2 - 15, `the venom's 3d6 did not land (hp ${hp})`);
});

await test("Lesser restoration ends a disease the engine holds, and the long rest then treats the character as cured.", async () => {
  const { curePlan } = await import("../src/lib/dm/cure-spell.ts");
  const { afflictionConditionsFor } = await import("../src/lib/dm/afflictions.ts");
  const giggler = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  await afflict({ characterId: giggler.id, kind: "disease", name: "Cackle Fever", save: false, symptomsNow: true });
  const sheet = world.sheet(giggler.id);
  const plan = curePlan({ conditions: ["blinded", "deafened", "paralyzed", "poisoned", "disease", "madness"] }, sheet, "disease", (word) => afflictionConditionsFor(world.campaignId, sheet, word));
  assert.deepEqual(plan.conditions, ["cackle fever"]);
  await world.invoke("clear_condition", { characterId: giggler.id, condition: "cackle fever" });
  await longRest();
  assert.equal(world.sheet(giggler.id).exhaustion, 0, "a cured cackle fever still held its exhaustion");
  assert.equal((getClock(world.campaignId).afflictions?.[giggler.id] ?? []).length, 0);
});

world.close();
finish();
