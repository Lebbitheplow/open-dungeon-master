// The rest of a turn's actions and who may act off their own turn
// (src/lib/dm/action-tools.ts take_action, src/lib/dm/object-actions.ts,
// src/lib/dm/grapple.ts, the use_item handler in src/lib/dm/mutations.ts,
// src/lib/dm/pet-tools.ts pet_attack, the off-turn block of
// src/lib/dm/pc-attack-plan.ts).
//
// SRD 5.1:
//   - Use an Object: drinking a potion or feeding one to another creature
//     is an action; the unconscious cannot act. A wand, a weapon or armor is
//     not used up.
//   - Ready: the action is spent on the turn, and the readied response
//     uses the reaction when its trigger comes. Off their own turn a
//     character attacks only as an opportunity attack or a readied action.
//   - Search: an action, a Perception or Investigation check.
//   - Help: an ally's attack against a creature within 5 feet of the helper.
//   - Hide and the grapple contest are ability checks like any other.
//   - A grappled creature escapes with its action; a grapple ends when the
//     grappler is incapacitated or the two are moved apart.
//   - A Beast Master's companion attacks on the ranger's action, a drake on
//     the bonus action, a Pact of the Chain familiar in place of one of the
//     warlock's attacks.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-turn-actions");
const world = await openWorld();
const kit = await combatKit(world);

const fighter = world.addHero({
  class: "fighter", level: 1, maxHp: 30, abilities: { str: 16 },
  proficiencies: { ...TRAINED, skills: ["athletics"] },
  equipment: [
    { name: "Longsword", qty: 1 },
    { name: "Potion of Healing", qty: 3 },
    { name: "Wand of Magic Missiles", qty: 1 },
    { name: "Bag of Holding", qty: 1 },
  ],
});
const ally = world.addHero({
  class: "rogue", level: 11, maxHp: 30, abilities: { dex: 16 },
  proficiencies: { ...TRAINED, skills: ["stealth", "perception"] },
  equipment: [{ name: "Shortsword", qty: 1 }],
});
const ranger = world.addHero({
  class: "ranger", subclass: "Beast Master", level: 3, maxHp: 30, abilities: { dex: 16, wis: 14 },
  proficiencies: TRAINED, equipment: [{ name: "Longbow", qty: 1 }],
});
const heroes = [fighter, ally, ranger];

// The fighter's pack as each test starts it. Written straight to the sheet:
// a wand and a Bag of Holding are not what a new character is built with.
const PACK = [
  { name: "Longsword", qty: 1 },
  { name: "Potion of Healing", qty: 3 },
  { name: "Wand of Magic Missiles", qty: 1 },
  { name: "Bag of Holding", qty: 1 },
];

async function stage(hero) {
  await kit.endFight();
  for (const entry of heroes) {
    world.patch(entry.id, { currentHp: 30, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  world.patch(fighter.id, { equipment: PACK });
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 3]));
  await kit.fight(1, { heroFaces });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemy;
}

const act = (hero, action, args = {}) =>
  world.invoke("take_action", { characterId: hero.id, action, ...args });
const use = (hero, item, args = {}) => world.invoke("use_item", { characterId: hero.id, item, ...args });
const qty = (hero, name) => world.sheet(hero.id).equipment.find((item) => item.name === name)?.qty ?? 0;
const budget = () => world.encounter().turnBudget;

// ---- Use an Object ----

await test("Drinking a potion in a fight is the action: a second potion, or an attack after it, is refused.", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { currentHp: 10 });
  world.dice(1, 1);
  const first = await use(fighter, "Potion of Healing");
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.equal(budget().actionUsed, true);
  const second = await use(fighter, "Potion of Healing");
  assert.equal(second.ok, false);
  assert.equal(qty(fighter, "Potion of Healing"), 2);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, false);
});

await test("Off their own turn a character cannot drink a potion.", async () => {
  await stage(ally);
  world.patch(fighter.id, { currentHp: 10 });
  const out = await use(fighter, "Potion of Healing");
  assert.equal(out.ok, false);
  assert.equal(qty(fighter, "Potion of Healing"), 3);
  assert.equal(world.sheet(fighter.id).currentHp, 10);
});

