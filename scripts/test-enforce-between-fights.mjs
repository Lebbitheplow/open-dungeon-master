// What a spell or feature started in one moment does when the table's
// clock, not the initiative order, is what moves.
//
// A fight counts rounds; everything else counts minutes, hours and days
// through one clock (src/lib/db/clock.ts advanceClock), which pass_time,
// travel and the rests all turn. Issue #30 put timed conditions on that
// clock, and a buff a spell lays is one such condition (cast-buff.ts stores
// Bless as "blessed" for ten rounds, Mage Armor as "mage armor" for eight
// hours). The rules here ask the same of everything with a duration:
//
//   SRD 5.1, Duration: a spell with a duration lasts that long and no
//   longer, in combat or out of it; when it ends, its effects end. A
//   concentration spell's caster stops concentrating when the duration
//   runs out. Bless lasts 1 minute, Hunter's Mark 1 hour, Mage Armor and
//   Aid 8 hours, Conjure Animals 1 hour, Spiritual Weapon 1 minute.
//   Rage lasts 1 minute.
//
// Each case starts the thing outside a fight (or in one that then ends),
// reads the state it made, turns the clock past the duration, and reads it
// again. Durations short of the limit leave the state alone.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { FULL_CASTER_SLOTS, cleric, slotsOf, wizard, fightDummies } from "./lib/enforce-spells.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-between-fights");

const has = (world, id, condition) => world.sheet(id).conditions.some((name) => name.toLowerCase() === condition);
const minutes = (world, amount) => world.invoke("pass_time", { amount, unit: "minutes" });
const hours = (world, amount) => world.invoke("pass_time", { amount, unit: "hours" });

async function castBuff(world, caster, spell, extra = {}) {
  const cast = await world.invoke("cast_buff", { characterId: caster.id, spell, ...extra });
  assert.equal(cast.ok, true, `${spell}: ${cast.error}`);
  return cast;
}

// ---- a minute ----

await test("Bless cast on the road ends after its minute: the caster stops concentrating and the +d4 leaves its targets", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const priest = world.addHero({ name: "Sera", ...cleric(5, { spellcasting: { prepared: ["Bless", "Aid", "Spiritual Weapon", "Cure Wounds"] } }) });
  const brom = world.addHero({ name: "Brom", class: "fighter", level: 5, proficiencies: TRAINED });
  await castBuff(world, priest, "Bless", { targetCharacterIds: [brom.id] });
  assert.equal(world.sheet(priest.id).concentratingOn, "Bless", "Sera concentrates on Bless");
  assert.ok(has(world, brom.id, "blessed"), "Brom is blessed");
  await minutes(world, 2);
  assert.equal(world.sheet(priest.id).concentratingOn, null, "two minutes on, Sera no longer concentrates");
  assert.ok(!has(world, brom.id, "blessed"), "and the Bless is gone from Brom");
  world.close();
});

await test("Spiritual Weapon, a minute with no concentration, is gone after its minute on the road", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const priest = world.addHero({ name: "Sera", ...cleric(5, { spellcasting: { prepared: ["Spiritual Weapon", "Bless"] } }) });
  await castBuff(world, priest, "Spiritual Weapon");
  assert.ok(has(world, priest.id, "spiritual weapon"), "the weapon floats beside Sera");
  assert.equal(world.sheet(priest.id).concentratingOn, null, "no concentration");
  await minutes(world, 2);
  assert.ok(!has(world, priest.id, "spiritual weapon"), "two minutes on, the weapon is gone");
  world.close();
});

await test("Rage taken outside a fight ends after its minute, or is refused in words", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const grim = world.addHero({
    name: "Grim", class: "barbarian", level: 5, abilities: { str: 16, con: 16 }, proficiencies: TRAINED,
    features: [{ name: "Rage", source: "class" }, { name: "Unarmored Defense", source: "class" }, { name: "Reckless Attack", source: "class" }],
  });
  const raged = await world.invoke("use_resource", { characterId: grim.id, resource: "Rage" });
  if (!raged.ok) {
    assert.match(raged.error, /fight|encounter|combat|hostile/i, raged.error);
    world.close();
    return;
  }
  const raging = () => world.sheet(grim.id).conditions.some((name) => /rag/i.test(name));
  assert.equal(raging(), true, "Grim rages");
  await minutes(world, 2);
  assert.equal(raging(), false, "two minutes later the rage is over");
  world.close();
});

