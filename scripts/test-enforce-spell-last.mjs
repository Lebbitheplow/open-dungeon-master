// The narrated spells that carry a mechanic, given an engine place (SRD 5.1):
// the movement spells the walk reads (Freedom of Movement, Spider Climb,
// Water Walk, Jump), sight (See Invisibility, True Seeing), the spells that
// take a creature off the Material Plane (Blink, Etherealness, Maze,
// Imprisonment), Mislead's invisibility, Feeblemind, Calm Emotions, Fear's
// flight and Wind Walk.
//
// Every check reads a sheet, an enemy row, the board, the dice rolled or a
// refusal; dice are forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { board, holdTurn, nextTurn, stride, tokenOf, zonesOf } from "./lib/enforce-zones.mjs";
import { nextTurn as roundTurn } from "./lib/enforce-spell-tail.mjs";
import { layMap, onTurnOf } from "./lib/enforce-spells.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { monsterKit } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-spell-last");
const moveRoute = await import("../src/app/api/campaigns/[campaignId]/battle-map/move/route.ts");
const { mintSession } = await import("../src/lib/auth.ts");

const { getDatabase } = await import("../src/lib/db/core.ts");
const encountersDb = () => getDatabase();

// Runs `act` before the fight breaks out (the table is a scene, not a
// fight): a spell that takes a minute to cast is cast then.
async function beforeInitiative(world, act) {
  const id = world.encounter().id;
  const setKind = (kind) => getDatabase().prepare("UPDATE encounters SET kind = ? WHERE id = ?").run(kind, id);
  setKind("scene");
  try {
    return await act();
  } finally {
    setKind("fight");
  }
}

const d20s = (world) => world.diceLog().filter((die) => die.sides === 20).length;
const has = (conditions, name) => conditions.some((entry) => entry.toLowerCase() === name);

// A board of 12 by 5, with `strip` laid on row 2 at x 5 and 6.
function boardRows(strip) {
  return Array.from({ length: 5 }, (_, y) => (y === 2 ? `.....${strip}${strip}.....` : "............"));
}

