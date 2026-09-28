// Dropping to 0 hit points, death saving throws, and what the dead may not
// do. src/lib/dm/death.ts is driven through apply_damage, heal, stabilize and
// the initiative pointer, with every d20 forced.
//
// SRD 5.1, Dropping to 0 Hit Points:
//   - Massive damage: "if the damage that remains after reducing you to 0 hit
//     points equals or exceeds your hit point maximum, you die."
//   - Otherwise the creature falls unconscious and makes a death saving throw
//     at the start of each of its turns: a d20 with no modifier, 10 or higher
//     succeeds. Three successes and it is stable, three failures and it is
//     dead; they need not be consecutive. A 1 counts as two failures, a 20
//     restores 1 hit point.
//   - Damage at 0 hit points is one failure, two from a critical hit, and
//     death outright if it equals or exceeds the hit point maximum.
//   - Any healing ends the dying. A stable creature stays at 0 hit points
//     and unconscious, and starts dying again if it takes damage.
//
// ODM's own rules, pinned here as the code documents them:
//   - The save is rolled by the server when the initiative pointer passes the
//     dying character, never by the player (src/lib/dm/death.ts rollDeathSave).
//   - stabilize names a healer, whose action it takes, and the server rolls
//     their DC 10 Wisdom (Medicine) check; a healer's kit use or Spare the
//     Dying needs no check. A healer's kit is carried as one row whose
//     quantity is its uses.
//   - A character at 0 hit points is written unconscious and prone; healing
//     takes the unconscious off and leaves the prone.
//   - "only the party lead can reverse a death": no spell raises the dead
//     through the engine.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-enforce-death");
const world = await openWorld();
const kit = conditionsKit(world);

const hero = world.addHero(FIGHTER);
const ally = world.addHero(FIGHTER);
const orc = world.addHero({ ...FIGHTER, race: "half-orc" });
await world.beginFight([{ monster: "goblin", count: 2 }], {
  heroFaces: { [hero.id]: 20, [ally.id]: 18, [orc.id]: 2 },
});
kit.offBoard();
const [goblin] = world.enemies();

const FRESH = { successes: 0, failures: 0, stable: false, dead: false };
const DEAD = { successes: 0, failures: 3, stable: false, dead: true };
const track = (id = hero.id) => world.sheet(id).deathSaves;
const hp = (id = hero.id) => world.sheet(id).currentHp;
const damage = (amount, id = hero.id, extra = {}) =>
  world.invoke("apply_damage", { characterId: id, amount, ...extra });
const dying = (saves = FRESH) => kit.reset(hero.id, { currentHp: 0, deathSaves: saves });

// One pass of the pointer over the dying hero, with the die it will roll.
// The ally holds the turn and the pointer is walked all the way round to
// them again, which takes it over the hero exactly once.
function pass(face) {
  const saved = track();
  while (kit.pointer().id !== ally.id) {
    kit.skipTurn();
  }
  world.patch(hero.id, { deathSaves: saved, currentHp: saved ? 0 : hp() });
  world.clearDice();
  world.diceLog();
  if (face !== undefined) {
    world.dice(face);
  }
  assert.equal(kit.endOwnTurn(ally.userId), true);
  while (kit.pointer().id !== ally.id) {
    kit.skipTurn();
  }
  world.clearDice();
  return kit.rolled();
}

// ---- dropping ----

await test("reaching exactly 0 opens a fresh death save track", async () => {
  kit.reset(hero.id, { currentHp: 12 });
  const out = await damage(12);
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(), 0);
  assert.deepEqual(track(), FRESH);
});

await test("one hit point left is not dying", async () => {
  kit.reset(hero.id, { currentHp: 12 });
  await damage(11);
  assert.equal(hp(), 1);
  assert.equal(track(), null);
});