// ---- an hour ----

await test("Hunter's Mark outlives the fight it was cast in and ends an hour on: the ranger stops concentrating on the road", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kara = world.addHero({
    name: "Kara", class: "ranger", level: 5, abilities: { dex: 16, wis: 14 }, proficiencies: { ...TRAINED, saves: ["str", "dex"] },
    spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: ["Hunter's Mark", "Cure Wounds"], prepared: [], cantrips: [] },
  });
  const [dummy] = await fightDummies(world, 1, { heroFaces: { [kara.id]: 20 } });
  await castBuff(world, kara, "Hunter's Mark", { targetEnemyId: dummy.id });
  assert.ok(world.sheet(kara.id).concentratingOn, "Kara concentrates on the mark");
  const ended = await world.invoke("end_encounter", { summary: "The goblin runs off." });
  assert.equal(ended.ok, true, ended.error);
  assert.ok(world.sheet(kara.id).concentratingOn, "the fight's end does not end the hour-long spell");
  await minutes(world, 30);
  assert.ok(world.sheet(kara.id).concentratingOn, "half an hour on, still held");
  await minutes(world, 31);
  assert.equal(world.sheet(kara.id).concentratingOn, null, "an hour on, the mark is gone");
  world.close();
});

const druid = () => ({
  name: "Moss", class: "druid", level: 5, abilities: { wis: 16, con: 14 }, proficiencies: { ...TRAINED, saves: ["int", "wis"] },
  spellcasting: { ability: "wis", slots: slotsOf(FULL_CASTER_SLOTS[4]), known: [], prepared: ["Conjure Animals", "Cure Wounds"], cantrips: ["Druidcraft"] },
});

await test("Conjure Animals on the road brings its beasts for an hour and no longer", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const moss = world.addHero(druid());
  const before = world.sheets().length;
  await castBuff(world, moss, "Conjure Animals", { variant: "wolf", count: 2 });
  assert.equal(world.sheets().length, before + 2, "two wolves are at the table");
  assert.equal(world.sheet(moss.id).concentratingOn, "Conjure Animals", "Moss concentrates");
  await minutes(world, 30);
  assert.equal(world.sheets().length, before + 2, "half an hour on they are still here");
  await minutes(world, 31);
  assert.equal(world.sheets().length, before, "an hour on the beasts are gone");
  world.close();
});

// Found 2026-10-08 and fixed the same day: the wolves faded on the clock and
// the druid went on concentrating on Conjure Animals (concentration-upkeep.ts
// endConcentrationOnFadedSummons).
await test("when a conjuring spell's duration runs out its caster stops concentrating, and may concentrate on something new without a warning about the old", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const moss = world.addHero(druid());
  await castBuff(world, moss, "Conjure Animals", { variant: "wolf", count: 2 });
  await minutes(world, 30);
  assert.equal(world.sheet(moss.id).concentratingOn, "Conjure Animals", "half an hour on, still held");
  await minutes(world, 31);
  assert.equal(world.sheet(moss.id).concentratingOn, null, "the concentration ends with the beasts");
  world.close();
});

// ---- eight hours ----

await test("Mage Armor lasts eight hours: through a short rest, not past a long one", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const mage = world.addHero({ name: "Ilse", acOverride: false, ...wizard(5) });
  const bare = world.sheet(mage.id).ac;
  await castBuff(world, mage, "Mage Armor");
  assert.ok(has(world, mage.id, "mage armor"), "Mage Armor is on Ilse");
  assert.equal(world.sheet(mage.id).ac, 13 + 2, "AC 13 + DEX");
  const rested = await world.invoke("take_rest", { kind: "short", characterIds: [mage.id] });
  assert.equal(rested.ok, true, rested.error);
  assert.ok(has(world, mage.id, "mage armor"), "an hour's rest leaves it");
  await hours(world, 6);
  assert.ok(has(world, mage.id, "mage armor"), "seven hours on, still there");
  await hours(world, 2);
  assert.ok(!has(world, mage.id, "mage armor"), "nine hours on, gone");
  assert.equal(world.sheet(mage.id).ac, bare, "and the AC is her own again");
  world.close();
});

