// Initiative, as the engine holds it: a d20 plus the Dexterity modifier the
// sheet or the stat block carries, plus what a feat, a feature or a lasting
// effect adds; an order sorted highest first and built once per fight; a
// pointer that rests on one combatant at a time and a round counter that
// moves when the order wraps.
//
// ODM's own rules, pinned here as it documents them:
//   - Ties go to the player characters, then by name
//     (src/lib/dm/encounter-logic.ts buildOrder). SRD 5.1 leaves ties between
//     a monster and a player to the DM.
//   - The pointer rests only on player characters. Enemies act inside the
//     DM's turn as the pointer passes them (advanceOrder).
//   - A character at 0 hit points is passed over and the server rolls their
//     death save as the pointer goes by (advancePointer). SRD 5.1 gives them
//     the turn and has them roll at its start: the same roll, one per round.
//   - Surprise costs the surprised side its first turn (surprisedIds).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-initiative");
const world = await openWorld();
const kit = await combatKit(world);
const { getFloor } = await import("../src/lib/db/campaigns.ts");

const quick = world.addHero({ class: "fighter", level: 5, abilities: { dex: 16 }, proficiencies: TRAINED });
const alert = world.addHero({ class: "fighter", level: 5, abilities: { dex: 12 }, feats: ["Alert"], proficiencies: TRAINED });
const bard = world.addHero({ class: "bard", level: 5, abilities: { dex: 14 }, proficiencies: TRAINED });
const clumsy = world.addHero({ class: "wizard", level: 5, abilities: { dex: 7 }, proficiencies: TRAINED });

const entryOf = (encounter, id) =>
  encounter.order.find((entry) => (entry.characterId ?? entry.enemyId) === id);

await test("a character's initiative is the d20 plus what the sheet adds", async () => {
  const encounter = await kit.fight(2, {
    heroFaces: { [quick.id]: 12, [alert.id]: 12, [bard.id]: 12, [clumsy.id]: 12 },
    enemyFace: 9,
  });
  // DEX 16: +3.
  assert.equal(entryOf(encounter, quick.id).initiative, 12 + abilityMod(16));
  // Alert: +5 on top of DEX 12.
  assert.equal(entryOf(encounter, alert.id).initiative, 12 + abilityMod(12) + 5);
  // Jack of All Trades: half the proficiency bonus, rounded down, because
  // initiative is a Dexterity check the bard is not proficient in.
  assert.equal(
    entryOf(encounter, bard.id).initiative,
    12 + abilityMod(14) + Math.floor(proficiencyBonus(5) / 2),
  );
  // DEX 7: -2.
  assert.equal(entryOf(encounter, clumsy.id).initiative, 12 + abilityMod(7));
});

await test("an enemy's initiative is rolled by the server from its stat block", async () => {
  const encounter = world.encounter();
  for (const enemy of world.enemies()) {
    // kit.fight rewrote the stat block after the roll, so the modifier the
    // roll used is the difference from the forced face.
    const modifier = enemy.initiative - 9;
    assert.ok(Number.isInteger(modifier) && modifier >= -5 && modifier <= 10);
    // The SRD goblin has DEX 14.
    if (world.hasPack) {
      assert.equal(modifier, abilityMod(14));
    }
    assert.equal(entryOf(encounter, enemy.id).initiative, enemy.initiative);
  }
});

