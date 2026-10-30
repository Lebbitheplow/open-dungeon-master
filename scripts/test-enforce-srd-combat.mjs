// The SRD 5.1 text audit for issue #570, slice "combat": the rulebook pages
// `combat` (the order of combat through underwater combat) and `conditions`
// (every condition, exhaustion's six levels), read heading by heading from
// src/lib/rulebook/srd-5.1.json and held against the engine.
//
// Each test labelled CMB-NN was a finding of that audit (a gap() until the
// engine was fixed): the quoted SRD sentence above it, held against the real
// tools. Each other test() is a row of the same pages the audit found held
// and no other suite states. Rows other suites already hold are not repeated here; the
// audit's report lists them with the suite that holds each one.
//
// The suite needs no content pack: the fights are against fixed dummies
// (enforce-combat.mjs DUMMY) and the spells are the SRD's own.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-srd-combat");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { getDatabase } = await import("../src/lib/db/core.ts");
const { dismountSave } = await import("../src/lib/srd/mounts.ts");
const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");

const SLOTS = { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } };
const fighter = world.addHero({
  name: "Bren", class: "fighter", level: 5, abilities: { str: 16, dex: 14, con: 14 }, proficiencies: TRAINED,
  maxHp: 44, speed: 30, equipment: [{ name: "Longsword", qty: 1 }],
});
// A wizard trained in no weapon, with a DEX-save cantrip.
const mage = world.addHero({
  name: "Ilsa", class: "wizard", level: 5, abilities: { int: 16, dex: 14 }, maxHp: 28, speed: 30,
  spellcasting: { ability: "int", slots: SLOTS, prepared: [], known: [], cantrips: ["Acid Splash"] },
});
// In a fight the diamonds are carried: none are bought mid-battle (cast-materials.ts).
const priest = world.addHero({
  name: "Oren", class: "cleric", level: 5, abilities: { wis: 16 }, maxHp: 33, speed: 30, gold: 400,
  equipment: [{ name: "Diamonds", qty: 1, worth: 300 }],
  spellcasting: { ability: "wis", slots: SLOTS, prepared: ["Revivify"], known: [], cantrips: [] },
});
const rogue = world.addHero({
  name: "Wren", class: "rogue", level: 2, abilities: { dex: 16 }, proficiencies: TRAINED, maxHp: 15, speed: 30,
  features: [{ name: "Cunning Action", description: "" }],
});
const heroes = [fighter, mage, priest, rogue];

// A fight against `count` dummies with `who` at the pointer, every token
// parked on the far edge, the board an open, brightly lit field.
async function stage(who, count = 1) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === who.id ? 19 : 2]));
  await kit.fight(count, { heroFaces });
  getDatabase().prepare("UPDATE battle_maps SET ambient = 'bright' WHERE id = ?").run(kit.map().id);
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 40 });
  }
  kit.giveTurn(who.id);
  return enemies;
}

