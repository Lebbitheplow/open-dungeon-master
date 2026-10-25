// What a blow carries to the defences it meets: whether it is magical, a
// spell's, silvered or adamantine, a type whose resistance a feature sets
// aside, and the board's own defences (Silence, a golem's Absorption). Each
// path that lands damage on a creature carries them the same way, for a
// blow of one type or of several, on an enemy row or on a character
// fighting on the foes' side.
//
// The rules, from SRD 5.1:
//   - Stat blocks: "bludgeoning, piercing, and slashing from nonmagical
//     attacks" is not met by a spell or a magic weapon; "that aren't
//     silvered" is also passed by a silvered weapon (Silvered Weapons).
//   - Silence: "Any creature or object entirely inside the sphere is immune
//     to thunder damage."
//   - Iron Golem, Fire Absorption; Clay Golem, Acid Absorption: "Whenever
//     the golem is subjected to [that] damage, it takes no damage and
//     instead regains a number of hit points equal to the [that] damage
//     dealt."
//   - Ice Storm: 2d8 bludgeoning and 4d6 cold, a spell's damage.
//
// ODM's rules, pinned here:
//   - Elemental Adept (fire) sets fire resistance aside for the adept's
//     spells (src/lib/srd/feat-combat.ts), a character's resistance as well
//     as an enemy's.
//   - A blow of several types heals a golem by the part it absorbs once the
//     rest of the blow has landed.
//   - Tipsy Sway turns the attacker's own blow: a creature whose weapon
//     attacks are magical still strikes with magic.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { caster, closeTables, enemyOf, FIGHTER } from "./lib/enforce-spell-kit.mjs";
import { board, holdTurn, nextTurn } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-damage-flags");
const encounters = await import("../src/lib/db/encounters.ts");

const NONMAGICAL = "bludgeoning, piercing, and slashing from nonmagical attacks";
const UNSILVERED = `${NONMAGICAL} that aren't silvered`;
const FIRE_ABSORPTION = "Fire Absorption: Whenever the golem is subjected to fire damage, it takes no damage and instead regains a number of hit points equal to the fire damage dealt.";
const ACID_ABSORPTION = "Acid Absorption: Whenever the golem is subjected to acid damage, it takes no damage and instead regains a number of hit points equal to the acid damage dealt.";
// An enemy's block with the defences a test states, and no others.
const { getDatabase } = await import("../src/lib/db/core.ts");
function dress(table, enemyId, patch) {
  const row = enemyOf(table, enemyId);
  getDatabase()
    .prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?")
    .run(JSON.stringify({ ...row.stats, resist: "", immune: "", vulnerable: "", ...patch }), enemyId);
}

// ---- a character fighting on the foes' side ----

const world = await openWorld();
const kit = await combatKit(world);
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const BODY = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
const hero = world.addHero({
  name: "Mira", class: "fighter", level: 5, abilities: BODY, proficiencies: TRAINED, maxHp: 40, ac: 12, acOverride: true,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Silvered Longsword", srdName: "Longsword", qty: 1, tags: ["silvered"] }],
});
const mage = world.addHero({
  name: "Vex", ...caster("wizard", "int", [], ["Fire Bolt"], 9), maxHp: 40, ac: 12, acOverride: true,
  feats: ["Elemental Adept"], features: [{ name: "Elemental Adept: fire", source: "story" }],
});

async function turncoat(extra = {}) {
  await kit.endFight();
  for (const sheet of [hero, mage]) {
    world.patch(sheet.id, { currentHp: 40, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, concentratingOn: null });
  }
  const joined = await world.invoke("add_companion", {
    gender: "Unknown", name: `Aldric ${Math.random().toString(36).slice(2, 6)}`, class: "fighter", race: "human", level: 3, personality: "Grim.", kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  const id = joined.result.characterId;
  world.patch(id, {
    abilities: BODY, proficiencies: TRAINED, maxHp: 30, currentHp: 30, ac: 10, acOverride: true,
    equipment: [{ name: "Longsword", qty: 1 }], conditions: [], conditionMeta: {}, ...extra,
  });
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [mage.id]: 18, [id]: 3 } });
  kit.place(hero.id, 2, 2);
  kit.place(mage.id, 4, 2);
  kit.place(id, 3, 2);
  world.enemies().forEach((enemy, index) => kit.place(enemy.id, 14 + index * 2, 14));
  moveToSide(world.campaign(), id, "foe");
  return world.sheet(id);
}

await test("A silvered sword passes a turncoat's form that is immune to nonmagical blows that aren't silvered; a plain one does not.", async () => {
  const foe = await turncoat({
    wildShape: { form: "Wererat", beastHp: 40, beastMaxHp: 40, beastAc: 10, immune: UNSILVERED },
  });
  kit.giveTurn(hero.id);
  world.dice(18, 6);
  const plain = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(plain.ok, true, plain.error);
  assert.equal(world.sheet(foe.id).wildShape.beastHp, 40, "a plain sword hurt a form immune to it");
  kit.giveTurn(hero.id);
  world.dice(18, 6);
  const silvered = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, weapon: "Silvered Longsword" });
  world.clearDice();
  assert.equal(silvered.ok, true, silvered.error);
  assert.equal(world.sheet(foe.id).wildShape.beastHp, 40 - 9, "the silvered sword's 9 did not land");
});

