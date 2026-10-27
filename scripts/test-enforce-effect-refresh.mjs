// Reapplying an effect by the name it already holds is one change to the
// target's numbers, not a removal and a fresh grant (table function audit
// 2026-10-26, T10): a refresh or a shorter duration leaves the hit points
// alone, a stronger maximum-HP bonus raises the maximum and the current hit
// points by the difference (as a stronger Aid does), a weaker one lowers the
// maximum and the current hit points only past it, and expiry and removal
// give back exactly what was given. The same holds for an enemy, and the
// sheet is published once for each move and not at all when nothing moved.
//
// Found beside T10 and held here too: an effect that lasts until the fight
// ends ends with the fight; a maximum is never taken below 1 (it could not
// be given back exactly); and an enemy's moved maximum reaches the tracker.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-effect-refresh");
const { listEffects } = await import("../src/lib/db/active-effects.ts");
const { patchEnemyHp } = await import("../src/lib/db/encounters.ts");
const { tickEncounterConditions } = await import("../src/lib/dm/condition-tick.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const VITALITY = (value, more = {}) => ({ name: "Vitality", modifiers: [{ field: "maxHp", mode: "add", value }], duration: "minutes", remaining: 10, visible: true, ...more });
const hp = (row) => [row.maxHp, row.currentHp];
const effectsOn = (world, kind, id) => listEffects(world.campaignId, { kind, id });
const lastSeq = (world) => getDatabase().prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_events WHERE campaign_id = ?`).get(world.campaignId).seq;
const eventsSince = (world, type, since, id) => getDatabase()
  .prepare(`SELECT payload_json FROM campaign_events WHERE campaign_id = ? AND seq > ? AND type = ?`)
  .all(world.campaignId, since, type)
  .filter((row) => !id || row.payload_json.includes(id)).length;

// 30 HP under a +10 Vitality, then hurt to 32 of 40.
async function hurtHero() {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const hero = world.addHero({ maxHp: 30 });
  const set = await world.invoke("set_effect", { characterId: hero.id, ...VITALITY(10) });
  assert.equal(set.ok, true, set.error);
  assert.deepEqual(hp(world.sheet(hero.id)), [40, 40], "a fresh grant raises both");
  world.patch(hero.id, { currentHp: 32 });
  return { world, hero };
}
const reapply = async (world, hero, value, more) => {
  const out = await world.invoke("set_effect", { characterId: hero.id, ...VITALITY(value, more) });
  assert.equal(out.ok, true, out.error);
};

await test("refreshing the same maximum-HP bonus on a hurt character heals nothing and sends nothing", async () => {
  const { world, hero } = await hurtHero();
  const since = lastSeq(world);
  await reapply(world, hero, 10);
  assert.deepEqual(hp(world.sheet(hero.id)), [40, 32]);
  assert.equal(effectsOn(world, "character", hero.id).length, 1, "replaced, not stacked");
  assert.equal(eventsSince(world, "sheet_updated", since, hero.id), 0);
  await reapply(world, hero, 10, { name: "VITALITY" });
  assert.deepEqual(hp(world.sheet(hero.id)), [40, 32], "the name is matched as a person types it");
  assert.equal(effectsOn(world, "character", hero.id).length, 1);
});

await test("a shorter duration keeps the hit points, and its own end gives back exactly the bonus", async () => {
  const { world, hero } = await hurtHero();
  await reapply(world, hero, 10, { remaining: 2 });
  assert.deepEqual(hp(world.sheet(hero.id)), [40, 32]);
  assert.equal(effectsOn(world, "character", hero.id)[0].remaining, 2);
  const since = lastSeq(world);
  assert.equal((await world.invoke("pass_time", { amount: 1, unit: "minutes" })).ok, true);
  assert.deepEqual(hp(world.sheet(hero.id)), [40, 32], "one minute of two");
  assert.equal((await world.invoke("pass_time", { amount: 1, unit: "minutes" })).ok, true);
  assert.equal(effectsOn(world, "character", hero.id).length, 0);
  assert.deepEqual(hp(world.sheet(hero.id)), [30, 30]);
  assert.ok(eventsSince(world, "effects_updated", since) >= 1, "the table hears the list change when it runs out");
});

await test("a stronger bonus raises the maximum and the hit points by the difference, in one move", async () => {
  const { world, hero } = await hurtHero();
  const since = lastSeq(world);
  await reapply(world, hero, 15);
  assert.deepEqual(hp(world.sheet(hero.id)), [45, 37]);
  assert.equal(eventsSince(world, "sheet_updated", since, hero.id), 1);
});

await test("a weaker bonus lowers the maximum and takes the hit points down only past it", async () => {
  const { world, hero } = await hurtHero();
  await reapply(world, hero, 15);
  await reapply(world, hero, 10);
  assert.deepEqual(hp(world.sheet(hero.id)), [40, 37], "below the new maximum, untouched");
  await reapply(world, hero, 15);
  world.patch(hero.id, { currentHp: 44 });
  const since = lastSeq(world);
  await reapply(world, hero, 10);
  assert.deepEqual(hp(world.sheet(hero.id)), [40, 40]);
  assert.equal(eventsSince(world, "sheet_updated", since, hero.id), 1);
});

await test("lifting a refreshed bonus gives back exactly what it gave, by name and by id", async () => {
  const { world, hero } = await hurtHero();
  await reapply(world, hero, 10);
  assert.equal((await world.invoke("clear_effect", { characterId: hero.id, name: "Vitality" })).ok, true);
  assert.deepEqual(hp(world.sheet(hero.id)), [30, 30]);
  await reapply(world, hero, 10);
  world.patch(hero.id, { currentHp: 25 });
  await reapply(world, hero, 10);
  const [effect] = effectsOn(world, "character", hero.id);
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/dm/effects");
  const out = await call(route, "POST", { effectId: effect.id }, { campaignId: world.campaignId });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.deepEqual(hp(world.sheet(hero.id)), [30, 25]);
});

await test("refreshing one of two maximum-HP effects leaves the other's share where it is", async () => {
  const { world, hero } = await hurtHero();
  await world.invoke("set_effect", { characterId: hero.id, name: "Feast", modifiers: [{ field: "maxHp", mode: "add", value: 5 }], visible: true });
  assert.deepEqual(hp(world.sheet(hero.id)), [45, 37]);
  await reapply(world, hero, 10);
  assert.deepEqual(hp(world.sheet(hero.id)), [45, 37]);
  await world.invoke("clear_effect", { characterId: hero.id, name: "Feast" });
  assert.deepEqual(hp(world.sheet(hero.id)), [40, 37]);
});

await test("an enemy's refresh, strengthening, weakening, expiry and lifting move its hit points the same way", async () => {
  const { world, enemies: [dummy] } = await table([FIGHTER]);
  const enemy = () => hp(world.enemies().find((entry) => entry.id === dummy.id));
  const on = async (value, more) => {
    const out = await world.invoke("set_effect", { enemyId: dummy.id, ...VITALITY(value, more) });
    assert.equal(out.ok, true, out.error);
  };
  await on(10);
  assert.deepEqual(enemy(), [100, 100]);
  patchEnemyHp(dummy.id, 80, "alive");
  await on(10);
  assert.deepEqual(enemy(), [100, 80], "a refresh heals nothing");
  await on(15);
  assert.deepEqual(enemy(), [105, 85]);
  await on(10);
  assert.deepEqual(enemy(), [100, 85]);
  await on(15);
  patchEnemyHp(dummy.id, 104, "alive");
  await on(10, { duration: "rounds", remaining: 1 });
  assert.deepEqual(enemy(), [100, 100]);
  tickEncounterConditions(world.campaign(), { ...world.encounter(), round: 2 });
  assert.equal(effectsOn(world, "enemy", dummy.id).length, 0);
  assert.deepEqual(enemy(), [90, 90]);
  await on(10);
  patchEnemyHp(dummy.id, 70, "alive");
  await on(10);
  await world.invoke("clear_effect", { enemyId: dummy.id, name: "Vitality" });
  assert.deepEqual(enemy(), [90, 70]);
});

await test("an enemy's maximum moved by an effect reaches the table's tracker", async () => {
  const { world, enemies: [dummy] } = await table([FIGHTER]);
  let since = lastSeq(world);
  assert.equal((await world.invoke("set_effect", { enemyId: dummy.id, ...VITALITY(10) })).ok, true);
  assert.ok(eventsSince(world, "encounter_updated", since) >= 1, "set");
  since = lastSeq(world);
  assert.equal((await world.invoke("set_effect", { enemyId: dummy.id, name: "Mark", modifiers: [{ field: "attack", mode: "add", value: 1 }], visible: true })).ok, true);
  assert.equal(eventsSince(world, "encounter_updated", since), 0, "an effect that moves no maximum sends no tracker");
  since = lastSeq(world);
  assert.equal((await world.invoke("clear_effect", { enemyId: dummy.id, name: "Vitality" })).ok, true);
  assert.ok(eventsSince(world, "encounter_updated", since) >= 1, "lifted");
});

await test("an effect that lasts until the fight ends ends with it, its maximum given back", async () => {
  const { world, sheets: [hero] } = await table([{ ...FIGHTER, maxHp: 30 }]);
  const set = await world.invoke("set_effect", { characterId: hero.id, name: "Battle Fervor", modifiers: [{ field: "maxHp", mode: "add", value: 10 }], duration: "encounter", visible: true });
  assert.equal(set.ok, true, set.error);
  assert.equal(world.sheet(hero.id).maxHp, 40);
  const ended = await world.invoke("end_encounter", { outcome: "truce" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(effectsOn(world, "character", hero.id).length, 0);
  assert.equal(world.sheet(hero.id).maxHp, 30);
});

await test("a fight called off ends its fight-long effects too", async () => {
  const { world, sheets: [hero] } = await table([{ ...FIGHTER, maxHp: 30 }]);
  await world.invoke("set_effect", { characterId: hero.id, name: "Battle Fervor", modifiers: [{ field: "maxHp", mode: "add", value: 10 }], duration: "encounter", visible: true });
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/encounter");
  const out = await call(route, "DELETE", undefined, { campaignId: world.campaignId });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(effectsOn(world, "character", hero.id).length, 0);
  assert.equal(world.sheet(hero.id).maxHp, 30);
});

await test("a maximum is never lowered below 1, so lifting the effect gives back exactly what it took", async () => {
  const { world, sheets: [hero], enemies: [dummy] } = await table([{ ...FIGHTER, maxHp: 12 }], 1, { maxHp: 7 });
  const withering = (more) => ({ name: "Withering", modifiers: [{ field: "maxHp", mode: "add", value: -10 }], visible: true, ...more });
  const onEnemy = await world.invoke("set_effect", { enemyId: dummy.id, ...withering() });
  assert.equal(onEnemy.ok, false, "7 lowered by 10 is refused");
  assert.match(onEnemy.error, /at most 6/);
  assert.equal(world.enemies()[0].maxHp, 7);
  assert.equal(effectsOn(world, "enemy", dummy.id).length, 0);
  assert.equal((await world.invoke("set_effect", { enemyId: dummy.id, ...withering({ modifiers: [{ field: "maxHp", mode: "add", value: -6 }] }) })).ok, true);
  assert.equal(world.enemies()[0].maxHp, 1);
  await world.invoke("clear_effect", { enemyId: dummy.id, name: "Withering" });
  assert.equal(world.enemies()[0].maxHp, 7, "given back exactly");
  assert.equal((await world.invoke("set_effect", { characterId: hero.id, ...withering({ modifiers: [{ field: "maxHp", mode: "add", value: -12 }] }) })).ok, false, "a sheet too");
  assert.equal(world.sheet(hero.id).maxHp, 12);
});

await test("a bonus lifted from under a drain leaves the sheet's maximum at 1, never below", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const hero = world.addHero({ maxHp: 5 });
  assert.equal((await world.invoke("set_effect", { characterId: hero.id, ...VITALITY(10) })).ok, true);
  assert.equal((await world.invoke("set_effect", { characterId: hero.id, name: "Drain", modifiers: [{ field: "maxHp", mode: "add", value: -14 }], visible: true })).ok, true);
  assert.equal(world.sheet(hero.id).maxHp, 1);
  assert.equal((await world.invoke("clear_effect", { characterId: hero.id, name: "Vitality" })).ok, true);
  assert.equal(world.sheet(hero.id).maxHp, 1, "the maximum went below 1");
  assert.ok(world.sheet(hero.id).currentHp >= 0 && world.sheet(hero.id).currentHp <= 1);
});

await test("lifting an enemy's maximum-HP effect from the effects list reaches the tracker", async () => {
  // A person runs this table: lifting from the list is the DM seat's.
  const { world, enemies: [dummy] } = await table([FIGHTER], 1, {}, { gameSettings: { dmMode: "human" } });
  assert.equal((await world.invoke("set_effect", { enemyId: dummy.id, ...VITALITY(10) })).ok, true);
  const [effect] = effectsOn(world, "enemy", dummy.id);
  const since = lastSeq(world);
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/dm/effects");
  const out = await call(route, "POST", { effectId: effect.id }, { campaignId: world.campaignId });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.ok(eventsSince(world, "encounter_updated", since) >= 1);
});

closeTables();
await finish();