await test("A character at 0 hit points cannot drink their own potion.", async () => {
  await kit.endFight();
  world.patch(fighter.id, { equipment: PACK, currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const out = await use(fighter, "Potion of Healing");
  assert.equal(out.ok, false);
  assert.equal(qty(fighter, "Potion of Healing"), 3);
  assert.equal(world.sheet(fighter.id).currentHp, 0);
  world.patch(fighter.id, { currentHp: 30, conditions: [], deathSaves: null });
});

await test("use_item uses up consumables only: a wand, a Bag of Holding and a weapon stay in the pack.", async () => {
  await kit.endFight();
  world.patch(fighter.id, { equipment: PACK, currentHp: 30, conditions: [], deathSaves: null });
  for (const item of ["Bag of Holding", "Longsword"]) {
    const out = await use(fighter, item);
    assert.equal(out.ok, false, item);
    assert.equal(qty(fighter, item), 1, item);
  }
  // A wand spends a charge and stays (src/lib/dm/item-use.ts).
  await use(fighter, "Wand of Magic Missiles");
  assert.equal(qty(fighter, "Wand of Magic Missiles"), 1);
});

await test("Feeding a potion to another creature needs them within reach.", async () => {
  await stage(fighter);
  kit.place(ally.id, 15, 15);
  world.patch(ally.id, { currentHp: 5 });
  const out = await use(fighter, "Potion of Healing", { targetCharacterId: ally.id });
  assert.equal(out.ok, false, "fed from across the board");
  assert.equal(world.sheet(ally.id).currentHp, 5);
  kit.place(ally.id, 6, 5);
  world.dice(1, 1);
  const fed = await use(fighter, "Potion of Healing", { targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(fed.ok, true, fed.error);
  assert.equal(world.sheet(ally.id).currentHp, 9);
});

await test("Use an Object is an action take_action spends.", async () => {
  await stage(fighter);
  const out = await act(fighter, "use_object", { reason: "pulls the lever" });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true);
});

// ---- Search ----

await test("Search is an action and a Perception check the server rolls.", async () => {
  await stage(ally);
  world.dice(12);
  const out = await act(ally, "search");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true);
  const roll = kit.lastRolls(1)[0];
  assert.equal(roll.kind, "skill_check");
  // Perception, proficient: 12 + 1 + 4.
  assert.equal(roll.total, 12 + abilityMod(10) + proficiencyBonus(11));
});

// ---- Ready and off-turn attacks ----

await test("Ready spends the action; the readied attack resolves off turn with the reaction, once.", async () => {
  const enemy = await stage(fighter);
  const out = await act(fighter, "ready", { trigger: "when the goblin steps into reach", reason: "sword up" });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true);
  assert.ok(world.sheet(fighter.id).conditions.includes("readied"));
  assert.equal(kit.endTurn(fighter.userId), true);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.ok(world.encounter().reactionsUsed.includes(fighter.id));
  assert.ok(!world.sheet(fighter.id).conditions.includes("readied"));
});

await test("Off their own turn a character attacks only as an opportunity attack or a readied action.", async () => {
  const enemy = await stage(ally);
  kit.place(fighter.id, 5, 7);
  const hp = kit.enemy(enemy.id).currentHp;
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
  assert.equal(world.encounter().reactionsUsed.includes(fighter.id), false);
});

// ---- Help ----

await test("Help on an attack counts against the creature the helper named, within 5 feet of the helper; another target rolls straight and the help is kept.", async () => {
  await kit.endFight();
  const heroFaces = { [fighter.id]: 19, [ally.id]: 10, [ranger.id]: 3 };
  await kit.fight(2, { heroFaces });
  const [enemy, other] = world.enemies();
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.place(ally.id, 4, 6);
  kit.place(other.id, 3, 6);
  const out = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: enemy.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).conditionMeta.helped?.source, enemy.id);
  assert.equal(kit.endTurn(fighter.userId), true);
  assert.equal(kit.current().characterId, ally.id);
  // Against the other goblin: one d20, and the help is still held.
  const wide = await kit.swing(ally.id, other.id, [15, 3, 4, 4, 4, 4]);
  assert.equal(wide.ok, true, wide.error);
  assert.equal(wide.toHit.advantage ?? "none", "none");
  assert.ok(world.sheet(ally.id).conditions.includes("helped"));
});