async function walk(hero, x, y) {
  world.signIn({ id: world.sheet(hero.id).userId });
  const response = await moveRoute.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, {
      method: "POST",
      body: JSON.stringify({ x, y }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// One call with its dice forced; how many of the forced dice it left unused.
async function forced(faces, tool, args) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke(tool, args);
  const unused = world.clearDice();
  return { out, unused, rolled: world.diceLog().map((die) => die.face) };
}

async function enemySwing(enemy, target, faces = [7, 13, 1]) {
  const { out } = await forced(faces, "enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  assert.equal(out.ok, true, out.error);
  const attack = kit.lastRolls(4).find((entry) => entry.kind === "attack");
  return { dice: d20Faces(attack).length, kept: attack.breakdown.natural, out };
}

// ---- Movement and Position: Being Prone, Difficult Terrain ----

// combat, Being Prone: 'Every foot of movement while crawling costs 1 extra foot. Crawling 1 foot in difficult terrain, therefore, costs 3 feet of movement.'
await test("CMB-01", async () => {
  await stage(fighter);
  kit.openField([[6, 5, ","]]);
  kit.place(fighter.id, 5, 5, 2);
  world.patch(fighter.id, { conditions: ["prone"], conditionMeta: {} });
  const moved = await walk(fighter, 6, 5);
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.ok(world.sheet(fighter.id).conditions.includes("prone"), "the fighter stood instead of crawling");
  const spent = kit.token(fighter.id).movedThisRound - 2;
  assert.equal(spent, 3, `crawling one square of difficult terrain cost ${spent} squares (${spent * 5} ft), not 3 (15 ft)`);
});

await test("Difficult terrain does not stack: a creature's space on rough ground still costs 1 extra foot, not 2 (SRD 5.1, Difficult Terrain).", async () => {
  await stage(fighter);
  // A corridor one square wide, so the walk cannot step round the ally.
  const width = kit.map().width;
  const walls = Array.from({ length: width }, (_, x) => [[x, 4, "#"], [x, 6, "#"]]).flat();
  kit.openField([...walls, [6, 5, ","]]);
  kit.place(fighter.id, 5, 5);
  kit.place(mage.id, 6, 5);
  const moved = await walk(fighter, 7, 5);
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(kit.token(fighter.id).movedThisRound, 3, "the ally's square on rough ground cost more than double");
});

await test("Exhaustion level 5 reduces the speed to 0: the move is refused (SRD 5.1, Exhaustion).", async () => {
  await stage(fighter);
  kit.place(fighter.id, 5, 5);
  world.patch(fighter.id, { exhaustion: 5 });
  const moved = await walk(fighter, 6, 5);
  world.patch(fighter.id, { exhaustion: 0 });
  assert.ok(moved.status >= 400, `a creature at exhaustion 5 walked: ${JSON.stringify(moved.body).slice(0, 200)}`);
});

await test("Dash adds the speed after its modifiers: at exhaustion 2 a speed of 30 is 15, and a Dash makes it 30 (SRD 5.1, Dash).", async () => {
  await stage(fighter);
  kit.place(fighter.id, 2, 5);
  world.patch(fighter.id, { exhaustion: 2 });
  const dash = await world.invoke("take_action", { characterId: fighter.id, action: "dash" });
  assert.equal(dash.ok, true, dash.error);
  const far = await walk(fighter, 9, 5);
  const fits = await walk(fighter, 8, 5);
  world.patch(fighter.id, { exhaustion: 0 });
  assert.ok(far.status >= 400, "35 ft walked on a dashed speed of 15");
  assert.equal(fits.status, 200, JSON.stringify(fits.body));
});

// ---- Bonus Actions ----

await test("Anything that takes away the actions takes away the bonus action: a stunned rogue cannot Cunning Action a Dash (SRD 5.1, Bonus Actions).", async () => {
  await stage(rogue);
  const free = await world.invoke("take_action", { characterId: rogue.id, action: "dash", bonus: true });
  assert.equal(free.ok, true, `the rogue's Cunning Action is not set up: ${free.error}`);
  kit.freshTurn();
  world.patch(rogue.id, { conditions: ["stunned"], conditionMeta: {} });
  const out = await world.invoke("take_action", { characterId: rogue.id, action: "dash", bonus: true });
  world.patch(rogue.id, { conditions: [], conditionMeta: {} });
  assert.equal(out.ok, false, "a stunned rogue took a bonus-action Dash");
});

// ---- Flying Movement ----

// combat, Flying Movement: 'If a flying creature is knocked prone, has its speed reduced to 0, or is otherwise deprived of the ability to move, the creature falls, unless it has the ability to hover or it is being held aloft by magic.'
await test("CMB-02", async () => {
  const [harpy] = await stage(fighter);
  kit.setEnemy(harpy.id, { stats: { speed: "20 ft., fly 40 ft." } });
  kit.place(fighter.id, 5, 5);
  kit.place(harpy.id, 6, 5);
  const aloft = await world.invoke("set_movement", { token: harpy.id, movement: "fly" });
  assert.equal(aloft.ok, true, aloft.error);
  assert.equal(kit.token(harpy.id).movement, "fly");
  const { out } = await forced([20, 1], "take_action", { characterId: fighter.id, action: "shove", shove: "prone", targetEnemyId: harpy.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true, JSON.stringify(out.result));
  assert.ok(kit.enemy(harpy.id).conditions.includes("prone"));
  assert.equal(kit.token(harpy.id).movement, "walk", "a flying creature knocked prone is still aloft on the board");
});

// combat, Flying Movement: the same sentence, on the paths that lay the condition without a shove: a spell's save, a spell's area, a blow that drops a winged character to 0 hit points.
await test("CMB-02 on every path: a flyer held by a spell, caught in an area or dropped to 0 falls as the condition lands", async () => {
  const [harpy] = await stage(mage);
  const spells = world.sheet(mage.id).spellcasting;
  const kept = world.sheet(fighter.id);
  world.patch(mage.id, { spellcasting: { ...spells, prepared: ["Hold Person", "Web"] } });
  const stillUp = [];
  const takeWing = async (refId) => {
    const up = await world.invoke("set_movement", { token: refId, movement: "fly" });
    assert.equal(up.ok, true, up.error);
  };
  const aloftHarpy = async () => {
    kit.setEnemy(harpy.id, { stats: { speed: "20 ft., fly 40 ft." }, conditions: [], conditionMeta: {} });
    await takeWing(harpy.id);
  };
  try {
    kit.place(mage.id, 5, 2);
    kit.place(harpy.id, 5, 5);
    await aloftHarpy();
    // Hold Person: a WIS save of 1, paralyzed.
    const held = await forced([1], "cast_at_enemy", { characterId: mage.id, targetEnemyId: harpy.id, spell: "Hold Person", level: 2 });
    assert.equal(held.out.ok, true, held.out.error);
    if (kit.token(harpy.id).movement === "fly") {
      stillUp.push(`a spell's save (${kit.enemy(harpy.id).conditions.join(", ")})`);
    }
    await aloftHarpy();
    kit.freshTurn();
    // Web over it: a DEX save of 1, restrained.
    const web = await forced([1], "aoe_damage", { casterCharacterId: mage.id, spell: "Web", level: 2, enemyIds: [harpy.id], atX: 5, atY: 5 });
    assert.equal(web.out.ok, true, web.out.error);
    if (kit.token(harpy.id).movement === "fly") {
      stillUp.push(`a spell's area (${kit.enemy(harpy.id).conditions.join(", ")})`);
    }
    // A winged fighter (Dragon Wings: no magic holds them up) dropped to 0.
    world.patch(fighter.id, { features: [...kept.features, { name: "Dragon Wings", description: "" }], currentHp: 3, ac: 10, acOverride: true });
    kit.place(fighter.id, 5, 7);
    kit.place(harpy.id, 5, 8);
    kit.setEnemy(harpy.id, { conditions: [], conditionMeta: {} });
    await takeWing(fighter.id);
    kit.freshRound();
    const blow = await forced([15, 6], "enemy_attack", { enemyId: harpy.id, targetCharacterId: fighter.id });
    assert.equal(blow.out.ok, true, blow.out.error);
    assert.equal(world.sheet(fighter.id).currentHp, 0, "setup: the blow did not drop the fighter");
    if (kit.token(fighter.id).movement === "fly") {
      stillUp.push("a drop to 0 hit points");
    }
  } finally {
    // Web's concentration ends with the test, or the next blow asks a CON save.
    world.patch(mage.id, { spellcasting: spells, concentratingOn: null });
    world.patch(fighter.id, { features: kept.features, currentHp: 44, deathSaves: null, conditions: [], conditionMeta: {}, ac: kept.ac, acOverride: kept.acOverride ?? false });
  }
  assert.deepEqual(stillUp, [], `a flyer stayed aloft after ${stillUp.join("; ")}`);
});

// ---- Actions in Combat: Dodge, Hide ----

// combat, Dodge: 'Until the start of your next turn, any attack roll made against you has disadvantage if you can see the attacker.'
await test("CMB-03", async () => {
  const [enemy] = await stage(fighter);
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  world.patch(fighter.id, { conditions: ["dodging", "blinded"], conditionMeta: { dodging: { untilTurnOf: fighter.id } } });
  const swing = await enemySwing(enemy, fighter);
  world.patch(fighter.id, { conditions: [], conditionMeta: {} });
  assert.equal(swing.dice, 2, "a blinded dodger's Dodge still cancelled the advantage of attacking a blinded creature");
  assert.equal(swing.kept, 13, "the attack was not rolled with advantage");
});

// combat, Dodge: 'any attack roll made against you has disadvantage if you can see the attacker'; conditions, Frightened: 'while the source of its fear is within line of sight'. Both held on pc_attack and enemy_attack; here on the opportunity attacks, either way.
await test("CMB-03 and CMB-13 on opportunity attacks: a Dodge against an attacker in the dark, and a fear whose source is out of sight, count for nothing", async () => {
  const wrong = [];
  const darken = () => getDatabase().prepare("UPDATE battle_maps SET ambient = 'dark', outdoors = 0 WHERE id = ?").run(kit.map().id);
  const wall = () => kit.openField(Array.from({ length: kit.map().width }, (_, x) => [x, 8, "#"]));
  const attackBy = (refId) => kit.lastRolls(8).filter((roll) => roll.kind === "attack" && (roll.characterId === refId || roll.attacker?.id === refId)).at(-1);
  const kept = world.sheet(fighter.id);
  try {
    // An enemy with darkvision swings at a dodging fighter who cannot see it.
    let [enemy] = await stage(fighter);
    darken();
    kit.setEnemy(enemy.id, { stats: { senses: { darkvision: 60, passivePerception: 10 } } });
    kit.place(fighter.id, 5, 5);
    kit.place(enemy.id, 5, 6);
    world.patch(fighter.id, { conditions: ["dodging"], conditionMeta: { dodging: { untilTurnOf: fighter.id } } });
    world.clearDice();
    world.dice(7, 13, 1);
    await walk(fighter, 5, 2);
    world.clearDice();
    if (d20Faces(attackBy(enemy.id)).length !== 2) {
      wrong.push("an enemy's opportunity attack still met a Dodge from a fighter who could not see it");
    }
    world.patch(fighter.id, { conditions: [], conditionMeta: {} });
    // The fighter, with darkvision, swings at a dodging enemy that cannot see them.
    [enemy] = await stage(fighter);
    darken();
    world.patch(fighter.id, { features: [...kept.features, { name: "Darkvision", description: "" }] });
    kit.place(fighter.id, 5, 5);
    kit.place(enemy.id, 5, 6);
    kit.setEnemy(enemy.id, { conditions: ["dodging"], conditionMeta: { dodging: { untilTurnOf: enemy.id } } });
    world.clearDice();
    world.dice(7, 13, 1);
    await world.invoke("move_token", { token: enemy.id, x: 8, y: 6 });
    world.clearDice();
    if (d20Faces(attackBy(fighter.id)).length !== 2) {
      wrong.push("a character's opportunity attack still met a Dodge from an enemy that could not see them");
    }
    world.patch(fighter.id, { features: kept.features });
    // A frightened enemy swings at the leaver, its fear's source behind a wall.
    let source;
    [enemy, source] = await stage(fighter, 2);
    wall();
    kit.place(fighter.id, 5, 5);
    kit.place(enemy.id, 5, 6);
    kit.place(source.id, 5, 11);
    kit.setEnemy(enemy.id, { conditions: ["frightened"], conditionMeta: { frightened: { source: source.id } } });
    world.clearDice();
    world.dice(7, 13, 1);
    await walk(fighter, 5, 2);
    world.clearDice();
    if (d20Faces(attackBy(enemy.id)).length !== 1) {
      wrong.push("a frightened enemy's opportunity attack was at disadvantage with its fear's source out of sight");
    }
    // A frightened fighter swings at an enemy leaving, the source behind a wall.
    [enemy, source] = await stage(fighter, 2);
    wall();
    kit.place(fighter.id, 5, 5);
    kit.place(enemy.id, 5, 6);
    kit.place(source.id, 5, 11);
    world.patch(fighter.id, { conditions: ["frightened"], conditionMeta: { frightened: { source: source.id } } });
    world.clearDice();
    world.dice(7, 13, 1);
    await world.invoke("move_token", { token: enemy.id, x: 8, y: 6 });
    world.clearDice();
    if (d20Faces(attackBy(fighter.id)).length !== 1) {
      wrong.push("a frightened character's opportunity attack was at disadvantage with the fear's source out of sight");
    }
  } finally {
    world.patch(fighter.id, { features: kept.features, conditions: [], conditionMeta: {} });
  }
  assert.deepEqual(wrong, [], wrong.join("; "));
});

// conditions, Invisible: 'For the purpose of hiding, the creature is heavily obscured.' (combat, Hide: you make a Dexterity (Stealth) check in an attempt to hide)
await test("CMB-04", async () => {
  const [enemy] = await stage(fighter);
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  world.patch(fighter.id, { conditions: ["invisible"], conditionMeta: {} });
  const { out } = await forced([20], "take_action", { characterId: fighter.id, action: "hide" });
  world.patch(fighter.id, { conditions: [], conditionMeta: {} });
  assert.equal(out.ok, true, `an invisible character was refused the Hide action: ${out.error}`);
});

// ---- Making an Attack: Melee Attacks (unarmed strike) ----

await test("An unarmed strike deals 1 + the Strength modifier bludgeoning, and everyone is proficient with it (SRD 5.1, Melee Attacks).", async () => {
  const [enemy] = await stage(mage);
  kit.place(mage.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.setEnemy(enemy.id, { ac: 5 });
  const swing = await kit.swing(mage.id, enemy.id, [10], { weapon: "unarmed strike" });
  assert.equal(swing.ok, true, swing.error);
  // A wizard trained in no weapon: d20 10 + proficiency 3 + Strength 0.
  assert.equal(swing.toHit.total, 13, "the wizard's unarmed strike took no proficiency bonus");
  assert.equal(swing.damage.total, 1);
  assert.equal(kit.enemy(enemy.id).currentHp, 39);
});

await test("Two-weapon fighting with daggers: 'If either weapon has the thrown property, you can throw the weapon, instead of making a melee attack with it' (SRD 5.1, Two-Weapon Fighting).", async () => {
  const [enemy] = await stage(fighter);
  kit.setEnemy(enemy.id, { ac: 5, maxHp: 100 });
  world.patch(fighter.id, { equipment: [{ name: "Dagger", qty: 2 }] });
  try {
    kit.place(fighter.id, 2, 5);
    kit.place(enemy.id, 2, 8);
    const first = await kit.swing(fighter.id, enemy.id, [15, 2], { weapon: "Dagger" });
    assert.equal(first.ok, true, first.error);
    const second = await kit.swing(fighter.id, enemy.id, [15, 2], { weapon: "Dagger", offHand: true });
    assert.equal(second.ok, true, `the off-hand dagger could not be thrown: ${second.error}`);
    // No ability modifier on the off-hand damage: the die alone.
    assert.equal(second.damage?.total, 2);
  } finally {
    world.patch(fighter.id, { equipment: [{ name: "Longsword", qty: 1 }] });
  }
});

// ---- Grappling and Shoving a Creature ----

// combat, Grappling and Shoving a Creature: 'You succeed automatically if the target is incapacitated.'
await test("CMB-05", async () => {
  const [enemy] = await stage(fighter);
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.setEnemy(enemy.id, { conditions: ["stunned"] });
  const grab = await forced([1, 20], "take_action", { characterId: fighter.id, action: "grapple", targetEnemyId: enemy.id });
  assert.equal(grab.out.ok, true, grab.out.error);
  assert.equal(grab.out.result.success, true, `the grapple on a stunned creature was contested and lost (${grab.out.result.contest})`);
  kit.setEnemy(enemy.id, { conditions: ["stunned"], conditionMeta: {} });
  kit.freshTurn();
  const push = await forced([1, 20], "take_action", { characterId: fighter.id, action: "shove", shove: "prone", targetEnemyId: enemy.id });
  assert.equal(push.out.ok, true, push.out.error);
  assert.equal(push.out.result.success, true, `the shove on a stunned creature was contested and lost (${push.out.result.contest})`);
});

// ---- Cover ----

// combat, Cover: 'A target with half cover has a +2 bonus to AC and Dexterity saving throws.' (three-quarters: +5 to AC and Dexterity saving throws)
await test("CMB-06", async () => {
  const [enemy] = await stage(mage);
  kit.openField([[5, 7, "|"]]);
  kit.place(mage.id, 5, 2);
  kit.place(enemy.id, 5, 8);
  // Wizard 5, INT 16: save DC 8 + 3 + 3 = 14. The dummy's DEX save is +0.
  const { out } = await forced([12, 3, 3], "cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Acid Splash" });
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 40, `a creature behind half cover failed a DEX save of 12 + 2 against DC 14: ${JSON.stringify(out.result).slice(0, 300)}`);
});

await test("Cover counts on a DEX save against an area from its point of origin: a Fireball's 12 behind a low wall is 14, half damage (SRD 5.1, Cover).", async () => {
  const [enemy] = await stage(mage);
  const before = world.sheet(mage.id).spellcasting;
  world.patch(mage.id, { spellcasting: { ...before, prepared: ["Fireball"] } });
  try {
    kit.openField([[5, 7, "|"]]);
    kit.place(mage.id, 5, 0);
    kit.place(enemy.id, 5, 8);
    // Eight damage dice of 1, then the dummy's save of 12 (+0) against DC 14.
    const { out } = await forced([1, 1, 1, 1, 1, 1, 1, 1, 12], "aoe_damage", { casterCharacterId: mage.id, spell: "Fireball", level: 3, enemyIds: [enemy.id], atX: 5, atY: 4 });
    assert.equal(out.ok, true, out.error);
    assert.equal(kit.enemy(enemy.id).currentHp, 36, `the low wall between the sphere's point and the dummy gave its DEX save nothing: ${JSON.stringify(out.result).slice(0, 300)}`);
  } finally {
    world.patch(mage.id, { spellcasting: before });
  }
});

// combat, Cover: 'A target can benefit from cover only when an attack or other effect originates on the opposite side of the cover.' / 'The obstacle might be a low wall, a large piece of furniture, a narrow tree trunk, or a creature, whether that creature is an enemy or a friend.'
await test("CMB-06 on every path: a trap's, an attack rider's and an area's DEX save take the cover from where each starts", async () => {
  const uncovered = [];
  // The wizard's DEX save is +2 (DEX 14, no proficiency): a 10 is 12 against
  // DC 13, and half cover makes it 14. No concentration to save for when hit.
  await stage(mage);
  world.patch(mage.id, { concentratingOn: null });
  kit.openField([[5, 7, "|"]]);
  kit.place(mage.id, 5, 8);
  // A dart fired from the far side of a low wall.
  const dart = await forced([10, 4], "apply_hazard", { type: "generic", characterIds: [mage.id], saveAbility: "dex", dc: 13, damage: "1d4", damageType: "piercing", halfOnSave: false, fromX: 5, fromY: 2 });
  assert.equal(dart.out.ok, true, dart.out.error);
  if (world.sheet(mage.id).currentHp < 28) {
    uncovered.push("a trap fired from behind a low wall");
  }
  world.patch(mage.id, { currentHp: 28, conditions: [], conditionMeta: {} });
  // A bola thrown over the same wall: the hit, then its DEX save or prone.
  const [thrower] = world.enemies();
  kit.setEnemy(thrower.id, {
    stats: { attacks: [{ name: "Bola", toHit: 4, damage: "1d4", type: "bludgeoning", mode: "ranged", range: { normal: 30, long: 120 }, onHit: { save: "dex", dc: 13, condition: "prone" } }] },
  });
  kit.place(thrower.id, 5, 2);
  const bola = await forced([19, 2, 10], "enemy_attack", { enemyId: thrower.id, targetCharacterId: mage.id });
  assert.equal(bola.out.ok, true, bola.out.error);
  const riderSave = bola.out.result?.swings?.[0]?.riderSave;
  assert.equal(bola.unused, 0, `setup: the bola's dice were not all used (${bola.rolled.join(", ")}; ${riderSave})`);
  if (world.sheet(mage.id).conditions.includes("prone")) {
    uncovered.push(`an attack's rider (${riderSave})`);
  }
  world.patch(mage.id, { currentHp: 28, conditions: [], conditionMeta: {} });
  // A Fireball's point with one dummy standing between it and another: a
  // 12 on each DEX save (+0) against DC 14; the far one's is 14 behind the near one.
  const [near, far] = await stage(mage, 2);
  const before = world.sheet(mage.id).spellcasting;
  world.patch(mage.id, { spellcasting: { ...before, prepared: ["Fireball"] } });
  try {
    kit.place(mage.id, 2, 0);
    kit.place(near.id, 5, 6);
    kit.place(far.id, 5, 8);
    const blast = await forced([1, 1, 1, 1, 1, 1, 1, 1, 12, 12], "aoe_damage", { casterCharacterId: mage.id, spell: "Fireball", level: 3, enemyIds: [near.id, far.id], atX: 5, atY: 4 });
    assert.equal(blast.out.ok, true, blast.out.error);
    assert.equal(kit.enemy(near.id).currentHp, 32, "setup: the near dummy did not fail its save");
    if (kit.enemy(far.id).currentHp !== 36) {
      uncovered.push("a creature between a sphere's point and its target");
    }
  } finally {
    world.patch(mage.id, { spellcasting: before });
  }
  assert.deepEqual(uncovered, [], `no cover on the DEX save against ${uncovered.join("; ")}`);
});

await test("Sacred Flame: 'The target gains no benefit from cover for this saving throw' (SRD 5.1, Sacred Flame).", async () => {
  const [enemy] = await stage(priest);
  const before = world.sheet(priest.id).spellcasting;
  world.patch(priest.id, { spellcasting: { ...before, cantrips: ["Sacred Flame"] } });
  try {
    kit.openField([[5, 7, "|"]]);
    kit.place(priest.id, 5, 2);
    kit.place(enemy.id, 5, 8);
    // Cleric 5, WIS 16: DC 14. A 12 fails with the low wall counting for nothing.
    const { out } = await forced([12, 3, 3], "cast_at_enemy", { characterId: priest.id, targetEnemyId: enemy.id, spell: "Sacred Flame" });
    assert.equal(out.ok, true, out.error);
    assert.equal(kit.enemy(enemy.id).currentHp, 34, `cover counted against Sacred Flame: ${JSON.stringify(out.result).slice(0, 300)}`);
  } finally {
    world.patch(priest.id, { spellcasting: before });
  }
});

// ---- Damage and Healing: Knocking a Creature Out ----

// combat, Knocking a Creature Out: 'When an attacker reduces a creature to 0 hit points with a melee attack, the attacker can knock the creature out... The creature falls unconscious and is stable.'
await test("CMB-07", async () => {
  const [enemy] = await stage(fighter);
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  world.patch(fighter.id, { currentHp: 5, ac: 10, acOverride: true });
  const { out } = await forced([15, 6], "enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id, nonlethal: true });
  assert.equal(out.ok, true, out.error);
  const after = world.sheet(fighter.id);
  world.patch(fighter.id, { currentHp: 44, deathSaves: null, conditions: [], conditionMeta: {}, ac: 12 });
  assert.equal(after.currentHp, 0, "the blow did not drop the fighter");
  assert.equal(after.deathSaves?.stable, true, "a melee blow meant to knock out left the character dying instead of stable");
});

// ---- Mounted Combat ----

// combat, Mounting and Dismounting: 'If your mount is knocked prone, you can use your reaction to dismount it as it falls and land on your feet. Otherwise, you are dismounted and fall prone in a space within 5 feet it.'
await test("CMB-08", async () => {
  await stage(fighter);
  kit.place(fighter.id, 5, 5);
  const up = await world.invoke("mount_up", { characterId: fighter.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  const { out, unused } = await forced([20], "dismount", { characterId: fighter.id, cause: "mount-prone" });
  assert.equal(out.ok, true, out.error);
  const saved = unused === 0;
  const prone = world.sheet(fighter.id).conditions.includes("prone");
  const reacted = world.encounter().reactionsUsed.includes(fighter.id);
  world.patch(fighter.id, { conditions: [], conditionMeta: {} });
  assert.ok(
    dismountSave("mount-prone") === null && !saved && (prone || reacted),
    `a mount knocked prone: ${saved ? "a DEX save was rolled" : "no save"}, the rider ${prone ? "fell prone" : "landed on their feet"}, ${reacted ? "the reaction spent" : "the reaction kept"}`,
  );
});

// combat, Mounting and Dismounting: 'Once during your move, you can mount a creature that is within 5 feet of you or dismount.'
await test("CMB-09", async () => {
  await stage(fighter);
  kit.place(fighter.id, 5, 5, 0);
  const up = await world.invoke("mount_up", { characterId: fighter.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  const down = await world.invoke("dismount", { characterId: fighter.id });
  if (!down.ok) {
    // Leave the next test a rider on foot either way.
    await world.invoke("dismount", { characterId: fighter.id, cause: "forced-move" });
    world.clearDice();
    world.patch(fighter.id, { conditions: [], conditionMeta: {} });
  }
  assert.equal(down.ok, false, "the rider mounted and dismounted in the same move");
});

// combat, Controlling a Mount: 'The initiative of a controlled mount changes to match yours when you mount it. It moves as you direct it, and it has only three action options: Dash, Disengage, and Dodge.'
await test("CMB-10", async () => {
  await stage(fighter);
  kit.place(fighter.id, 2, 5, 0);
  const up = await world.invoke("mount_up", { characterId: fighter.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  try {
    // The rider's own action, then the horse's Dash: 60 ft more of its own.
    const dodge = await world.invoke("take_action", { characterId: fighter.id, action: "dodge" });
    assert.equal(dodge.ok, true, dodge.error);
    // Mounting took 15 ft of the horse's 60; the other 45 ride as before.
    const walked = await walk(fighter, 11, 5);
    if (walked.status !== 200) {
      throw new Error(`setup: the rider could not ride the horse's own 60 ft: ${JSON.stringify(walked.body)}`);
    }
    const ride = await walk(fighter, 16, 5);
    assert.equal(ride.status, 200, `a controlled warhorse could not Dash for a rider who used their action: ${JSON.stringify(ride.body).slice(0, 200)}`);
  } finally {
    world.dice(20);
    await world.invoke("dismount", { characterId: fighter.id, cause: "forced-move" });
    world.clearDice();
    world.patch(fighter.id, { conditions: [], conditionMeta: {} });
  }
});

// ---- Initiative ----

// combat, Initiative: 'The GM makes one roll for an entire group of identical creatures, so each member of the group acts at the same time.'
await test("CMB-11", async () => {
  await kit.endFight();
  world.clearDice();
  const seated = world.sheets().filter((sheet) => !sheet.deathSaves?.dead).length;
  world.dice(18, 3, ...new Array(seated).fill(10));
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 2 }] });
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  const order = world.encounter().order.filter((entry) => entry.kind !== "pc");
  assert.equal(order.length, 2, JSON.stringify(order));
  assert.equal(order[0].initiative, order[1].initiative, `two identical goblins rolled apart: ${order.map((entry) => entry.initiative).join(" and ")}`);
});

// ---- Conditions ----

// conditions, Charmed: 'The charmer has advantage on any ability check to interact socially with the creature.'
await test("CMB-12", async () => {
  const [enemy] = await stage(fighter);
  kit.setEnemy(enemy.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: fighter.id } } });
  const { out } = await forced([7, 13, 10, 10], "request_roll", {
    characterId: fighter.id, kind: "skill_check", skill: "deception", againstEnemyId: enemy.id, reason: "a bluff to the charmed guard",
  });
  assert.equal(out.ok, true, out.error);
  const mine = kit.lastRolls(4).find((roll) => roll.characterId === fighter.id);
  assert.ok(mine, "no roll was stored for the charmer");
  assert.equal(d20Faces(mine).length, 2, "the charmer's social check against the creature they charmed was not rolled with advantage");
});

// conditions, Charmed: the same sentence, from the other side of a contest: an enemy that charmed a character lies to them with advantage, whether a check asks or the GM tests one character's Insight against it.
await test("CMB-12 on every path: an enemy's Deception against the character it charmed rolls with advantage", async () => {
  const missed = [];
  const lieOf = () => kit.lastRolls(6).find((roll) => /Deception \(contest\)/.test(roll.detail ?? ""));
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: enemy.id } } });
  try {
    // request_roll: the fighter's Insight, against the charmer's Deception.
    const asked = await forced([7, 13, 10], "request_roll", { characterId: fighter.id, kind: "skill_check", skill: "insight", againstEnemyId: enemy.id, reason: "is the charmer lying" });
    assert.equal(asked.out.ok, true, asked.out.error);
    if (d20Faces(lieOf()).length !== 2) {
      missed.push("request_roll's contest");
    }
    // check_notice: one character's Insight against the charmer's lie.
    const noticed = await forced([7, 13], "check_notice", { characterIds: [fighter.id], sense: "insight", againstEnemyId: enemy.id, difficulty: "moderate", reason: "a charming lie" });
    assert.equal(noticed.out.ok, true, noticed.out.error);
    if (d20Faces(lieOf()).length !== 2) {
      missed.push("check_notice's contest");
    }
  } finally {
    world.patch(fighter.id, { conditions: [], conditionMeta: {} });
  }
  assert.deepEqual(missed, [], `the charmer's lie was rolled on one d20 in ${missed.join(" and ")}`);
});

