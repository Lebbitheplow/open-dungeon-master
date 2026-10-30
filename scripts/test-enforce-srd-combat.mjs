// The SRD 5.1 text audit for issue #570, slice "combat": the rulebook pages
// `combat` (the order of combat through underwater combat) and `conditions`
// (every condition, exhaustion's six levels), read heading by heading from
// src/lib/rulebook/srd-5.1.json and held against the engine.
//
// Each gap() is a finding of that audit: the engine does something other than
// what the quoted SRD sentence says, reproduced here against the real tools.
// Each test() is a row of the same pages the audit found held and no other
// suite states. Rows other suites already hold are not repeated here; the
// audit's report lists them with the suite that holds each one.
//
// The suite needs no content pack: the fights are against fixed dummies
// (enforce-combat.mjs DUMMY) and the spells are the SRD's own.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, gap, finish } = suite("test-enforce-srd-combat");
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

await gap("CMB-02", {
  rule: "combat, Flying Movement: 'If a flying creature is knocked prone, has its speed reduced to 0, or is otherwise deprived of the ability to move, the creature falls, unless it has the ability to hover or it is being held aloft by magic.'",
  where: "src/lib/dm/combat-actions.ts contest (and set-condition.ts): nothing lands a token whose movement is fly when it is knocked prone; token-state.ts landTheFlightless only lands a character whose flying speed is gone",
  severity: "low",
  note: "A harpy (fly 40 ft., no hover) shoved prone keeps flying on the board, so it still ignores ground terrain and areas.",
}, async () => {
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

await gap("CMB-06", {
  rule: "combat, Cover: 'A target with half cover has a +2 bonus to AC and Dexterity saving throws.' (three-quarters: +5 to AC and Dexterity saving throws)",
  where: "src/lib/dm/cast-at-enemy*.ts and src/lib/dm/forced-save.ts rollEnemySave (and the character side, cast-at-player.ts, aoe-damage.ts): the board's cover (battlemap/los.ts coverBetween) reaches only attack rolls",
  severity: "medium",
  note: "A dummy behind a low wall (half cover) saves against Acid Splash with no +2: a 12 on the die fails DC 14 where the SRD's 14 succeeds.",
}, async () => {
  const [enemy] = await stage(mage);
  kit.openField([[5, 7, "|"]]);
  kit.place(mage.id, 5, 2);
  kit.place(enemy.id, 5, 8);
  // Wizard 5, INT 16: save DC 8 + 3 + 3 = 14. The dummy's DEX save is +0.
  const { out } = await forced([12, 3, 3], "cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Acid Splash" });
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 40, `a creature behind half cover failed a DEX save of 12 + 2 against DC 14: ${JSON.stringify(out.result).slice(0, 300)}`);
});

// ---- Damage and Healing: Knocking a Creature Out ----

await gap("CMB-07", {
  rule: "combat, Knocking a Creature Out: 'When an attacker reduces a creature to 0 hit points with a melee attack, the attacker can knock the creature out... The creature falls unconscious and is stable.'",
  where: "src/lib/dm/enemy-attack.ts attackArgsSchema (no nonlethal option; only pc_attack has one, dm/knockout.ts)",
  severity: "medium",
  note: "An enemy that means to take a character alive cannot: every drop to 0 from enemy_attack leaves the character dying, rolling death saves.",
}, async () => {
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

await gap("CMB-08", {
  rule: "combat, Mounting and Dismounting: 'If your mount is knocked prone, you can use your reaction to dismount it as it falls and land on your feet. Otherwise, you are dismounted and fall prone in a space within 5 feet it.'",
  where: "src/lib/srd/mounts.ts dismountSave and src/lib/dm/mount-tools.ts handleDismount (cause mount-prone rolls the DC 10 DEX save the SRD gives only for a forced move or a rider knocked prone)",
  severity: "low",
  note: "The rider of a mount knocked prone rolls a DEX save to land on their feet and keeps their reaction; the SRD has no save here, only the reaction.",
}, async () => {
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

await gap("CMB-09", {
  rule: "combat, Mounting and Dismounting: 'Once during your move, you can mount a creature that is within 5 feet of you or dismount.'",
  where: "src/lib/dm/mount-tools.ts spendMountingMovement (charges the movement but keeps no record that this move already mounted or dismounted)",
  severity: "low",
  note: "A rider with the movement for it mounts and dismounts (or the reverse) in one move.",
}, async () => {
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

await gap("CMB-10", {
  rule: "combat, Controlling a Mount: 'The initiative of a controlled mount changes to match yours when you mount it. It moves as you direct it, and it has only three action options: Dash, Disengage, and Dodge.'",
  where: "src/lib/dm/mount-tools.ts and src/lib/battlemap/view.ts pcMoveBudget: a mount is a speed written on its rider, with no action of its own; only the rider's own Dash (their action) lengthens the ride",
  severity: "low",
  note: "A rider who spends their action cannot have the controlled warhorse Dash with its own: the ride stops at 60 ft. The mount cannot Disengage or Dodge either, and an opportunity attack it provokes can only be aimed at the rider.",
}, async () => {
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

await gap("CMB-12", {
  rule: "conditions, Charmed: 'The charmer has advantage on any ability check to interact socially with the creature.'",
  where: "src/lib/dm/rolls.ts and src/lib/dm/contest-roll.ts (the roller's check reads no charmed condition on the creature it is aimed at)",
  severity: "low",
  note: "A character who charmed an enemy rolls Deception against it on one d20.",
}, async () => {
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

await gap("CMB-13", {
  rule: "conditions, Frightened: 'A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight.'",
  where: "src/lib/dm/condition-logic.ts attackContext and rollDerivation (frightened is in ATTACKER_DISADVANTAGE and CHECK_DISADVANTAGE with no sight line to its source)",
  severity: "medium",
  note: "On a mapped fight a character frightened of a creature behind a solid wall still attacks another creature at disadvantage.",
}, async () => {
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