// A player's own move through the move route, on their turn.
async function move(world, heroId, body) {
  globalThis.__odmTestToken = mintSession(world.sheet(heroId).userId).token;
  return onTurnOf(world, heroId, async () => {
    const response = await moveRoute.POST(
      new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify(body) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
}

async function walkStrip(strip, spell, casterClass, ability, level) {
  const staged = await table([caster(casterClass, ability, [spell], [], 9), FIGHTER]);
  const [mage, fighter] = staged.sheets;
  await layMap(staged.world, boardRows(strip), { [mage.id]: { x: 4, y: 1 }, [fighter.id]: { x: 4, y: 2 }, [staged.enemies[0].id]: { x: 11, y: 4 } });
  const cast = await staged.world.invoke("cast_buff", { characterId: mage.id, spell, level, targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  const walked = await move(staged.world, fighter.id, { x: 6, y: 2 });
  assert.equal(walked.status, 200, JSON.stringify(walked.body));
  return tokenOf(staged.world, fighter.id).movedThisRound;
}

// ---- movement ----

await test("Freedom of Movement: difficult terrain costs the creature no extra movement.", async () => {
  assert.equal(await walkStrip(",", "Freedom of Movement", "cleric", "wis", 4), 2);
});

await test("Freedom of Movement: a spell cannot restrain the creature (Entangle's failed save leaves it free).", async () => {
  const { world, sheets: [cleric, druid, fighter] } = await table([caster("cleric", "wis", ["Freedom of Movement"]), caster("druid", "wis", ["Entangle"]), FIGHTER]);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Freedom of Movement", level: 4, targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  world.dice(1, 1, 1);
  await world.invoke("aoe_damage", { casterId: druid.id, spell: "Entangle", characterIds: [fighter.id], saveAbility: "str", dc: 15, level: 1 });
  world.clearDice();
  assert.ok(!has(world.sheet(fighter.id).conditions, "restrained"), "Entangle restrained a creature under Freedom of Movement");
});

await test("Spider Climb: climbing costs the creature no extra movement.", async () => {
  assert.equal(await walkStrip("^", "Spider Climb", "wizard", "int", 2), 2);
});

await test("Water Walk: the creature crosses water as if it were solid ground.", async () => {
  assert.equal(await walkStrip("~", "Water Walk", "cleric", "wis", 3), 2);
});

await test("Jump: the creature's jump distance is tripled (a standing long jump of STR / 2 feet becomes three times that).", async () => {
  const { world, sheets: [wizard, fighter], enemies: [dummy] } = await table([caster("wizard", "int", ["Jump"]), FIGHTER]);
  await layMap(world, boardRows("."), { [wizard.id]: { x: 1, y: 1 }, [fighter.id]: { x: 1, y: 2 }, [dummy.id]: { x: 11, y: 4 } });
  // STR 16: a standing long jump of 8 feet; 20 feet needs the spell.
  const bare = await move(world, fighter.id, { x: 5, y: 2, jump: true });
  assert.notEqual(bare.status, 200, "a 20-foot standing jump went through without the spell");
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Jump", level: 1, targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  const leapt = await move(world, fighter.id, { x: 5, y: 2, jump: true });
  assert.equal(leapt.status, 200, JSON.stringify(leapt.body));
  assert.deepEqual({ x: tokenOf(world, fighter.id).x, y: tokenOf(world, fighter.id).y }, { x: 5, y: 2 });
});

// ---- sight ----

await test("See Invisibility: the caster attacks an invisible creature without disadvantage.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["See Invisibility"], ["Fire Bolt"])]);
  await world.invoke("set_enemy_condition", { enemyId: goblin.id, condition: "invisible" });
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "See Invisibility", level: 2 });
  assert.equal(cast.ok, true, cast.error);
  world.diceLog();
  const bolt = await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Fire Bolt", damage: "1d10" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(d20s(world), 1, "the attack rolled at disadvantage");
});

// ---- off the Material Plane ----

await test("Blink: at the end of the caster's turn a d20 of 11 or higher sends them to the Ethereal Plane: no attack reaches them until the start of their next turn.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Blink"]), FIGHTER]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Blink", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, wizard.id);
  world.dice(15);
  nextTurn(world);
  world.clearDice();
  assert.ok(has(world.sheet(wizard.id).conditions, "blinked"), "the caster stayed");
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: wizard.id });
  assert.equal(swing.ok, false, "an attack reached a blinked creature");
  const other = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fighter.id });
  assert.ok(other.ok !== false || !/blinked|ethereal/i.test(other.error ?? ""), other.error);
});

await test("Blink: the caster returns at the start of their next turn.", async () => {
  const { world, sheets: [wizard] } = await table([caster("wizard", "int", ["Blink"]), FIGHTER]);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Blink", level: 3 });
  holdTurn(world, wizard.id);
  world.dice(15);
  nextTurn(world);
  world.clearDice();
  assert.ok(has(world.sheet(wizard.id).conditions, "blinked"));
  for (let guard = 0; guard < 6 && world.encounter().order[world.encounter().turnIndex]?.characterId !== wizard.id; guard += 1) {
    world.dice(1);
    nextTurn(world);
    world.clearDice();
  }
  assert.ok(!has(world.sheet(wizard.id).conditions, "blinked"), "the caster is still away on their own turn");
});

await test("Etherealness: the caster cannot be attacked from the Material Plane, and attacks nothing there.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Etherealness"], ["Fire Bolt"], 13)]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Etherealness", level: 7 });
  assert.equal(cast.ok, true, cast.error);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: wizard.id });
  assert.equal(swing.ok, false, "an attack reached an ethereal creature");
  const bolt = await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Fire Bolt", damage: "1d10" });
  assert.equal(bolt.ok, false, "an ethereal caster attacked the Material Plane");
});