await test("the order is sorted highest first", () => {
  const counts = world.encounter().order.map((entry) => entry.initiative);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

await test("the pointer starts on the highest player character, in round 1", () => {
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true);
  assert.equal(encounter.round, 1);
  // Alert's 18 leads.
  assert.equal(kit.current().characterId, alert.id);
  const floor = getFloor(world.campaignId);
  assert.equal(floor.mode, "initiative");
  assert.deepEqual(floor.userIds, [alert.userId]);
});

await test("initiative is rolled once: a second roll does not move anyone", async () => {
  const before = world.encounter().order;
  world.dice(20);
  const again = await world.invoke("request_roll", {
    characterId: clumsy.id,
    kind: "initiative",
    reason: "again",
  });
  world.clearDice();
  assert.equal(again.ok, true, again.error);
  assert.deepEqual(world.encounter().order, before);
});

await test("the round counter moves when the order wraps, and only then", async () => {
  // Order: alert 18, bard 15, quick 15 (by name: Hero 1 before Hero 3),
  // enemies, clumsy 10.
  const order = world.encounter().order.filter((entry) => entry.kind === "pc");
  for (let index = 0; index < order.length; index += 1) {
    assert.equal(kit.current().characterId, order[index].characterId);
    assert.equal(world.encounter().round, 1);
    assert.equal(kit.endTurn(order[index].userId), true);
  }
  assert.equal(world.encounter().round, 2);
  assert.equal(kit.current().characterId, order[0].characterId);
});

await test("a character at 0 hit points is passed and rolls a death save as the pointer goes by", async () => {
  const order = world.encounter().order.filter((entry) => entry.kind === "pc");
  const downed = order[1];
  const sheet = world.sheet(downed.characterId);
  const hurt = await world.invoke("apply_damage", {
    characterId: sheet.id,
    amount: sheet.currentHp,
    reason: "test",
  });
  assert.equal(hurt.ok, true, hurt.error);
  assert.equal(world.sheet(sheet.id).currentHp, 0);
  const before = world.sheet(sheet.id).deathSaves;
  world.clearDice();
  world.dice(15);
  assert.equal(kit.endTurn(order[0].userId), true);
  world.clearDice();
  // The pointer went past the downed character to the next one standing.
  assert.equal(kit.current().characterId, order[2].characterId);
  const after = world.sheet(sheet.id).deathSaves;
  assert.equal(after.successes, (before?.successes ?? 0) + 1);
  assert.equal(after.failures, before?.failures ?? 0);
  // One save per pass, never two.
  world.dice(15);
  assert.equal(kit.endTurn(order[2].userId), true);
  world.clearDice();
  assert.equal(world.sheet(sheet.id).deathSaves.successes, (before?.successes ?? 0) + 1);
});

await test("ties go to player characters first, then by name (ODM's rule)", async () => {
  await kit.endFight();
  // Every hero totals 10, and the enemies are forced onto 10 as well by
  // rewriting their count before the order is built.
  const faces = {
    [quick.id]: 10 - abilityMod(16),
    [alert.id]: 10 - abilityMod(12) - 5,
    [bard.id]: 10 - abilityMod(14) - Math.floor(proficiencyBonus(5) / 2),
    [clumsy.id]: 10 - abilityMod(7),
  };
  // The console rolls the heroes as the fight opens, so the order is built
  // there: the goblins' face is found first (count minus face is their
  // modifier), then the fight is started again with every total on 10.
  world.clearDice();
  world.dice(10, 10);
  const probe = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 2 }] });
  assert.equal(probe.ok, true, probe.error);
  const modifier = world.enemies()[0].initiative - 10;
  await kit.endFight();
  await world.beginFight([{ monster: "goblin", count: 2 }], { heroFaces: faces, enemyFace: 10 - modifier });
  const order = world.encounter().order;
  assert.ok(order.every((entry) => entry.initiative === 10));
  assert.deepEqual(
    order.map((entry) => entry.kind),
    ["pc", "pc", "pc", "pc", "enemy", "enemy"],
  );
  const names = order.map((entry) => entry.name);
  assert.deepEqual(names.slice(0, 4), [...names.slice(0, 4)].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(names.slice(4), [...names.slice(4)].sort((a, b) => a.localeCompare(b)));
});

// Both shapes are sent to set_effect: the console's flat `field` is folded
// into `modifiers` and then reported missing by its own pre-flight check
// (src/lib/dm/invoke.ts normalizeArgs, then checkArgs).
const effect = (characterId, name, modifier) =>
  world.invoke("set_effect", { characterId, name, field: modifier.field, modifiers: [modifier] });

await test("a lasting effect granting advantage on initiative rolls two dice and keeps the higher", async () => {
  await kit.endFight();
  const set = await effect(quick.id, "Foresight", { field: "initiative", mode: "advantage" });
  assert.equal(set.ok, true, set.error);
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [quick.id]: [4, 17] } });
  assert.equal(entryOf(world.encounter(), quick.id).initiative, 17 + abilityMod(16));
  const cleared = await world.invoke("clear_effect", { characterId: quick.id, name: "Foresight" });
  assert.equal(cleared.ok, true, cleared.error);
});

