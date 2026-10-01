// Exploration as the engine holds it: the march, what the party notices on
// the way, the light they carry, and the weather they walk through.
//
// SRD 5.1, Travel Pace: past 8 hours a character makes a Constitution save
// at the end of each extra hour, DC 10 + 1 for each hour past 8, and gains a
// level of exhaustion on each failure. A fast pace is -5 to passive
// Perception. Vision and Light: dim light gives disadvantage on Perception
// that relies on sight (-5 passive); darkvision sees darkness as dim light.
// Conditions: an unconscious creature is unaware of its surroundings.
// Adventuring Gear: a torch burns for 1 hour, a lantern 6 hours on a flask
// of oil. The weather rules the SRD's Gamemastering section carries: in
// extreme heat a Constitution save each hour, DC 5 rising by 1 an hour, at
// disadvantage in medium or heavy armor; in extreme cold DC 10 each hour.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-exploration");
const world = await openWorld();
const { getDatabase } = await import("../src/lib/db/core.ts");

const profs = (extra = {}) => ({
  saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [], ...extra,
});
const savesOf = (id) =>
  getDatabase()
    .prepare(`SELECT dc FROM rolls WHERE character_id = ? AND roll_kind = 'saving_throw' ORDER BY created_at, rowid`)
    .all(id)
    .map((row) => row.dc);

// A clear, mild sky, so the weather adds nothing a case did not ask for.
await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });

await test("A 12-hour march is four forced-march hours: four Constitution saves at DC 11, 12, 13 and 14, each failure a level of exhaustion.", async () => {
  const walker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  // Set out at six in the morning: a march that crossed a dawn would roll a
  // new sky, and a cold one adds its own saves to the count.
  const { getClock: clockNow, setClockInstant: setInstant } = await import("../src/lib/db/clock.ts");
  setInstant(world.campaignId, (Math.floor(clockNow(world.campaignId).instant / 1440) + 1) * 1440 + 6 * 60);
  await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
  world.dice(1, 1, 1, 1);
  const out = await world.invoke("travel", { hours: 12, pace: "normal", characterIds: [walker.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(savesOf(walker.id), [11, 12, 13, 14]);
  assert.equal(world.sheet(walker.id).exhaustion, 4);
});

// Passive Perception exactly 15: WIS 16 (+3) and proficiency (+2).
const lookout = world.addHero({ user: world.owner, class: "ranger", level: 1, race: "human", abilities: { wis: 16 }, proficiencies: profs({ skills: ["perception"] }) });
// The clock set to an hour of the next day, so a case reads the light it
// means to.
const { getClock, setClockInstant } = await import("../src/lib/db/clock.ts");
const at = async (hour) => {
  const day = Math.floor(getClock(world.campaignId).instant / 1440) + 1;
  setClockInstant(world.campaignId, day * 1440 + hour * 60);
  // A new day would roll a new sky; the case wants a clear one.
  await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
};
let lastNotice = "";
const notice = async (dc = 15) => {
  const out = await world.invoke("check_notice", { dc, characterIds: [lookout.id] });
  assert.equal(out.ok, true, out.error);
  lastNotice = JSON.stringify(out.result.applied ?? []);
  return out.result.noticedBy.includes(world.sheet(lookout.id).name);
};

await test("A fast travel pace is -5 to passive Perception until the party stops: a passive 15 misses a DC 15 thing at a fast pace and catches it at a normal one.", async () => {
  await at(9);
  await world.invoke("travel", { hours: 1, pace: "normal", characterIds: [lookout.id] });
  assert.equal(await notice(), true);
  await world.invoke("travel", { hours: 1, pace: "fast", characterIds: [lookout.id] });
  assert.equal(await notice(), false);
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
  assert.equal(await notice(), true);
});

await test("Off the board, night is darkness: a character without darkvision or a light sees nothing, a torch gives back full sight, and darkvision sees the dark as dim light (-5).", async () => {
  await at(23);
  assert.equal(await notice(5), false, `in the dark: ${lastNotice}`);
  world.patch(lookout.id, { equipment: [{ name: "Torch", qty: 1 }] });
  assert.equal(await notice(), true, `with a torch: ${lastNotice}`);
  world.patch(lookout.id, { equipment: [], features: [{ name: "Darkvision", source: "race" }] });
  assert.equal(await notice(10), true, `with darkvision: ${lastNotice}`);
  assert.equal(await notice(15), false, `with darkvision: ${lastNotice}`);
  world.patch(lookout.id, { features: [] });
  await at(12);
  assert.equal(await notice(), true, `at noon: ${lastNotice}`);
});

await test("An unconscious character notices nothing, however high their passive Perception.", async () => {
  const sleeper = world.addHero({ user: world.owner, class: "ranger", level: 5, abilities: { wis: 20 }, proficiencies: profs({ skills: ["perception"] }) });
  world.patch(sleeper.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0, stable: true, dead: false } });
  const out = await world.invoke("check_notice", { dc: 10, characterIds: [sleeper.id] });
  assert.deepEqual(out.result.noticedBy, []);
  assert.deepEqual(out.result.missedBy, [world.sheet(sleeper.id).name]);
});

await test("Three hours of extreme heat are three Constitution saves at DC 5, 6 and 7, at disadvantage in medium armor, each failure a level of exhaustion.", async () => {
  const trekker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40, equipment: [{ name: "Scale Mail", qty: 1 }] });
  world.diceLog();
  world.dice(1, 1, 1, 1, 1, 1);
  const out = await world.invoke("apply_hazard", { type: "extreme_heat", hours: 3, characterIds: [trekker.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(savesOf(trekker.id), [5, 6, 7]);
  assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 6, "each save rolled at disadvantage");
  assert.equal(world.sheet(trekker.id).exhaustion, 3);
});

await test("Two hours of extreme cold are two Constitution saves at DC 10; cold weather gear shrugs them off.", async () => {
  const trekker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  world.dice(1, 1);
  await world.invoke("apply_hazard", { type: "extreme_cold", hours: 2, characterIds: [trekker.id] });
  world.clearDice();
  assert.deepEqual(savesOf(trekker.id), [10, 10]);
  const bundled = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40, equipment: [{ name: "Cold Weather Gear", qty: 1 }] });
  await world.invoke("apply_hazard", { type: "extreme_cold", hours: 2, characterIds: [bundled.id] });
  assert.deepEqual(savesOf(bundled.id), []);
  assert.equal(world.sheet(bundled.id).exhaustion ?? 0, 0);
});