await test("Maze: no save; the creature is banished (no attack reaches it) and escapes only with its action and a DC 20 Intelligence check.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Maze"], [], 15), FIGHTER]);
  const cast = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Maze", saveAbility: "int", level: 8 });
  assert.equal(cast.ok, true, cast.error);
  assert.ok(has(enemyOf(world, goblin.id).conditions, "mazed"), "the creature is not in the maze");
  const swing = await world.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: goblin.id });
  assert.equal(swing.ok, false, "an attack reached a creature in the maze");
  world.dice(19);
  const tried = await world.invoke("take_action", { action: "escape", enemyId: goblin.id });
  world.clearDice();
  assert.equal(tried.ok, true, tried.error);
  assert.ok(has(enemyOf(world, goblin.id).conditions, "mazed"), "19 beat DC 20");
});

// Imprisonment takes a minute to cast: never in a fight, and outside one the
// creature has no row to bind, so the DM lays the binding from the console.
await test("An imprisoned creature (Imprisonment's binding) takes no actions and nothing targets it.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Imprisonment"], [], 17), FIGHTER]);
  const bound = await world.invoke("set_enemy_condition", { enemyId: goblin.id, condition: "imprisoned" });
  assert.equal(bound.ok, true, bound.error);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: wizard.id });
  assert.equal(swing.ok, false, "an imprisoned creature attacked");
  const struck = await world.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: goblin.id });
  assert.equal(struck.ok, false, "an attack reached an imprisoned creature");
});

// ---- Mislead ----

await test("Mislead: the caster turns invisible, and the invisibility ends when they attack.", async () => {
  const { world, sheets: [bard], enemies: [goblin] } = await table([caster("bard", "cha", ["Mislead"], ["Vicious Mockery"], 9)]);
  const cast = await world.invoke("cast_buff", { characterId: bard.id, spell: "Mislead", level: 5 });
  assert.equal(cast.ok, true, cast.error);
  assert.ok(has(world.sheet(bard.id).conditions, "invisible"), "the caster is not invisible");
  world.dice(1, 1);
  await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Vicious Mockery", saveAbility: "wis" });
  world.clearDice();
  assert.ok(!has(world.sheet(bard.id).conditions, "invisible"), "casting a spell kept the invisibility");
});

// ---- Feeblemind ----

await test("Feeblemind deals its 4d6 psychic whatever the save; the save only decides the rest.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Feeblemind"], [], 15)]);
  const before = enemyOf(world, goblin.id).currentHp;
  world.dice(20, 1, 1, 1, 1);
  const cast = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Feeblemind", saveAbility: "int", level: 8 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(enemyOf(world, goblin.id).currentHp, before - 4);
  assert.ok(!has(enemyOf(world, goblin.id).conditions, "feebleminded"));
});

// SRD 5.1 Cult Fanatic's spellcasting, as the monster suites stage it.
const FANATIC = {
  name: "Cult Fanatic", size: "Medium", type: "Humanoid", armor_class: 13, hit_points: 33, cr: 2, wisdom: 13,
  actions: [{ name: "Dagger", desc: "Melee or Ranged Weapon Attack: +4 to hit, reach 5 ft. or range 20/60 ft., one creature. Hit: 4 (1d4 + 2) piercing damage.", attack_bonus: 4, damage_dice: "1d4", damage_bonus: 2 }],
  special_abilities: [
    { name: "Spellcasting", desc: "The fanatic is a 4th-level spellcaster. Its spellcasting ability is Wisdom (spell save DC 11, +3 to hit with spell attacks). The fanatic has the following cleric spells prepared:\n\n* Cantrips (at will): light, sacred flame, thaumaturgy\n* 1st level (4 slots): command, inflict wounds, shield of faith\n* 2nd level (3 slots): hold person, spiritual weapon" },
  ],
};

