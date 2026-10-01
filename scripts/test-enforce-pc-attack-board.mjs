// What the battle map does to an attack, for both sides, every die forced:
// light and darkness decide who sees whom, a hidden target is an unseen one,
// a creature in the line gives cover, and an opportunity attack is a real
// attack through the full damage paths (src/lib/dm/opportunity.ts).
//
// The rules, from SRD 5.1:
//   - Unseen attackers and targets: attacking a target you cannot see is at
//     disadvantage; a target that cannot see you gives you advantage. In
//     darkness a creature without darkvision (or a light) sees nothing.
//     Dim light only hampers Perception.
//   - A creature hiding is unseen; attacks against it have disadvantage.
//   - Cover: another creature between the attacker and the target gives half
//     cover (+2 AC).
//   - Opportunity attacks: one melee attack with the reaction, against a
//     creature the reactor can see leaving its reach. It is an attack like
//     any other: the damage runs the whole damage path (concentration, a
//     beast form's hit points), the attacker's riders ride it (a magic
//     weapon, Sneak Attack), and a creature it kills leaves the board.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-pc-attack-board");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { getDatabase } = await import("../src/lib/db/core.ts");
const maps = await import("../src/lib/db/battle-maps.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { clearLitTilesCache } = await import("../src/lib/battlemap/lit-cache.ts");
const { resolveOpportunityAttacks, resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");

const human = world.addHero({
  class: "fighter", level: 5, race: "human", abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }, { name: "Longsword +1", qty: 1 }],
});
const dwarf = world.addHero({
  class: "fighter", level: 5, race: "hill_dwarf", abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }],
});
const rogue = world.addHero({
  class: "rogue", level: 5, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Rapier", qty: 1 }],
});
const wizard = world.addHero({
  class: "wizard", level: 5, abilities: { int: 16, con: 10 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, known: [], prepared: ["Bless"], cantrips: [] },
});
const heroes = [human, dwarf, rogue, wizard];
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

async function stage(hero, { count = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { equipment: made.equipment, conditions: [], conditionMeta: {}, concentratingOn: null, wildShape: null });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2]));
  await kit.fight(count, { heroFaces });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  kit.giveTurn(hero.id);
  kit.place(hero.id, 5, 5);
  kit.place(enemies[0].id, 5, 6);
  return enemies;
}

// Night under a roof: no ambient light, no lamps, no torches.
function darkBoard() {
  const board = kit.map();
  maps.setBattleMapOutdoors(board.id, false);
  getDatabase().prepare(`UPDATE battle_maps SET ambient = 'dark', lights_json = '[]', zones_json = '[]' WHERE id = ?`).run(board.id);
  for (const token of maps.listTokens(board.id)) {
    maps.setTokenLight(token.id, 0);
  }
  clearLitTilesCache();
}

const seesInDark = { senses: { passivePerception: 10, darkvision: 60 } };
// The rolls a step stored, told apart by id (several share a timestamp).
const rollIds = () => new Set(kit.lastRolls(60).map((roll) => roll.id));
const newRoll = (before, kind = "attack") =>
  kit.lastRolls(60).find((roll) => roll.kind === kind && !before.has(roll.id));
const dieCount = (roll, sides) =>
  (roll?.breakdown?.terms ?? []).filter((term) => term.sides === sides).reduce((sum, term) => sum + term.count, 0);

async function enemySwing(enemyId, characterId, faces) {
  kit.freshRound();
  const before = rollIds();
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId, targetCharacterId: characterId });
  world.clearDice();
  return { out, roll: newRoll(before) };
}

// ---- light ----

await test("In darkness a character with no darkvision attacks a creature it cannot see at disadvantage; a dwarf with darkvision does not.", async () => {
  const [enemy] = await stage(human);
  kit.setEnemy(enemy.id, { stats: seesInDark });
  darkBoard();
  const blind = await kit.swing(human.id, enemy.id, [15, 3, 4], { weapon: "Longsword" });
  assert.equal(blind.toHit.advantage, "disadvantage");
  const [other] = await stage(dwarf);
  kit.setEnemy(other.id, { stats: seesInDark });
  darkBoard();
  const sighted = await kit.swing(dwarf.id, other.id, [15, 4], { weapon: "Longsword" });
  assert.equal(sighted.toHit.advantage, "none");
});

await test("In darkness a creature that cannot see its attacker gives the attacker advantage.", async () => {
  const [enemy] = await stage(dwarf);
  darkBoard();
  const swing = await kit.swing(dwarf.id, enemy.id, [3, 15, 4], { weapon: "Longsword" });
  assert.equal(swing.toHit.advantage, "advantage");
});