await test("The helper must be within 5 feet of the creature the ally attacks.", async () => {
  const enemy = await stage(fighter);
  kit.place(enemy.id, 15, 15);
  const out = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: enemy.id });
  assert.equal(out.ok, false);
  assert.ok(!world.sheet(ally.id).conditions.includes("helped"));
});

// ---- Hide and contests through the roll resolver ----

await test("Hide is a Stealth check like any other: Reliable Talent floors the die at 10.", async () => {
  const enemy = await stage(ally);
  const board = kit.map();
  const wall = [];
  for (let x = 0; x < board.width; x += 1) {
    wall.push([x, 7, "#"]);
  }
  kit.openField(wall);
  kit.place(ally.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  world.dice(2);
  const out = await act(ally, "hide");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.stealth, 10 + abilityMod(16) + proficiencyBonus(11));
});

await test("A held Bardic Inspiration die rides the Hide check and is spent by it.", async () => {
  const enemy = await stage(ally);
  const board = kit.map();
  const wall = [];
  for (let x = 0; x < board.width; x += 1) {
    wall.push([x, 7, "#"]);
  }
  kit.openField(wall);
  kit.place(ally.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  world.patch(ally.id, { conditions: ["bardic inspiration (d6)"], conditionMeta: { "bardic inspiration (d6)": { rounds: 100 } } });
  world.dice(15, 4);
  const out = await act(ally, "hide");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.stealth, 15 + abilityMod(16) + proficiencyBonus(11) + 4);
  assert.ok(!world.sheet(ally.id).conditions.includes("bardic inspiration (d6)"));
});

await test("Out of a fight take_action hide is refused and points to a Stealth check against the watchers.", async () => {
  await kit.endFight();
  const out = await act(ally, "hide");
  assert.equal(out.ok, false);
  assert.ok(!world.sheet(ally.id).conditions.includes("hidden"));
});

await test("The grapple contest is an Athletics check: a held Bardic Inspiration die rides it and is spent.", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { conditions: ["bardic inspiration (d6)"], conditionMeta: { "bardic inspiration (d6)": { rounds: 100 } } });
  // 5 + 5 + d6 of 3 = 13 against 10 + 1.
  world.dice(5, 3, 10);
  const out = await act(fighter, "grapple", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true);
  assert.ok(!world.sheet(fighter.id).conditions.includes("bardic inspiration (d6)"));
});

// ---- the grapple's lifecycle ----

await test("A grappled character escapes with their action: Athletics or Acrobatics against the grappler's Athletics.", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: enemy.id } } });
  world.dice(20, 1);
  const out = await act(fighter, "escape");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true);
  assert.ok(!world.sheet(fighter.id).conditions.includes("grappled"));
  assert.equal(budget().actionUsed, true);
});

await test("A grapple ends when the grappler is moved out of reach of the grappled creature.", async () => {
  const enemy = await stage(fighter);
  world.dice(20, 1);
  assert.equal((await act(fighter, "grapple", { targetEnemyId: enemy.id })).ok, true);
  world.clearDice();
  assert.deepEqual(kit.enemy(enemy.id).conditions, ["grappled"]);
  // Carried off on someone else's turn: forced movement.
  assert.equal(kit.endTurn(fighter.userId), true);
  const moved = await world.invoke("move_token", { tokenName: fighter.id, x: 5, y: 1, forced: true });
  assert.equal(moved.ok, true, moved.error);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
});