await test("massive damage: the remainder equal to the maximum kills, one less does not", async () => {
  // 10 hit points of a 40 maximum: 49 leaves 39 over, 50 leaves 40.
  kit.reset(hero.id, { currentHp: 10 });
  await damage(49);
  assert.deepEqual(track(), FRESH);
  kit.reset(hero.id, { currentHp: 10 });
  await damage(50);
  assert.deepEqual(track(), DEAD);
  assert.equal(hp(), 0);
});

await test("massive damage is counted after temporary hit points and resistance", async () => {
  kit.reset(hero.id, { currentHp: 10, tempHp: 5 });
  await damage(54);
  assert.deepEqual(track(), FRESH);
  kit.reset(hero.id, { currentHp: 10, tempHp: 5 });
  await damage(55);
  assert.deepEqual(track(), DEAD);
  // Raging: 99 slashing is 49, which leaves 39 over.
  kit.reset(hero.id, { currentHp: 10, conditions: ["raging"] });
  await damage(99, hero.id, { type: "slashing" });
  assert.deepEqual(track(), FRESH);
});

// ---- death saving throws ----

await test("the save is a bare d20: 10 succeeds and 9 fails, whatever the sheet says", async () => {
  dying();
  assert.deepEqual(pass(10), ["d20:10"]);
  assert.deepEqual(track(), { ...FRESH, successes: 1 });
  dying();
  // Proficient in Constitution saves with +2 CON, and still a failure.
  assert.deepEqual(pass(9), ["d20:9"]);
  assert.deepEqual(track(), { ...FRESH, failures: 1 });
});

await test("three successes stabilize, and they need not be consecutive", async () => {
  dying();
  for (const face of [12, 4, 15, 7, 10]) {
    pass(face);
  }
  assert.deepEqual(track(), { successes: 3, failures: 2, stable: true, dead: false });
  assert.equal(hp(), 0);
});

await test("three failures kill, and they need not be consecutive", async () => {
  dying();
  for (const face of [3, 18, 5, 11, 9]) {
    pass(face);
  }
  assert.deepEqual(track(), { successes: 2, failures: 3, stable: false, dead: true });
});

await test("a natural 1 is two failures", async () => {
  dying();
  pass(1);
  assert.deepEqual(track(), { ...FRESH, failures: 2 });
  pass(1);
  assert.equal(track().dead, true);
  assert.equal(track().failures, 3);
});

await test("a natural 20 restores 1 hit point and clears the track", async () => {
  dying({ successes: 1, failures: 2, stable: false, dead: false });
  pass(20);
  assert.equal(hp(), 1);
  assert.equal(track(), null);
});

await test("a 19 is only a success", async () => {
  dying({ successes: 0, failures: 2, stable: false, dead: false });
  pass(19);
  assert.equal(hp(), 0);
  assert.deepEqual(track(), { successes: 1, failures: 2, stable: false, dead: false });
});

await test("the stable and the dead roll nothing", async () => {
  dying({ successes: 3, failures: 1, stable: true, dead: false });
  assert.deepEqual(pass(), []);
  dying(DEAD);
  assert.deepEqual(pass(), []);
  assert.deepEqual(track(), DEAD);
});

await test("a dying character cannot end a turn they do not have", async () => {
  dying();
  assert.equal(kit.endOwnTurn(world.owner.id), false);
});

// ---- damage and healing at 0 ----

await test("damage at 0 hit points is one failure", async () => {
  dying();
  await damage(3);
  assert.deepEqual(track(), { ...FRESH, failures: 1 });
  assert.equal(hp(), 0);
});