await test("Enemies are held to the same light: one with no darkvision attacks a dwarf it cannot see at disadvantage, and one with darkvision attacks a human who cannot see it with advantage.", async () => {
  const [enemy] = await stage(dwarf);
  darkBoard();
  const blind = await enemySwing(enemy.id, dwarf.id, [15, 3, 4]);
  assert.equal(blind.out.ok, true, blind.out.error);
  assert.equal(blind.roll.advantage, "disadvantage");
  const [other] = await stage(human);
  kit.setEnemy(other.id, { stats: seesInDark });
  darkBoard();
  const sighted = await enemySwing(other.id, human.id, [3, 15, 4]);
  assert.equal(sighted.roll.advantage, "advantage");
});

await test("a torch lights both sides of a fight in the dark", async () => {
  const [enemy] = await stage(human);
  darkBoard();
  maps.setTokenLight(kit.token(human.id).id, 4);
  clearLitTilesCache();
  const swing = await kit.swing(human.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(swing.toHit.advantage, "none");
});

// ---- hidden targets ----

await test("A hidden character is an unseen target: an enemy's attack on it is at disadvantage.", async () => {
  const [enemy] = await stage(human);
  world.patch(human.id, { conditions: ["hidden"] });
  const swing = await enemySwing(enemy.id, human.id, [15, 3, 4]);
  assert.equal(swing.out.ok, true, swing.out.error);
  assert.equal(swing.roll.advantage, "disadvantage");
});

// ---- creatures as cover ----

await test("Another creature between the attacker and the target gives the target half cover (+2 AC), both ways.", async () => {
  const [enemy] = await stage(human);
  kit.place(human.id, 5, 2);
  kit.place(dwarf.id, 5, 4);
  kit.place(enemy.id, 5, 6);
  const shot = await kit.swing(human.id, enemy.id, [15, 4], { weapon: "Longbow" });
  assert.equal(shot.result.vsAc, 13 + 2);
  const [archer, screen] = await stage(human, { count: 2 });
  kit.setEnemy(archer.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.place(archer.id, 5, 9);
  kit.place(screen.id, 5, 7);
  const back = await enemySwing(archer.id, human.id, [15, 3]);
  assert.equal(back.out.ok, true, back.out.error);
  assert.equal(back.out.result.vsAc, world.sheet(human.id).ac + 2);
});

// ---- opportunity attacks, the enemy's ----

await test("An enemy's opportunity attack is damage like any other: a concentrating caster it hits makes the CON save and can lose the spell.", async () => {
  await stage(wizard);
  world.patch(wizard.id, { concentratingOn: "Bless" });
  world.clearDice();
  // Hit on 18, 1d6+2 on a 6 for 8, the CON save on a 1.
  world.dice(18, 6, 1);
  resolveOpportunityAttacks(world.campaign(), wizard.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  assert.equal(world.sheet(wizard.id).currentHp, world.sheet(wizard.id).maxHp - 8);
  assert.equal(world.sheet(wizard.id).concentratingOn ?? null, null);
});

await test("An enemy's opportunity attack on a wild-shaped druid takes the beast form's hit points first.", async () => {
  await stage(wizard);
  const hp = world.sheet(wizard.id).currentHp;
  world.patch(wizard.id, { wildShape: { form: "Wolf", beastHp: 20, beastMaxHp: 20, beastAc: 13 } });
  world.clearDice();
  world.dice(18, 6);
  resolveOpportunityAttacks(world.campaign(), wizard.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  assert.equal(world.sheet(wizard.id).wildShape?.beastHp, 12);
  assert.equal(world.sheet(wizard.id).currentHp, hp);
});

await test("An enemy's opportunity attack is a melee attack: a creature with a longbow and a dagger stabs with the dagger, one with only a bow makes none.", async () => {
  const [enemy] = await stage(human);
  kit.setEnemy(enemy.id, { stats: { attacks: [
    { name: "Longbow", toHit: 4, damage: "1d8+2", type: "piercing" },
    { name: "Dagger", toHit: 4, damage: "1d4+2", type: "piercing" },
  ] } });
  const before = rollIds();
  world.clearDice();
  world.dice(18, 3);
  const out = resolveOpportunityAttacks(world.campaign(), human.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  assert.match(newRoll(before).detail, /Dagger/);
  assert.equal(out.notes.length, 1);
  const [archer] = await stage(human);
  kit.setEnemy(archer.id, { stats: { attacks: [{ name: "Longbow", toHit: 4, damage: "1d8+2", type: "piercing" }] } });
  const none = resolveOpportunityAttacks(world.campaign(), human.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  assert.equal(none.notes.length, 0);
});

// ---- opportunity attacks, the party's ----

await test("A character's opportunity attack with a magic weapon passes resistance to nonmagical attacks.", async () => {
  const [enemy] = await stage(human);
  world.patch(human.id, { equipment: [{ name: "Longsword +1", qty: 1 }] });
  kit.setEnemy(enemy.id, { stats: { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } });
  world.clearDice();
  world.dice(15, 4);
  resolvePcOpportunityAttacks(world.campaign(), enemy.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
  world.clearDice();
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + 3 + 1));
});

await test("A rogue's opportunity attack carries Sneak Attack when an ally stands beside the target.", async () => {
  const [enemy] = await stage(rogue);
  kit.place(dwarf.id, 6, 6);
  // The dwarf beside the target has spent their reaction, so only the rogue swings.
  const fight = world.encounter();
  kit.saveEncounter({ ...fight, reactionsUsed: [...fight.reactionsUsed, dwarf.id] });
  const before = rollIds();
  world.clearDice();
  world.dice(15, 4, 1, 1, 1);
  resolvePcOpportunityAttacks(world.campaign(), enemy.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
  const left = world.clearDice();
  assert.equal(left, 0, "the Sneak Attack dice were never rolled");
  assert.equal(dieCount(newRoll(before, "damage"), 6), 3);
});

await test("A creature a character's opportunity attack kills leaves the board, and a concentrating one struck makes its CON save.", async () => {
  const [enemy, second] = await stage(human, { count: 2 });
  kit.place(second.id, 9, 9);
  kit.setEnemy(enemy.id, { currentHp: 3 });
  const board = kit.map();
  world.clearDice();
  world.dice(15, 6);
  resolvePcOpportunityAttacks(world.campaign(), enemy.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
  world.clearDice();
  assert.equal(encounters.getEnemy(enemy.id).status, "dead");
  assert.equal(maps.getTokenByRef(board.id, enemy.id), null);
  const [caster] = await stage(human);
  encounters.setEnemyConcentration(caster.id, "Hold Person");
  world.clearDice();
  world.dice(15, 4, 1);
  resolvePcOpportunityAttacks(world.campaign(), caster.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
  world.clearDice();
  assert.equal(encounters.getEnemy(caster.id).concentration ?? null, null);
});

await test("An opportunity attack needs a creature the reactor can see leaving: in the dark an enemy with no darkvision makes none.", async () => {
  const [enemy] = await stage(human);
  darkBoard();
  world.clearDice();
  world.dice(18, 6);
  const out = resolveOpportunityAttacks(world.campaign(), human.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  assert.equal(out.notes.length, 0, "an enemy with no darkvision struck at a man it could not see");
  void enemy;
});

await test("Escape the Horde (a Hunter's Defensive Tactics): opportunity attacks against the ranger are made at disadvantage.", async () => {
  await stage(human);
  world.patch(human.id, { features: [...base.get(human.id).features, { name: "Defensive Tactics: Escape the Horde", source: "choice" }] });
  const before = rollIds();
  world.clearDice();
  world.dice(18, 3, 6);
  resolveOpportunityAttacks(world.campaign(), human.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  assert.equal(newRoll(before).advantage, "disadvantage");
});

await test("The AI's advantage on an enemy's attack needs a named circumstance the engine does not already decide.", async () => {
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
  const [enemy] = await stage(human);
  const attack = async (args) => {
    kit.freshRound();
    const turn = createDmTurn(world.campaignId, [], "ai");
    // The AI's enemy acts on its own turn: end turns until the pointer
    // hands it over (src/lib/dm/enemy-turn-order.ts).
    for (let guard = 0; guard < 4; guard += 1) {
      const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, {
        name: "end_turn",
        args: { characterId: kit.current().characterId },
      });
      if (JSON.stringify(ended.result?.enemiesToAct ?? []).includes(enemy.id)) {
        break;
      }
    }
    const before = rollIds();
    world.clearDice();
    world.dice(15, 15, 3);
    const out = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, {
      name: "enemy_attack",
      args: { enemyId: enemy.id, targetCharacterId: human.id, ...args },
    });
    world.clearDice();
    return { out, roll: newRoll(before) };
  };
  const bare = await attack({ advantage: "advantage" });
  assert.equal(bare.out.ok, true, bare.out.error);
  assert.equal(bare.roll.advantage, "none");
  const ruled = await attack({ advantage: "advantage", advantageReason: "the fighter slipped on the ice" });
  assert.equal(ruled.out.ok, true, ruled.out.error);
  assert.equal(ruled.roll.advantage, "advantage");
});

await kit.endFight();
world.close();
void d20Faces;
finish();