// conditions, Frightened: 'A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight.'
await test("CMB-13", async () => {
  const [near, source] = await stage(fighter, 2);
  const width = kit.map().width;
  kit.openField(Array.from({ length: width }, (_, x) => [x, 8, "#"]));
  kit.place(fighter.id, 5, 5);
  kit.place(near.id, 5, 6);
  kit.place(source.id, 5, 11);
  world.patch(fighter.id, { conditions: ["frightened"], conditionMeta: { frightened: { source: source.id } } });
  const swing = await kit.swing(fighter.id, near.id, [7, 13, 1, 1], { weapon: "Longsword" });
  world.patch(fighter.id, { conditions: [], conditionMeta: {} });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 1, "the attack was at disadvantage though the source of the fear is out of sight behind a wall");
});

// conditions, Petrified: 'The creature is immune to poison and disease, although a poison or disease already in its system is suspended, not neutralized.'
await test("CMB-14", async () => {
  const [enemy] = await stage(fighter);
  // The call that lays the condition, on a creature that is not petrified.
  const laid = await world.invoke("set_condition", { enemyId: enemy.id, condition: "poisoned", rounds: 10 });
  if (!laid.ok || !kit.enemy(enemy.id).conditions.includes("poisoned")) {
    throw new Error(`setup: set_condition did not poison the dummy: ${laid.error ?? JSON.stringify(laid.result)}`);
  }
  kit.setEnemy(enemy.id, { conditions: ["petrified"], conditionMeta: {} });
  const hit = await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 10, type: "poison" });
  assert.equal(hit.ok, true, hit.error);
  const took = 40 - kit.enemy(enemy.id).currentHp;
  await world.invoke("set_condition", { enemyId: enemy.id, condition: "poisoned", rounds: 10 });
  const poisoned = kit.enemy(enemy.id).conditions.includes("poisoned");
  assert.ok(took === 0 && !poisoned, `a petrified creature took ${took} poison damage and was ${poisoned ? "" : "not "}poisoned`);
});