await test("a critical hit at 0 hit points is two failures", async () => {
  dying();
  const out = await kit.withDice([20, 3, 3], "enemy_attack", {
    enemyId: goblin.id,
    targetCharacterId: hero.id,
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(out.result.swings[0].crit, true);
  assert.deepEqual(track(), { ...FRESH, failures: 2 });
});

await test("damage to a stable character starts the dying again", async () => {
  dying({ successes: 3, failures: 1, stable: true, dead: false });
  await damage(1);
  assert.equal(track().stable, false);
  assert.equal(track().failures, 2);
});

await test("the third failure from damage kills", async () => {
  dying({ successes: 2, failures: 2, stable: false, dead: false });
  await damage(1);
  assert.equal(track().dead, true);
});

await test("any healing ends the dying, stable or not", async () => {
  for (const saves of [{ ...FRESH, failures: 2 }, { successes: 3, failures: 0, stable: true, dead: false }]) {
    dying(saves);
    const out = await world.invoke("heal", { characterId: hero.id, amount: 1 });
    assert.equal(out.ok, true, out.error);
    assert.equal(hp(), 1);
    assert.equal(track(), null);
  }
});

await test("stabilize stops the saves and leaves the character at 0", async () => {
  dying({ ...FRESH, failures: 2 });
  kit.freshTurn();
  // The ally holds the turn. Their Medicine is a bare Wisdom check at +0:
  // the 10 meets DC 10, and the 3 is the 1d4 hours until the hit point.
  const tended = await kit.withDice([10, 3], "stabilize", { characterId: hero.id, healerId: ally.id });
  const out = tended.outcome;
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(tended.dice, ["d20:10", "d4:3"]);
  assert.equal(world.encounter().turnBudget.actionUsed, true);
  assert.deepEqual(track(), { successes: 0, failures: 2, stable: true, dead: false });
  assert.equal(hp(), 0);
  assert.deepEqual(pass(), []);
  const swing = await kit.swing([17, 4], hero.id, goblin.id);
  assert.equal(swing.outcome.ok, false);
});

await test("stabilize is refused for the living and for the dead", async () => {
  kit.reset(hero.id);
  assert.equal((await world.invoke("stabilize", { characterId: hero.id })).ok, false);
  dying(DEAD);
  assert.equal((await world.invoke("stabilize", { characterId: hero.id })).ok, false);
  assert.deepEqual(track(), DEAD);
});

await test("a failed Medicine check leaves the character dying and still costs the action", async () => {
  dying({ ...FRESH, failures: 1 });
  kit.freshTurn();
  const out = await kit.withDice([9], "stabilize", { characterId: hero.id, healerId: ally.id });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.deepEqual(out.dice, ["d20:9"]);
  assert.deepEqual(track(), { ...FRESH, failures: 1 });
  assert.equal(world.encounter().turnBudget.actionUsed, true);
  // The action is gone, so a second try this turn is refused and rolls nothing.
  const again = await kit.withDice([20], "stabilize", { characterId: hero.id, healerId: ally.id });
  assert.equal(again.outcome.ok, false);
  assert.deepEqual(again.dice, []);
});

await test("stabilize needs a healer who can act, and who is not the patient", async () => {
  dying();
  kit.freshTurn();
  const before = world.sheet(hero.id);
  for (const args of [
    { characterId: hero.id },
    { characterId: hero.id, healerId: hero.id },
    { characterId: hero.id, healerId: "nobody" },
    // The half-orc is not at the pointer: off their turn they have no action.
    { characterId: hero.id, healerId: orc.id },
  ]) {
    const out = await kit.withDice([20], "stabilize", args);
    assert.equal(out.outcome.ok, false, JSON.stringify(args));
    assert.deepEqual(out.dice, [], JSON.stringify(args));
  }
  kit.reset(ally.id, { conditions: ["stunned"] });
  const stunned = await kit.withDice([20], "stabilize", { characterId: hero.id, healerId: ally.id });
  assert.equal(stunned.outcome.ok, false, "a stunned healer tended the dying");
  kit.reset(ally.id);
  assert.deepEqual(world.sheet(hero.id).deathSaves, before.deathSaves);
});

await test("a healer's kit stabilizes with no check and spends a use; without a kit it is refused", async () => {
  dying();
  kit.freshTurn();
  const none = await kit.withDice([20], "stabilize", { characterId: hero.id, healerId: ally.id, method: "kit" });
  assert.equal(none.outcome.ok, false);
  assert.equal(track().stable, false);
  world.patch(ally.id, { equipment: [...ally.equipment, { name: "Healer's Kit", qty: 10 }] });
  const out = await kit.withDice([2], "stabilize", { characterId: hero.id, healerId: ally.id, method: "kit" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.deepEqual(out.dice, ["d4:2"], "the kit needs no d20");
  assert.equal(track().stable, true);
  assert.equal(world.sheet(ally.id).equipment.find((item) => item.name === "Healer's Kit").qty, 9);
  world.patch(ally.id, { equipment: ally.equipment });
});

await test("Spare the Dying stabilizes with no check, for a healer who knows it", async () => {
  dying();
  kit.freshTurn();
  const none = await kit.withDice([20], "stabilize", { characterId: hero.id, healerId: ally.id, method: "spell" });
  assert.equal(none.outcome.ok, false);
  world.patch(ally.id, {
    spellcasting: { ability: "wis", slots: {}, prepared: [], known: [], cantrips: ["Spare the Dying"] },
  });
  const out = await kit.withDice([1], "stabilize", { characterId: hero.id, healerId: ally.id, method: "spell" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.deepEqual(out.dice, ["d4:1"]);
  assert.equal(track().stable, true);
  world.patch(ally.id, { spellcasting: null });
});

// ---- the body follows the track ----

await test("dropping to 0 writes unconscious and prone, and healing leaves only prone", async () => {
  kit.reset(hero.id, { currentHp: 12 });
  await damage(12);
  assert.deepEqual(world.sheet(hero.id).conditions, ["unconscious", "prone"]);
  const out = await world.invoke("heal", { characterId: hero.id, amount: 3 });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(), 3);
  assert.deepEqual(world.sheet(hero.id).conditions, ["prone"]);
  assert.equal(track(), null);
});

await test("a natural 20 wakes the character, still prone", async () => {
  kit.reset(hero.id, { currentHp: 5 });
  await damage(5);
  pass(20);
  assert.equal(hp(), 1);
  assert.deepEqual(world.sheet(hero.id).conditions, ["prone"]);
});

await test("the third success starts the 1d4 hours a stable creature waits", async () => {
  kit.reset(hero.id, { currentHp: 5 });
  await damage(5);
  world.patch(hero.id, { deathSaves: { successes: 2, failures: 0, stable: false, dead: false } });
  const saved = track();
  while (kit.pointer().id !== ally.id) {
    kit.skipTurn();
  }
  world.patch(hero.id, { deathSaves: saved, currentHp: 0 });
  world.clearDice();
  // The save, then the 1d4 hours.
  world.dice(12, 2);
  assert.equal(kit.endOwnTurn(ally.userId), true);
  while (kit.pointer().id !== ally.id) {
    kit.skipTurn();
  }
  assert.equal(world.clearDice(), 0, "the save or the wait was never rolled");
  assert.equal(track().stable, true);
  const wait = world.sheet(hero.id).conditionMeta.unconscious;
  assert.equal(wait.source, "stable");
  // Two hours of rounds, less whatever rounds the pointer has wrapped since.
  assert.ok(wait.rounds <= 1200 && wait.rounds > 1190, `the wait is ${wait.rounds} rounds`);
});

await test("damage to a stable character calls off the wait", async () => {
  dying();
  kit.freshTurn();
  while (kit.pointer().id !== ally.id) {
    kit.skipTurn();
  }
  await kit.withDice([15, 4], "stabilize", { characterId: hero.id, healerId: ally.id });
  assert.equal(world.sheet(hero.id).conditionMeta.unconscious.source, "stable");
  await damage(1);
  assert.equal(track().stable, false);
  assert.equal(world.sheet(hero.id).conditionMeta.unconscious, undefined);
  assert.deepEqual(world.sheet(hero.id).conditions, ["unconscious", "prone"]);
});

// ---- the dead ----

await test("the dead take no actions, no damage, no healing and no rest", async () => {
  dying(DEAD);
  kit.freshTurn();
  const refused = [
    ["pc_attack", { characterId: hero.id, enemyId: goblin.id, targetEnemyId: goblin.id }],
    ["take_action", { characterId: hero.id, action: "dash" }],
    ["use_reaction", { characterId: hero.id, feature: "Opportunity attack" }],
    ["apply_damage", { characterId: hero.id, amount: 5 }],
    ["heal", { characterId: hero.id, amount: 5 }],
    ["stabilize", { characterId: hero.id }],
    ["cast_at_player", {
      characterId: hero.id, spell: "Gaze", saveAbility: "wis", dc: 10, condition: "frightened",
    }],
  ];
  for (const [name, args] of refused) {
    const out = await kit.withDice([17, 4], name, args);
    assert.equal(out.outcome.ok, false, `${name} answered for a dead character`);
    assert.deepEqual(out.dice, [], name);
  }
  assert.deepEqual(track(), DEAD);
  assert.equal(hp(), 0);
});

await test("neither rest raises the dead", async () => {
  const ended = await world.invoke("end_encounter", { outcome: "truce" });
  assert.equal(ended.ok, true, ended.error);
  dying(DEAD);
  const before = world.sheet(hero.id);
  for (const kind of ["short", "long"]) {
    const out = await world.invoke("take_rest", { kind });
    assert.equal(out.ok, true, out.error);
  }
  const after = world.sheet(hero.id);
  assert.deepEqual(after.deathSaves, DEAD);
  assert.equal(after.currentHp, 0);
  assert.deepEqual(after.hitDice, before.hitDice);
});

await test("a stable creature regains 1 hit point when its 1d4 hours have passed on the clock", async () => {
  // No fight is running here, so the healer has no turn to wait for.
  kit.reset(hero.id, { currentHp: 6 });
  await damage(6);
  const out = await kit.withDice([14, 3], "stabilize", { characterId: hero.id, healerId: ally.id });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(world.sheet(hero.id).conditionMeta.unconscious.rounds, 3 * 600);
  await world.invoke("pass_time", { amount: 179, unit: "minutes" });
  assert.equal(hp(), 0);
  assert.equal(track().stable, true);
  await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(hp(), 1);
  assert.equal(track(), null);
  assert.deepEqual(world.sheet(hero.id).conditions, ["prone"]);
});

await test("a stable creature with no wait of its own wakes once four hours pass in one stretch", async () => {
  // A sheet stabilized before the wait was kept: the track says stable and
  // nothing counts down.
  dying({ successes: 3, failures: 1, stable: true, dead: false });
  await world.invoke("pass_time", { amount: 239, unit: "minutes" });
  assert.equal(hp(), 0);
  await world.invoke("pass_time", { amount: 4, unit: "hours" });
  assert.equal(hp(), 1);
  assert.equal(track(), null);
});

await test("a dying character waits for help: time alone neither wakes nor kills them", async () => {
  dying({ ...FRESH, failures: 2 });
  await world.invoke("pass_time", { amount: 8, unit: "hours" });
  assert.equal(hp(), 0);
  assert.deepEqual(track(), { ...FRESH, failures: 2 });
});

await test("a short rest spends no hit dice for a character at 0 hit points", async () => {
  dying({ successes: 3, failures: 1, stable: true, dead: false });
  const before = world.sheet(hero.id).hitDice.spent;
  await kit.withDice([10], "take_rest", { kind: "short", spend: [{ characterId: hero.id, dice: 1 }] });
  assert.equal(hp(), 0);
  assert.equal(world.sheet(hero.id).hitDice.spent, before);
});

// ---- Relentless Endurance ----

await test("Relentless Endurance holds a half-orc at 1 hit point, once a long rest", async () => {
  kit.reset(orc.id, { currentHp: 5 });
  world.patch(orc.id, { resources: { ...world.sheet(orc.id).resources, relentless_endurance: { max: 1, used: 0 } } });
  await damage(9, orc.id);
  assert.equal(hp(orc.id), 1);
  assert.equal(track(orc.id), null);
  assert.equal(world.sheet(orc.id).resources.relentless_endurance.used, 1);
  await damage(9, orc.id);
  assert.equal(hp(orc.id), 0);
  assert.deepEqual(track(orc.id), FRESH);
  kit.reset(orc.id, { currentHp: 5 });
  // One long rest in 24 hours, and this table has had one.
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  assert.equal(world.sheet(orc.id).resources.relentless_endurance.used, 0);
});

// ---- gaps ----

await world.beginFight([{ monster: "goblin", count: 2 }], {
  heroFaces: { [hero.id]: 20, [ally.id]: 18, [orc.id]: 2 },
});
kit.offBoard();
const [raider] = world.enemies();

await test("a character dropped to 0 hit points is unconscious: attacks on them have advantage and a hit from within 5 ft is a critical, two death save failures", async () => {
  kit.reset(hero.id, { currentHp: 7 });
  await damage(7);
  assert.deepEqual(world.sheet(hero.id).conditions, ["unconscious", "prone"]);
  assert.deepEqual(track(), FRESH);
  const out = await kit.withDice([3, 17, 4, 4], "enemy_attack", {
    enemyId: raider.id,
    targetCharacterId: hero.id,
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(kit.d20s(out.dice), 2, `the attack on a dying character rolled ${out.dice.join(" ")}`);
  assert.equal(track().failures, 2);
});

await test("A creature at 0 hit points is unconscious whatever wrote the 0: attack rolls against it have advantage and any hit from within 5 ft is a critical hit, which at 0 hit points is two death save failures (SRD 5.1, Dropping to 0 Hit Points and Conditions).", async () => {
  dying();
  assert.deepEqual(world.sheet(hero.id).conditions, []);
  const out = await kit.withDice([3, 17, 4, 4], "enemy_attack", {
    enemyId: raider.id,
    targetCharacterId: hero.id,
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(kit.d20s(out.dice), 2, `the attack on a dying character rolled ${out.dice.join(" ")}`);
  assert.equal(track().failures, 2);
});

await test("Damage taken at 0 hit points that equals or exceeds the hit point maximum is instant death (SRD 5.1, Damage at 0 Hit Points).", async () => {
  dying();
  await damage(40);
  assert.equal(track().dead, true, `40 damage at 0 of a 40 maximum left ${track().failures} failure(s)`);
});

await test("Relentless Endurance applies 'when you are reduced to 0 hit points but not killed outright' (SRD 5.1, Half-Orc).", async () => {
  kit.reset(orc.id, { currentHp: 5 });
  world.patch(orc.id, { resources: { ...world.sheet(orc.id).resources, relentless_endurance: { max: 1, used: 0 } } });
  await damage(45, orc.id);
  assert.equal(track(orc.id)?.dead, true, `45 damage at 5 of 40 left the half-orc at ${hp(orc.id)} hit point`);
});

await test("Stabilizing a creature takes an action and a successful DC 10 Wisdom (Medicine) check, or a use of a healer's kit (SRD 5.1, Stabilizing a Creature).", async () => {
  dying();
  const out = await kit.withDice([1], "stabilize", { characterId: hero.id });
  assert.ok(
    !out.outcome.ok || kit.d20s(out.dice) === 1,
    "stabilized with no healer named, no Medicine check rolled and no kit spent",
  );
});

await test("A dead character takes no part in the game: no experience, no checks, no new conditions.", async () => {
  dying(DEAD);
  const before = world.sheet(hero.id).xp;
  await world.invoke("award_xp", { characterIds: [hero.id], amount: 100 });
  assert.equal(world.sheet(hero.id).xp, before, "a dead character was awarded 100 XP");
});

await test("A dead character makes no ability checks or saving throws.", async () => {
  dying(DEAD);
  const out = await kit.withDice([15], "request_roll", {
    characterId: hero.id, kind: "ability_check", ability: "str", dc: 10,
  });
  assert.equal(out.outcome.ok, false, `a dead character rolled ${out.dice.join(" ")}`);
});

world.close();
finish();