await test("A lasting effect that adds to initiative is added to the initiative roll (docs/rules-coverage.md: effects applied to saves, checks and initiative).", async () => {
  await kit.endFight();
  const set = await effect(quick.id, "Gift of Alacrity", { field: "initiative", mode: "add", value: 4 });
  assert.equal(set.ok, true, set.error);
  try {
    await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [quick.id]: 8 } });
    const rolled = entryOf(world.encounter(), quick.id).initiative;
    assert.equal(rolled, 8 + abilityMod(16) + 4, `initiative came to ${rolled} with a +4 effect on it`);
  } finally {
    await world.invoke("clear_effect", { characterId: quick.id, name: "Gift of Alacrity" });
  }
});

await test("a dead or fled enemy cannot act", async () => {
  await kit.endFight();
  await kit.fight(3);
  const [dead, fled, standing] = world.enemies();
  const hero = world.sheet(kit.current().characterId);
  kit.place(hero.id, 5, 5);
  kit.place(dead.id, 6, 5);
  kit.place(fled.id, 4, 5);
  kit.place(standing.id, 5, 6);
  const killed = await world.invoke("damage_enemy", { enemyId: dead.id, amount: 40 });
  assert.equal(killed.ok, true, killed.error);
  assert.equal(kit.enemy(dead.id).status, "dead");
  const ran = await world.invoke("enemy_flees", { enemyId: fled.id });
  assert.equal(ran.ok, true, ran.error);
  assert.equal(kit.enemy(fled.id).status, "fled");
  const hpBefore = world.sheet(hero.id).currentHp;
  for (const gone of [dead, fled]) {
    world.dice(20, 6, 6);
    const swing = await world.invoke("enemy_attack", { enemyId: gone.id, targetCharacterId: hero.id });
    world.clearDice();
    assert.equal(swing.ok, false);
  }
  assert.equal(world.sheet(hero.id).currentHp, hpBefore);
});

await test("surprised enemies are skipped by the pointer for the first round only", async () => {
  await kit.endFight();
  const encounter = await kit.fight(2, { surprised: "enemies" });
  assert.equal(encounter.orderReady, true);
  assert.deepEqual([...encounter.surprisedIds].sort(), world.enemies().map((enemy) => enemy.id).sort());
  const order = encounter.order.filter((entry) => entry.kind === "pc");
  for (const entry of order) {
    assert.equal(kit.endTurn(entry.userId), true);
  }
  assert.equal(world.encounter().round, 2);
  assert.deepEqual(world.encounter().surprisedIds, []);
});

await test("A surprised creature cannot take an action on its first turn of the fight.", async () => {
  await kit.endFight();
  await kit.fight(1, { surprised: "enemies" });
  const [enemy] = world.enemies();
  const hero = world.sheet(kit.current().characterId);
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  assert.equal(world.encounter().round, 1);
  assert.ok(world.encounter().surprisedIds.includes(enemy.id));
  world.dice(15, 3);
  const swing = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(swing.ok, false, "a surprised enemy attacked in round 1");
});

await test("When the party is surprised the fight still has an order: the enemies act in round 1 and the party from round 2.", async () => {
  await kit.endFight();
  const encounter = await kit.fight(1, { surprised: "party" });
  assert.equal(encounter.orderReady, true, "the initiative order never locked");
});