await test("Feeblemind: a creature that fails its INT save can no longer cast spells.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [cultist] } = await table([caster("wizard", "int", ["Feeblemind"], [], 15), FIGHTER]);
  const kit = await combatKit(world);
  const mk = await monsterKit(world, kit);
  mk.stage(cultist.id, FANATIC);
  world.dice(1, 1, 1, 1, 1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: cultist.id, spell: "Feeblemind", saveAbility: "int", level: 8 });
  world.clearDice();
  assert.ok(has(enemyOf(world, cultist.id).conditions, "feebleminded"), "the creature kept its mind");
  const flame = await world.invoke("cast_at_player", { characterId: fighter.id, casterEnemyId: cultist.id, spell: "Sacred Flame", saveAbility: "dex", dc: 11 });
  assert.equal(flame.ok ?? !flame.error, false, "a feebleminded creature cast a spell");
});

// ---- Calm Emotions, Fear ----

await test("Calm Emotions: a humanoid that fails its CHA save is calmed and makes no attacks until it is harmed.", async () => {
  const { world, sheets: [bard, fighter], enemies: [goblin] } = await table([caster("bard", "cha", ["Calm Emotions"]), FIGHTER], 1, { type: "humanoid" });
  world.dice(1);
  const cast = await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Calm Emotions", saveAbility: "cha", level: 2 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(has(enemyOf(world, goblin.id).conditions, "calmed"), "the creature is not calmed");
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fighter.id });
  assert.equal(swing.ok, false, "a calmed creature attacked");
  await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 1 });
  assert.ok(!has(enemyOf(world, goblin.id).conditions, "calmed"), "harm did not end the calm");
});

await test("Fear: a creature frightened by the spell must Dash away; it makes no attacks while the fear lasts.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Fear"]), FIGHTER]);
  world.dice(1);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fear", enemyIds: [goblin.id], saveAbility: "wis", dc: 15, level: 3 });
  world.clearDice();
  assert.ok(has(enemyOf(world, goblin.id).conditions, "frightened"));
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fighter.id });
  assert.equal(swing.ok, false, "a creature fleeing in fear attacked");
});

// ---- Wind Walk ----

await test("Wind Walk: the misty form resists nonmagical weapon damage and makes no attacks.", async () => {
  const { world, sheets: [druid, fighter], enemies: [goblin] } = await table([caster("druid", "wis", ["Wind Walk"], [], 11), FIGHTER]);
  const cast = await beforeInitiative(world, () => world.invoke("cast_buff", { characterId: druid.id, spell: "Wind Walk", level: 6, targetCharacterIds: [fighter.id] }));
  assert.equal(cast.ok, true, cast.error);
  const before = world.sheet(fighter.id).currentHp;
  await world.invoke("apply_damage", { characterId: fighter.id, amount: 10, type: "slashing" });
  assert.equal(world.sheet(fighter.id).currentHp, before - 5);
  const swing = await world.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: goblin.id });
  assert.equal(swing.ok, false, "a creature in Wind Walk's mist attacked");
});

// ---- Divine Word, Prismatic Spray ----

await test("Divine Word: a fiend (or celestial, elemental, fey) that fails its save is forced back to its plane and leaves the fight.", async () => {
  const { world, sheets: [cleric, fighter], enemies: [imp, goblin] } = await table([caster("cleric", "wis", ["Divine Word"], [], 13), FIGHTER], 2);
  encountersDb().prepare("UPDATE encounter_enemies SET stat_json = json_set(stat_json, '$.type', 'fiend') WHERE id = ?").run(imp.id);
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", { casterId: cleric.id, spell: "Divine Word", enemyIds: [imp.id, goblin.id], saveAbility: "cha", dc: 17, level: 7 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, imp.id).status, "fled", "the fiend stayed on this plane");
  assert.equal(enemyOf(world, goblin.id).status, "alive", "the goblin (not extraplanar) was sent away");
  void fighter;
});