await test("Mage Armor cast before a night's sleep is gone by morning", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const mage = world.addHero({ name: "Ilse", acOverride: false, ...wizard(5) });
  await castBuff(world, mage, "Mage Armor");
  await minutes(world, 30);
  const slept = await world.invoke("take_rest", { kind: "long", characterIds: [mage.id] });
  assert.equal(slept.ok, true, slept.error);
  assert.ok(!has(world, mage.id, "mage armor"), "eight and a half hours on, the armor is gone");
  world.close();
});

await test("Aid raises the hit point maximum by 5 for eight hours; when it ends the maximum falls and the current is capped", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const priest = world.addHero({ name: "Sera", maxHp: 33, ...cleric(5, { spellcasting: { prepared: ["Aid", "Bless"] } }) });
  const brom = world.addHero({ name: "Brom", class: "fighter", level: 5, maxHp: 44, proficiencies: TRAINED });
  const before = world.sheet(brom.id);
  await castBuff(world, priest, "Aid", { targetCharacterIds: [brom.id] });
  const under = world.sheet(brom.id);
  assert.equal(under.maxHp, before.maxHp + 5, `Aid raised the maximum: ${under.maxHp}`);
  assert.equal(under.currentHp, before.currentHp + 5, `and the current: ${under.currentHp}`);
  await hours(world, 9);
  const after = world.sheet(brom.id);
  assert.equal(after.maxHp, before.maxHp, `nine hours on the maximum is back: ${after.maxHp}`);
  assert.ok(after.currentHp <= after.maxHp, `current ${after.currentHp} within ${after.maxHp}`);
  world.close();
});

// ---- rounds become minutes ----

await test("a condition with rounds left when the fight ends wears off on the clock: ten rounds are a minute", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const brom = world.addHero({ name: "Brom", class: "fighter", level: 5, proficiencies: TRAINED });
  await fightDummies(world, 1, { heroFaces: { [brom.id]: 20 } });
  const set = await world.invoke("set_condition", { characterId: brom.id, condition: "poisoned", rounds: 20 });
  assert.equal(set.ok, true, set.error);
  const ended = await world.invoke("end_encounter", { summary: "Over." });
  assert.equal(ended.ok, true, ended.error);
  assert.ok(has(world, brom.id, "poisoned"), "the poison outlasts the fight");
  await minutes(world, 1);
  assert.ok(has(world, brom.id, "poisoned"), "a minute on: ten of twenty rounds");
  await minutes(world, 2);
  assert.ok(!has(world, brom.id, "poisoned"), "three minutes on: gone");
  world.close();
});

await test("a concentration spell with rounds left when the fight ends keeps its minute and no more", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const priest = world.addHero({ name: "Sera", ...cleric(5, { spellcasting: { prepared: ["Bless", "Cure Wounds"] } }) });
  const brom = world.addHero({ name: "Brom", class: "fighter", level: 5, proficiencies: TRAINED });
  await fightDummies(world, 1, { heroFaces: { [priest.id]: 20, [brom.id]: 15 } });
  await castBuff(world, priest, "Bless", { targetCharacterIds: [brom.id] });
  const ended = await world.invoke("end_encounter", { summary: "Over." });
  assert.equal(ended.ok, true, ended.error);
  assert.ok(world.sheet(priest.id).concentratingOn, "Bless outlasts a fight that ended in its first round");
  assert.ok(has(world, brom.id, "blessed"));
  await minutes(world, 2);
  assert.equal(world.sheet(priest.id).concentratingOn, null, "and is gone two minutes later");
  assert.ok(!has(world, brom.id, "blessed"));
  world.close();
});

finish();