await test("Elemental Adept's fire ignores a tiefling turncoat's fire resistance, as it ignores an enemy's.", async () => {
  const foe = await turncoat({ race: "tiefling" });
  // Out of reach, so the bolt is not shot at disadvantage.
  kit.place(mage.id, 9, 2);
  kit.giveTurn(mage.id);
  // The bolt's attack, then 2d10 of 5 and 5 for a 9th-level caster.
  world.dice(18, 5, 5);
  const out = await world.invoke("pc_attack", { characterId: mage.id, targetEnemyId: foe.id, spell: "Fire Bolt" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(foe.id).currentHp, 30 - 10, JSON.stringify(out.result));
});

world.close();

// ---- the board: spells, Silence and the golems ----

await test("Ice Storm on an ally in a beast form that resists nonmagical blows: the bludgeoning is a spell's, so it lands whole.", async () => {
  const { world: table, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Ice Storm"], [], 9), FIGHTER], { 0: { x: 2, y: 8 }, 1: { x: 12, y: 4 }, e0: { x: 20, y: 14 } });
  table.patch(fighter.id, { wildShape: { form: "Stone Bear", beastHp: 100, beastMaxHp: 100, beastAc: 12, resist: NONMAGICAL } });
  // Every die a 4: 2d8 bludgeoning is 8 and 4d6 cold 16, and the save fails.
  table.dice(...new Array(12).fill(4));
  const out = await table.invoke("aoe_damage", { casterId: druid.id, spell: "Ice Storm", characterIds: [fighter.id], saveAbility: "dex", dc: 15, level: 4, atX: 12, atY: 4 });
  table.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(table.sheet(fighter.id).wildShape.beastHp, 100 - 24, JSON.stringify(out.result));
});

await test("Inside Silence a smite's thunder does nothing: only the sword's slashing lands.", async () => {
  const { world: table, sheets: [cleric, fighter], enemies: [goblin] } = await board([caster("cleric", "wis", ["Silence"]), FIGHTER], { 0: { x: 2, y: 8 }, 1: { x: 11, y: 4 }, e0: { x: 12, y: 4 } });
  const cast = await table.invoke("use_spell_slot", { characterId: cleric.id, spell: "Silence", level: 2, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  table.patch(fighter.id, { conditions: ["thunderous smite"], conditionMeta: {} });
  holdTurn(table, fighter.id);
  // To hit, the longsword's d8, the smite's 2d6, the goblin's STR save.
  table.dice(18, 6, 5, 5, 20);
  const out = await table.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  table.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(table, goblin.id).currentHp, 90 - 9, JSON.stringify(out.result));
});

await test("An iron golem's Fire Absorption heals it by a smite's fire riding a sword, after the sword's slashing lands.", async () => {
  const { world: table, sheets: [fighter], enemies: [golem] } = await board([FIGHTER], { 0: { x: 11, y: 4 }, e0: { x: 12, y: 4 } });
  dress(table, golem.id, { immune: "fire", traits: [FIRE_ABSORPTION] });
  encounters.patchEnemyHp(golem.id, 50, "alive");
  table.patch(fighter.id, { conditions: ["searing smite"], conditionMeta: {} });
  holdTurn(table, fighter.id);
  // To hit, the longsword's d8, the smite's 1d6.
  table.dice(18, 6, 4);
  const out = await table.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: golem.id, weapon: "Longsword" });
  table.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(table, golem.id).currentHp, 50 - 9 + 4, JSON.stringify(out.result));
});

await test("A clay golem's Acid Absorption heals it by Acid Arrow's lingering acid at the end of its turn, as it does by the arrow's hit.", async () => {
  const { world: table, sheets: [wizard], enemies: [golem] } = await board([caster("wizard", "int", ["Acid Arrow"])], { 0: { x: 2, y: 4 }, e0: { x: 8, y: 4 } });
  dress(table, golem.id, { traits: [ACID_ABSORPTION] });
  encounters.patchEnemyHp(golem.id, 50, "alive");
  holdTurn(table, wizard.id);
  // A hit, then 4d4 of 1s: the hit heals 4.
  table.dice(18, 1, 1, 1, 1);
  const out = await table.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: golem.id, spell: "Acid Arrow", level: 2 });
  table.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(table, golem.id).currentHp, 54, JSON.stringify(out.result));
  // The golem's turn comes and goes: the 2d4 of 3s heals 6 more.
  table.dice(...new Array(8).fill(3));
  let guard = 0;
  while (enemyOf(table, golem.id).currentHp === 54 && guard < 6) {
    await nextTurn(table);
    guard += 1;
  }
  table.clearDice();
  assert.equal(enemyOf(table, golem.id).currentHp, 60, "the lingering acid hurt the golem instead of healing it");
});

await test("Harm cast by a Death cleric ignores necrotic resistance (Inescapable Destruction), floor and all.", async () => {
  const priest = caster("cleric", "wis", ["Harm"], [], 11, { subclass: "Death Domain" });
  const { world: table, sheets: [cleric], enemies: [goblin] } = await board([priest], { 0: { x: 2, y: 4 }, e0: { x: 4, y: 4 } });
  dress(table, goblin.id, { resist: "necrotic" });
  holdTurn(table, cleric.id);
  // The goblin's CON save fails, then 14d6 of 2s: 28 necrotic.
  table.dice(1, ...new Array(14).fill(2));
  const out = await table.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Harm", level: 6 });
  table.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(table, goblin.id).currentHp, 90 - 28, JSON.stringify(out.result));
});

closeTables();
finish();