await test("Prismatic Spray: each creature rolls its own ray; the red ray deals 10d6 fire on a failed DEX save.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Prismatic Spray"], [], 13)]);
  const before = enemyOf(world, goblin.id).currentHp;
  world.dice(1, 1, ...new Array(10).fill(2));
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Prismatic Spray", enemyIds: [goblin.id], saveAbility: "dex", dc: 17, level: 7 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, goblin.id).currentHp, before - 20);
});

await test("Prismatic Spray's indigo ray restrains, and three failed CON saves at the end of the creature's turns turn it to stone.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Prismatic Spray"], [], 13)]);
  world.dice(1, 6);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Prismatic Spray", enemyIds: [goblin.id], saveAbility: "dex", dc: 17, level: 7 });
  world.clearDice();
  assert.ok(has(enemyOf(world, goblin.id).conditions, "restrained"), "the indigo ray did not restrain");
  roundTurn(world);
  for (let count = 0; count < 3; count += 1) {
    world.dice(1);
    roundTurn(world);
    world.clearDice();
  }
  assert.ok(has(enemyOf(world, goblin.id).conditions, "petrified"), "three failures left it flesh");
});

await test("Prismatic Spray's violet ray blinds; a failed WIS save at the start of the caster's next turn sends the creature to another plane.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Prismatic Spray"], [], 13)]);
  world.dice(1, 7);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Prismatic Spray", enemyIds: [goblin.id], saveAbility: "dex", dc: 17, level: 7 });
  world.clearDice();
  assert.ok(has(enemyOf(world, goblin.id).conditions, "blinded"), "the violet ray did not blind");
  world.dice(1, 1, 1);
  roundTurn(world);
  world.clearDice();
  assert.equal(enemyOf(world, goblin.id).status, "fled", "the creature stayed after failing its WIS save");
});

// ---- Forcecage, Antilife Shell ----

await test("Forcecage: a creature inside the cage cannot walk out of it, and one outside cannot walk in.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board(
    [caster("wizard", "int", ["Forcecage"], [], 13, { equipment: [{ name: "Ruby dust (1,500 gp)", qty: 1 }] }), FIGHTER],
    { 0: { x: 2, y: 8 }, 1: { x: 7, y: 4 }, e0: { x: 12, y: 4 } },
    { stats: { speed: "40 ft." } },
  );
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Forcecage", level: 7, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Forcecage"), "no cage on the board");
  await stride(world, goblin.id, 18, 4);
  assert.ok(tokenOf(world, goblin.id).x <= 13, "the caged creature walked out");
  const walked = await move(world, fighter.id, { x: 12, y: 2 });
  assert.ok(tokenOf(world, fighter.id).x < 10, `the fighter walked into the cage: ${JSON.stringify(walked.body).slice(0, 200)}`);
});

await test("Antilife Shell: a living creature cannot move into the barrier around the caster.", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await board([caster("druid", "wis", ["Antilife Shell"])], { 0: { x: 6, y: 4 }, e0: { x: 12, y: 4 } }, { stats: { speed: "40 ft." } });
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Antilife Shell", level: 5 });
  assert.equal(cast.ok, true, cast.error);
  await stride(world, goblin.id, 7, 4);
  assert.ok(tokenOf(world, goblin.id).x >= 9, "the goblin crossed the shell");
});