await test("a surprised party loses round 1 to the enemies, and round 2 opens on the first character", async () => {
  // A table with nobody Alert at it, so the whole party is caught.
  const table = await openWorld();
  const tableKit = await combatKit(table);
  const fast = table.addHero({ class: "fighter", level: 5, abilities: { dex: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
  const slow = table.addHero({ class: "fighter", level: 5, abilities: { dex: 10 }, proficiencies: TRAINED });
  // The enemy rolls 12, between the two characters.
  const encounter = await tableKit.fight(1, {
    surprised: "party",
    enemyFace: 12,
    heroFaces: { [fast.id]: 15, [slow.id]: 2 },
  });
  assert.equal(encounter.orderReady, true);
  assert.equal(encounter.round, 2);
  assert.deepEqual(encounter.surprisedIds, []);
  assert.equal(tableKit.current().characterId, fast.id);
  assert.equal(getFloor(table.campaignId).mode, "initiative");
  const [enemy] = table.enemies();
  tableKit.place(fast.id, 5, 5);
  tableKit.place(enemy.id, 6, 5);
  table.patch(fast.id, { ac: 12, acOverride: true });
  const swing = async () => {
    table.dice(15, 3);
    const out = await table.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fast.id });
    table.clearDice();
    return out;
  };
  // The round the party lost, then the enemy's own action of round 2, and
  // no third.
  assert.equal((await swing()).ok, true);
  assert.equal((await swing()).ok, true);
  assert.equal((await swing()).ok, false);
  // The character acts in round 2.
  table.dice(15, 4);
  const mine = await tableKit.attack(fast.id, enemy.id);
  table.clearDice();
  assert.equal(mine.ok, true, mine.error);
  await tableKit.endFight();
});

await test("with one character Alert the fight opens on them in round 1, and the surprised wait", async () => {
  await kit.endFight();
  const encounter = await kit.fight(1, { surprised: "party" });
  assert.equal(encounter.round, 1);
  assert.equal(kit.current().characterId, alert.id);
  assert.deepEqual(
    [...encounter.surprisedIds].sort(),
    [quick.id, bard.id, clumsy.id].sort(),
  );
  const [enemy] = world.enemies();
  kit.place(quick.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  world.dice(15, 4);
  const refused = await kit.attack(quick.id, enemy.id);
  assert.equal(world.clearDice(), 2);
  assert.equal(refused.ok, false, "a surprised character attacked in round 1");
});

await test("a surprised enemy walked past at the end of round 1 has lost that turn, not postponed it", async () => {
  await kit.endFight();
  // Enemies roll 1 and stand last in the order.
  const encounter = await kit.fight(1, { surprised: "enemies", enemyFace: 1 });
  const [enemy] = world.enemies();
  assert.equal(encounter.order.at(-1).enemyId, enemy.id);
  const order = encounter.order.filter((entry) => entry.kind === "pc");
  for (const entry of order) {
    assert.equal(kit.endTurn(entry.userId), true);
  }
  assert.equal(world.encounter().round, 2);
  const hero = world.sheet(kit.current().characterId);
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  world.dice(15, 3);
  const early = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(early.ok, false, "the turn lost to surprise was taken at the top of round 2");
  // Its turn comes at the end of round 2, as the order says.
  for (const entry of order) {
    assert.equal(kit.endTurn(entry.userId), true);
  }
  assert.equal(world.encounter().round, 3);
  world.dice(15, 3);
  const late = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(late.ok, true, late.error);
});

await test("a surprised enemy does not walk in round 1 either", async () => {
  await kit.endFight();
  await kit.fight(1, { surprised: "enemies" });
  const [enemy] = world.enemies();
  const before = kit.token(enemy.id);
  const moved = await world.invoke("move_token", { tokenName: enemy.id, x: before.x - 1, y: before.y });
  assert.equal(moved.ok, false);
  assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [before.x, before.y]);
  // A shove moves it all the same.
  const pushed = await world.invoke("move_token", {
    tokenName: enemy.id, x: before.x - 1, y: before.y, forced: true,
  });
  assert.equal(pushed.ok, true, pushed.error);
});

await test("A surprised creature cannot take a reaction until its first turn ends.", async () => {
  await kit.endFight();
  await kit.fight(1, { surprised: "party" });
  assert.ok(world.encounter().surprisedIds.includes(quick.id));
  const reacted = await world.invoke("use_reaction", { characterId: quick.id, feature: "Opportunity attack" });
  assert.equal(reacted.ok, false, "a surprised character spent a reaction");
});

await test("A character with the Alert feat cannot be surprised while conscious.", async () => {
  await kit.endFight();
  await kit.fight(1, { surprised: "party" });
  assert.ok(!world.encounter().surprisedIds.includes(alert.id), "the Alert character was surprised");
});

await test("A character who joins a fight in progress rolls initiative and takes a place in the order.", async () => {
  await kit.endFight();
  await kit.fight(1);
  const late = world.addHero({ class: "fighter", level: 5, proficiencies: TRAINED });
  world.dice(14);
  const rolled = await world.invoke("request_roll", { characterId: late.id, kind: "initiative" });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  assert.ok(entryOf(world.encounter(), late.id), "the late character has no place in the order");
});

await kit.endFight();
world.close();
finish();