// ---- light that burns down ----

const bearer = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40, equipment: [{ name: "Torch", qty: 1 }, { name: "Rope", qty: 1 }] });

await test("A lit torch burns for an hour and is then used up: the pack loses the torch, and the next board gives no light.", async () => {
  const fight = await world.beginFight([{ monster: "goblin", count: 1 }]);
  const { getTokenByRef, getBattleMapForEncounter } = await import("../src/lib/db/battle-maps.ts");
  const token = () => getTokenByRef(getBattleMapForEncounter(fight.id).id, bearer.id);
  assert.ok(token().lightRadius > 0, "the torch was never lit");
  const moved = await world.invoke("pass_time", { amount: 61, unit: "minutes" });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(token().lightRadius, 0);
  assert.deepEqual(world.sheet(bearer.id).equipment.map((item) => item.name), ["Rope"]);
  await world.invoke("end_encounter", { outcome: "truce" });
  const { carriedLight } = await import("../src/lib/dm/light-timers.ts");
  assert.equal(carriedLight(world.sheet(bearer.id)).radius, 0);
});

await test("a lantern burns on its flask of oil: with none carried it gives no light", async () => {
  const { carriedLight } = await import("../src/lib/dm/light-timers.ts");
  assert.equal(carriedLight({ equipment: [{ name: "Hooded Lantern", qty: 1 }] }).radius, 0);
  assert.ok(carriedLight({ equipment: [{ name: "Hooded Lantern", qty: 1 }, { name: "Flask of Oil", qty: 2 }] }).radius > 0);
});

world.close();
finish();