await test("Antilife Shell: a living creature outside cannot reach through the barrier with a melee attack.", async () => {
  const { world, sheets: [druid, fighter], enemies: [goblin] } = await board([caster("druid", "wis", ["Antilife Shell"]), FIGHTER], { 0: { x: 6, y: 4 }, 1: { x: 8, y: 4 }, e0: { x: 9, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Antilife Shell", level: 5 });
  assert.equal(cast.ok, true, cast.error);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fighter.id });
  assert.equal(swing.ok, false, "a melee attack reached through the shell");
});

await test("Gaseous Form: the creature's only movement is a 10-foot flying speed.", async () => {
  const staged = await table([caster("wizard", "int", ["Gaseous Form"], [], 5), FIGHTER]);
  const [wizard, fighter] = staged.sheets;
  await layMap(staged.world, boardRows("."), { [wizard.id]: { x: 4, y: 1 }, [fighter.id]: { x: 4, y: 2 }, [staged.enemies[0].id]: { x: 11, y: 4 } });
  const cast = await staged.world.invoke("cast_buff", { characterId: wizard.id, spell: "Gaseous Form", level: 3, targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  await move(staged.world, fighter.id, { x: 8, y: 2 });
  assert.ok(tokenOf(staged.world, fighter.id).x <= 6, `the mist drifted ${tokenOf(staged.world, fighter.id).x - 4} squares`);
});

await test("Antimagic Field: no spell is cast inside it, and a spell cast from outside has no effect on a creature inside.", async () => {
  const { world, sheets: [wizard, sorcerer], enemies: [goblin] } = await board(
    [caster("wizard", "int", ["Antimagic Field"], ["Fire Bolt"], 15), caster("sorcerer", "cha", [], ["Fire Bolt"], 5)],
    { 0: { x: 6, y: 4 }, 1: { x: 2, y: 4 }, e0: { x: 7, y: 4 } },
  );
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Antimagic Field", level: 8 });
  assert.equal(cast.ok, true, cast.error);
  const inside = await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Fire Bolt", damage: "1d10" });
  assert.equal(inside.ok, false, "a spell was cast inside the field");
  const into = await world.invoke("pc_attack", { characterId: sorcerer.id, targetEnemyId: goblin.id, spell: "Fire Bolt", damage: "1d10" });
  assert.equal(into.ok, false, "a spell from outside reached a creature inside the field");
});

await test("Contact Other Plane: the caster makes a DC 15 INT save; on a failure 6d6 psychic and insanity (no actions) until a long rest.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["Contact Other Plane"], [], 9));
  const before = world.sheet(wizard.id).currentHp;
  world.dice(1, 1, 1, 1, 1, 1, 1);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Contact Other Plane", level: 5 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(world.sheet(wizard.id).currentHp, before - 6, "no psychic backlash");
  assert.ok(has(world.sheet(wizard.id).conditions, "insane (contact other plane)"), "the caster kept their wits");
  await world.invoke("take_rest", { kind: "long" });
  assert.ok(!has(world.sheet(wizard.id).conditions, "insane (contact other plane)"), "the long rest did not end the insanity");
});

await test("Irresistible Dance: the dancer rolls no free save as the round ends; its action buys the WIS save (take_action escape), and it cannot move from its space.", async () => {
  const { world, sheets: [bard], enemies: [goblin] } = await board([caster("bard", "cha", ["Irresistible Dance"], [], 11)], { 0: { x: 2, y: 4 }, e0: { x: 8, y: 4 } }, { stats: { speed: "30 ft." } });
  const cast = await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Irresistible Dance", saveAbility: "wis", level: 6 });
  assert.equal(cast.ok, true, cast.error);
  assert.ok(has(enemyOf(world, goblin.id).conditions, "dancing"));
  world.dice(20, 20, 20, 20);
  roundTurn(world);
  world.clearDice();
  assert.ok(has(enemyOf(world, goblin.id).conditions, "dancing"), "a free save at the round's end stopped the dance");
  await stride(world, goblin.id, 12, 4);
  assert.equal(tokenOf(world, goblin.id).x, 8, "the dancer left its space");
  world.dice(20);
  const tried = await world.invoke("take_action", { action: "escape", enemyId: goblin.id });
  world.clearDice();
  assert.equal(tried.ok, true, tried.error);
  assert.ok(!has(enemyOf(world, goblin.id).conditions, "dancing"), "its action bought no save");
});

closeTables();
finish();