// conditions, Petrified: 'The creature is immune to poison and disease' on the paths that read a stat block's immunities themselves: a spell's condition, an area's, Stinking Cloud's retching.
await test("CMB-14 on every path: a spell, an area or Stinking Cloud cannot poison a petrified creature", async () => {
  const [enemy] = await stage(mage);
  const before = world.sheet(mage.id).spellcasting;
  world.patch(mage.id, { spellcasting: { ...before, cantrips: ["Poison Spray"], prepared: ["Stinking Cloud"] } });
  const poisonedBy = [];
  // Each path from fresh stone; what it left that poison would lay.
  const onStone = async (path, faces, tool, args) => {
    kit.setEnemy(enemy.id, { conditions: ["petrified"], conditionMeta: {} });
    const { out } = await forced(faces, tool, args);
    assert.equal(out.ok, true, `${path}: ${out.error}`);
    const sick = kit.enemy(enemy.id).conditions.filter((name) => name === "poisoned" || name === "retching");
    if (sick.length) {
      poisonedBy.push(`${path} (${sick.join(", ")})`);
    }
  };
  try {
    kit.place(mage.id, 5, 2);
    kit.place(enemy.id, 5, 4);
    // Poison Spray with the condition the caller names: a CON save of 1.
    await onStone("cast_at_enemy", [1, 6, 6], "cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Poison Spray", condition: "poisoned" });
    // A poison gas with no spell: its damage, then a CON save of 1.
    await onStone("an area's condition", [3, 3, 1], "aoe_damage", { damage: "2d6", type: "poison", saveAbility: "con", dc: 15, halfOnSave: false, condition: "poisoned", rounds: 10, enemyIds: [enemy.id] });
    // "Creatures that ... are immune to poison automatically succeed" (SRD 5.1, Stinking Cloud).
    kit.freshTurn();
    await onStone("Stinking Cloud", [1], "aoe_damage", { casterCharacterId: mage.id, spell: "Stinking Cloud", level: 3, enemyIds: [enemy.id], atX: 5, atY: 5 });
  } finally {
    world.patch(mage.id, { spellcasting: before });
  }
  assert.deepEqual(poisonedBy, [], `a petrified creature was poisoned by: ${poisonedBy.join("; ")}`);
});

// conditions, Exhaustion: 'Also, being raised from the dead reduces a creature's exhaustion level by 1.'
await test("CMB-15", async () => {
  await kit.endFight();
  const victim = world.addHero({ name: "Tamsin", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 44 });
  world.patch(victim.id, { currentHp: 0, exhaustion: 2, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const out = await world.invoke("heal", { characterId: victim.id, casterId: priest.id, spell: "Revivify", level: 3 });
  assert.equal(out.ok, true, out.error);
  const after = world.sheet(victim.id);
  assert.equal(after.deathSaves?.dead ?? false, false, "Revivify did not bring the character back");
  assert.equal(after.exhaustion ?? 0, 1, `raised from the dead at exhaustion ${after.exhaustion ?? 0}, not 1`);
});

await test("A squeezing creature has disadvantage on its own attack rolls (SRD 5.1, Squeezing into a Smaller Space).", async () => {
  const [enemy] = await stage(fighter);
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.setEnemy(enemy.id, { conditions: ["squeezing"] });
  const swing = await enemySwing(enemy, fighter);
  assert.equal(swing.dice, 2);
  assert.equal(swing.kept, 7, "the squeezing creature's attack was not at disadvantage");
});

await kit.endFight();
world.close();
finish();