await test("A grapple ends when the grappler drops to 0 hit points.", async () => {
  const enemy = await stage(fighter);
  world.dice(20, 1);
  assert.equal((await act(fighter, "grapple", { targetEnemyId: enemy.id })).ok, true);
  world.clearDice();
  const out = await world.invoke("apply_damage", { characterId: fighter.id, amount: 30 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
});

// ---- pets ----

async function summonWolf() {
  const out = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(out.ok, true, out.error);
}

await test("A Beast Master's companion attacks on the ranger's action: once a turn, and the ranger's own Attack action is gone.", async () => {
  await summonWolf();
  const enemy = await stage(ranger);
  world.dice(15, 3, 3);
  const bite = await world.invoke("pet_attack", { characterId: ranger.id, petName: "Wolf", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(budget().actionUsed, true);
  const again = await world.invoke("pet_attack", { characterId: ranger.id, petName: "Wolf", targetEnemyId: enemy.id });
  assert.equal(again.ok, false);
  const shot = await kit.swing(ranger.id, enemy.id, [15, 4]);
  assert.equal(shot.ok, false);
});

await test("A pet commanded by its owner acts on the owner's turn, not off it.", async () => {
  const enemy = await stage(fighter);
  const hp = kit.enemy(enemy.id).currentHp;
  world.dice(15, 3, 3);
  const bite = await world.invoke("pet_attack", { characterId: ranger.id, petName: "Wolf", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(bite.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
});

await test("A pet is not commanded by an owner at 0 hit points.", async () => {
  const enemy = await stage(ranger);
  world.patch(ranger.id, { currentHp: 0, conditions: ["unconscious", "prone"] });
  const bite = await world.invoke("pet_attack", { characterId: ranger.id, petName: "Wolf", targetEnemyId: enemy.id });
  assert.equal(bite.ok, false);
});


// ---- more of the same rules, from the other side ----

await test("a grapple holds on a tie: the escaper has to beat the grappler", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: enemy.id } } });
  // 10 + 5 against 14 + 1.
  world.dice(10, 14);
  const out = await act(fighter, "escape");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, false);
  assert.ok(world.sheet(fighter.id).conditions.includes("grappled"));
});

await test("an enemy escapes a character's grapple with its action, and then it has acted", async () => {
  const enemy = await stage(fighter);
  world.dice(20, 1);
  assert.equal((await act(fighter, "grapple", { targetEnemyId: enemy.id })).ok, true);
  world.clearDice();
  kit.freshRound();
  world.dice(20, 1);
  const out = await world.invoke("take_action", { action: "escape", enemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
  const swing = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id });
  assert.equal(swing.ok, false, "the enemy attacked after spending its action on the escape");
});

await test("Use an Object with a consumable points to use_item and spends nothing", async () => {
  await stage(fighter);
  const out = await act(fighter, "use_object", { item: "Potion of Healing" });
  assert.equal(out.ok, false);
  assert.notEqual(budget()?.actionUsed, true);
  assert.equal(qty(fighter, "Potion of Healing"), 3);
});

await test("Search with Investigation rolls Intelligence (Investigation)", async () => {
  await stage(ally);
  world.dice(9);
  const out = await act(ally, "search", { skill: "investigation" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.lastRolls(1)[0].total, 9 + abilityMod(10));
});

await test("a readied action ends at the start of its owner's next turn", async () => {
  await stage(fighter);
  assert.equal((await act(fighter, "ready", { trigger: "when it moves" })).ok, true);
  while (kit.current().characterId !== fighter.id || world.encounter().round === 1) {
    const current = kit.current();
    if (current.kind === "pc") {
      assert.equal(kit.endTurn(current.userId), true);
    } else {
      await world.invoke("end_turn", {});
    }
    if (world.encounter().round > 2) {
      break;
    }
  }
  assert.equal(kit.current().characterId, fighter.id);
  assert.ok(!world.sheet(fighter.id).conditions.includes("readied"));
});

await test("a Help given for an ability check does not ride an attack", async () => {
  const enemy = await stage(fighter);
  assert.equal((await act(fighter, "help", { targetCharacterId: ally.id })).ok, true);
  assert.equal(kit.endTurn(fighter.userId), true);
  kit.place(ally.id, 6, 6);
  const swing = await kit.swing(ally.id, enemy.id, [15, 3, 4, 4, 4, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.advantage ?? "none", "none");
  assert.ok(world.sheet(ally.id).conditions.includes("helped"));
});

await test("a drake attacks on the ranger's bonus action, once", async () => {
  const warden = world.addHero({
    class: "ranger", subclass: "Drakewarden", level: 3, maxHp: 30, abilities: { dex: 16 }, proficiencies: TRAINED,
    equipment: [{ name: "Longbow", qty: 1 }],
  });
  heroes.push(warden);
  assert.equal((await world.invoke("summon_pet", { characterId: warden.id, kind: "drake", form: "drake" })).ok, true);
  const enemy = await stage(warden);
  world.dice(15, 3);
  const bite = await world.invoke("pet_attack", { characterId: warden.id, petName: "Drake", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().actionUsed, false);
  const again = await world.invoke("pet_attack", { characterId: warden.id, petName: "Drake", targetEnemyId: enemy.id });
  assert.equal(again.ok, false);
  heroes.pop();
});

await kit.endFight();
world.close();
finish();
