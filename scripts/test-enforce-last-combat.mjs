// The last mile of the combat repair (wave 4, "last-combat"): the monster
// side the recount found wrong or missing. A stat block's damage read from
// the numbers it prints (rider dice never lost, misprinted pack dice checked
// against the printed average), the Multiattack wordings the routine parser
// missed, monster grapples (reach, the printed escape DC, the restraint that
// ends with them), an enemy's opportunity attack landing through the same
// hit path as enemy_attack, the troll that dies only at its turn start,
// enemy saves on the full save path, Keen senses and the grappler's free
// hand. Blocks are written out here, so the suite reads the same with the
// content pack and without it; the pack rows are swept too when present.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";
import { d20Count, monsterKit, ROWS } from "./lib/enforce-monsters.mjs";
import { averageOf, printedAverage, ROUTINE_ROWS, routineRow } from "./lib/enforce-last-combat.mjs";

const { test, finish } = suite("test-enforce-last-combat");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { damageParts } = await import("../src/lib/dm/damage-parts.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const encounters = await import("../src/lib/db/encounters.ts");

const fighter = world.addHero({
  name: "Fighter", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: { ...TRAINED, skills: ["athletics"] },
  maxHp: 60, ac: 10, acOverride: true,
});
const tief = world.addHero({
  name: "Tief", class: "fighter", level: 5, race: "tiefling", proficiencies: TRAINED, maxHp: 60, ac: 10, acOverride: true,
});
const rogue = world.addHero({
  name: "Rogue", class: "rogue", level: 5, proficiencies: TRAINED, maxHp: 60, ac: 10, acOverride: true,
});
const heroes = [fighter, tief, rogue];

async function stage(onTurn, row = null) {
  await kit.endFight();
  for (const hero of heroes) {
    world.patch(hero.id, { currentHp: 60, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  await kit.fight(1, { heroFaces: { [fighter.id]: 19, [tief.id]: 18, [rogue.id]: 17 } });
  const [enemy] = world.enemies();
  if (row) {
    mk.stage(enemy.id, row);
  }
  kit.giveTurn(onTurn.id);
  return kit.enemy(enemy.id);
}

async function walk(hero, x, y) {
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: hero.userId });
  const response = await route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x, y }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

function nextRound(...faces) {
  const round = world.encounter().round;
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  for (let guard = 0; guard < 10 && world.encounter().round === round; guard += 1) {
    assert.equal(kit.endTurn(kit.current().userId), true);
  }
  const rolled = world.diceLog();
  world.clearDice();
  return rolled;
}

const lower = (list) => list.map((entry) => entry.toLowerCase());

// ---- damage read from the printed numbers (new defect 1, G3, pack misprints) ----

const attackOf = (name, desc, dice, bonus, toHit = 5) => ({
  name: "Beast", armor_class: 12, hit_points: 20, cr: 1,
  actions: [{ name, desc, attack_bonus: toHit, damage_dice: dice, ...(bonus === undefined ? {} : { damage_bonus: bonus }) }],
});

await test("A rider whose dice match the base dice is still rolled: a drider's longbow is 1d8 + 3 piercing plus 1d8 poison.", () => {
  const drider = mk.parse(attackOf("Longbow", "Ranged Weapon Attack: +6 to hit, range 150/600 ft., one target. Hit: 7 (1d8 + 3) piercing damage plus 4 (1d8) poison damage.", "1d8", 3)).attacks[0];
  assert.equal(drider.damage, "1d8+3+1d8");
  const toad = mk.parse(attackOf("Bite", "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (1d10 + 2) piercing damage plus 5 (1d10) poison damage, and the target is grappled (escape DC 13).", "1d10", 2)).attacks[0];
  assert.equal(toad.damage, "1d10+2+1d10");
});

await test("A pack row's misprinted dice are checked against the average the block prints beside them, and the printed dice win.", () => {
  const cases = [
    ["Bite", "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) piercing damage.", "1d6", 3, "2d6+3"],
    ["Spear", "Melee or Ranged Weapon Attack: +4 to hit, reach 5 ft. or range 20/60 ft., one creature. Hit: 5 (1d6 + 2) piercing damage, or 6 (1d8 + 2) piercing damage if used with two hands to make a melee attack.", "1d6", -2, "1d6+2"],
    ["Longbow", "Ranged Weapon Attack: +5 to hit, range 150/600 ft., one target. Hit: 6 (1d8 + 2) piercing damage plus 7 (2d6) poison damage.", "2d6", undefined, "1d8+2+2d6"],
    ["Claws", "Melee Weapon Attack: +2 to hit, reach 5 ft., one creature. Hit: 2 (1d4) slashing damage plus 2 (1d4) fire damage.", "2d4", undefined, "1d4+1d4"],
    ["Spiked Bone Club", "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 5 (1d4 + 3) bludgeoning damage plus 2 (1d4) piercing damage.", "1d4+1d4", 5, "1d4+3+1d4"],
  ];
  for (const [name, desc, dice, bonus, expected] of cases) {
    const parsed = mk.parse(attackOf(name, desc, dice, bonus)).attacks[0];
    assert.equal(parsed?.damage, expected, name);
  }
});

await test("Every SRD attack in the content pack rolls the average its block prints, within a point.", () => {
  if (!world.hasPack) {
    return;
  }
  const rows = JSON.parse(execFileSync("sqlite3", ["-json", process.env.CONTENT_DB_PATH, "select data_json, cr from monsters where document_slug='wotc-srd'"], { maxBuffer: 1 << 28 }).toString());
  const off = [];
  for (const row of rows) {
    const data = JSON.parse(row.data_json);
    for (const attack of mk.parse(data).attacks) {
      const printed = printedAverage((data.actions ?? []).find((action) => action.name === attack.name)?.desc ?? "");
      if (printed !== null && Math.abs(Math.floor(averageOf(attack.damage)) - printed) > 1) {
        off.push(`${data.name} ${attack.name}: ${attack.damage} for a printed ${printed}`);
      }
    }
  }
  assert.deepEqual(off, []);
});

await test("A behir's Constrict is 2d10 + 6 bludgeoning plus 2d10 + 6 slashing, the slashing part its own, and the grapple restrains.", () => {
  const constrict = mk.parse(attackOf("Constrict", "Melee Weapon Attack: +10 to hit, reach 5 ft., one Large or smaller creature. Hit: 17 (2d10 + 6) bludgeoning damage plus 17 (2d10 + 6) slashing damage. The target is grappled (escape DC 16) if the behir isn't already constricting a creature, and the target is restrained until this grapple ends.", "2d10+2d10", 6, 10)).attacks[0];
  assert.equal(constrict.damage, "2d10+6+2d10+6");
  assert.deepEqual(constrict.riders, [{ dice: "2d10+6", type: "slashing" }]);
  assert.equal(constrict.onHit?.escapeDc, 16);
  assert.equal(constrict.onHit?.alsoCondition, "restrained");
  world.dice(5, 5, 5, 5);
  const parts = damageParts(rollExpression(constrict.damage), "bludgeoning", constrict.riders, { crit: false });
  world.clearDice();
  assert.deepEqual(parts, [{ type: "bludgeoning", amount: 16 }, { type: "slashing", amount: 16 }]);
});

await test("An attack whose hit prints a flat number and no dice is an attack for that number: a homunculus bites for 1 piercing, its poison a save rider.", () => {
  const bite = mk.parse(attackOf("Bite", "Melee Weapon Attack: +4 to hit, reach 5 ft., one creature. Hit: 1 piercing damage, and the target must succeed on a DC 10 Constitution saving throw or be poisoned for 1 minute.", undefined, undefined, 4)).attacks[0];
  assert.equal(bite?.damage, "1");
  assert.equal(bite.type, "piercing");
  assert.equal(bite.onHit?.condition, "poisoned");
});

// ---- Multiattack wordings (R1) ----

await test("The Multiattack wordings the routine parser missed name their attacks: alternatives, 'one to constrict', the medusa's dashes, forms, either-or, and the roper's tendrils.", () => {
  for (const [slug, expected] of Object.entries(ROUTINE_ROWS.expected)) {
    assert.deepEqual(mk.parse(routineRow(slug)).routines, expected, slug);
  }
});

await test("A grick's beak follows only a tentacle hit.", async () => {
  const grick = await stage(fighter, routineRow("grick"));
  kit.place(fighter.id, 5, 5);
  kit.place(grick.id, 5, 6);
  kit.freshRound();
  const missed = await mk.forced([1], () => world.invoke("enemy_attack", { enemyId: grick.id, targetCharacterId: fighter.id }));
  assert.equal(missed.ok, true, missed.error);
  assert.equal(d20Count(missed.rolled), 1, "the beak struck after a miss");
  kit.freshRound();
  const hit = await mk.forced([15, 1, 1, 15, 1], () => world.invoke("enemy_attack", { enemyId: grick.id, targetCharacterId: fighter.id }));
  assert.equal(hit.ok, true, hit.error);
  assert.equal(d20Count(hit.rolled), 2, "no beak after the tentacles hit");
});

// ---- monster grapples (new defects 2, 3, 4) ----

const TENTACLE = {
  ...DUMMY,
  attacks: [{ name: "Tentacle", toHit: 30, damage: "1d6", type: "bludgeoning", mode: "melee", reach: 10, onHit: { condition: "grappled", escapeDc: 25, alsoCondition: "restrained" } }],
};

async function grabbed() {
  const enemy = await stage(fighter);
  kit.setEnemy(enemy.id, { stats: TENTACLE });
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 7);
  kit.place(tief.id, 10, 10);
  kit.place(rogue.id, 12, 12);
  kit.freshRound();
  const out = await mk.forced([15, 3], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id }));
  assert.equal(out.ok, true, out.error);
  assert.ok(lower(world.sheet(fighter.id).conditions).includes("grappled"), "the tentacle did not grapple");
  return enemy;
}

await test("A monster's grapple from 10 feet holds while it stays within its reach: another token moving does not end it.", async () => {
  await grabbed();
  const moved = await world.invoke("move_token", { tokenName: rogue.id, x: 12, y: 13, forced: true });
  assert.equal(moved.ok, true, moved.error);
  assert.ok(lower(world.sheet(fighter.id).conditions).includes("grappled"), "an unrelated move ended a reach-10 grapple");
});

await test("Escaping a monster's grapple is a check against its printed escape DC, not a contest.", async () => {
  await grabbed();
  kit.giveTurn(fighter.id);
  const out = await mk.forced([12, 2, 2, 2], () => world.invoke("take_action", { characterId: fighter.id, action: "escape" }));
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, false, `escaped a DC 25 grapple with ${out.result.contest}`);
  assert.ok(lower(world.sheet(fighter.id).conditions).includes("grappled"));
  assert.equal(out.unused, 3, "the escape rolled more than the one check");
});

await test("The restraint a grapple brings ends with the grapple: an escape, or the grappler out of reach.", async () => {
  await grabbed();
  kit.giveTurn(fighter.id);
  const out = await mk.forced([20], () => world.invoke("take_action", { characterId: fighter.id, action: "escape" }));
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true, out.result.contest);
  assert.deepEqual(lower(world.sheet(fighter.id).conditions).filter((entry) => ["grappled", "restrained"].includes(entry)), []);
  await grabbed();
  // Pulled away on someone else's turn (a forced move is not the mover's own).
  kit.giveTurn(rogue.id);
  const pulled = await world.invoke("move_token", { tokenName: fighter.id, x: 5, y: 1, forced: true });
  assert.equal(pulled.ok, true, pulled.error);
  assert.deepEqual(lower(world.sheet(fighter.id).conditions).filter((entry) => ["grappled", "restrained"].includes(entry)), []);
});

// ---- the enemy's opportunity attack (new defect 5, R2) ----

async function leaveReach(hero, attack, traits = []) {
  const enemy = await stage(hero);
  kit.setEnemy(enemy.id, { stats: { ...DUMMY, traits, attacks: [attack] } });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  return enemy;
}

await test("An enemy's opportunity attack meets each damage type on its own: a tiefling halves only the fire.", async () => {
  await leaveReach(tief, { name: "Bite", toHit: 30, damage: "1d6+1d6", type: "piercing/fire", mode: "melee", reach: 5, riders: [{ dice: "1d6", type: "fire" }] });
  world.dice(15, 6, 6);
  const moved = await walk(tief, 5, 3);
  world.clearDice();
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(world.sheet(tief.id).currentHp, 60 - 6 - 3);
});

await test("An enemy's opportunity attack carries its on-hit rider: a wolf's bite as the target pulls away knocks it prone on a failed save.", async () => {
  await leaveReach(fighter, { name: "Bite", toHit: 30, damage: "2d4", type: "piercing", mode: "melee", reach: 5, onHit: { save: "str", dc: 11, condition: "prone" } });
  world.dice(15, 2, 2, 1);
  const moved = await walk(fighter, 5, 3);
  world.clearDice();
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.ok(lower(world.sheet(fighter.id).conditions).includes("prone"), "the opportunity bite carried no rider");
});

await test("An enemy with Magic Weapons makes a magical opportunity attack: Stoneskin does not halve it.", async () => {
  await leaveReach(fighter, { name: "Slam", toHit: 30, damage: "1d6", type: "bludgeoning", mode: "melee", reach: 5 }, ["Magic Weapons: The golem's weapon attacks are magical."]);
  world.patch(fighter.id, { conditions: ["stoneskin"], conditionMeta: {} });
  world.dice(15, 6);
  const moved = await walk(fighter, 5, 3);
  world.clearDice();
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(world.sheet(fighter.id).currentHp, 54);
});

// ---- a two-type blow with no rider data (R3) ----

await test("A stored attack with two damage types and no rider data still splits its blow by type: the tiefling halves only the fire.", async () => {
  const enemy = await stage(fighter);
  kit.setEnemy(enemy.id, { stats: { ...DUMMY, attacks: [{ name: "Bite", toHit: 30, damage: "1d6+1d6", type: "piercing/fire" }] } });
  kit.place(tief.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  const out = await mk.forced([15, 6, 6], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tief.id }));
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(tief.id).currentHp, 60 - 6 - 3);
});

// ---- the troll's death clause (G33) ----

const TROLL = {
  name: "Troll", size: "Large", type: "Giant", armor_class: 15, hit_points: 84, cr: 5,
  actions: [{ name: "Claw", desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 11 (2d6 + 4) slashing damage.", attack_bonus: 7, damage_dice: "2d6", damage_bonus: 4 }],
  special_abilities: [{ name: "Regeneration", desc: "The troll regains 10 hit points at the start of its turn. If the troll takes acid or fire damage, this trait doesn't function at the start of the troll's next turn. The troll dies only if it starts its turn with 0 hit points and doesn't regenerate." }],
};

await test("A troll cut down by a sword lies at 0 hit points and gets up at its turn; one burned while down dies when its turn starts.", async () => {
  const troll = await stage(fighter, TROLL);
  kit.place(troll.id, 8, 8);
  await world.invoke("damage_enemy", { enemyId: troll.id, amount: 200, type: "slashing" });
  assert.equal(kit.enemy(troll.id).status, "alive", "a sword killed the troll");
  assert.equal(kit.enemy(troll.id).currentHp, 0);
  assert.ok(kit.token(troll.id), "the downed troll's token was removed");
  assert.equal(world.encounter()?.status ?? "active", "active", "the fight ended with a troll still regenerating");
  nextRound();
  assert.equal(kit.enemy(troll.id).currentHp, 10);
  assert.ok(!lower(kit.enemy(troll.id).conditions).includes("unconscious"));
  await world.invoke("damage_enemy", { enemyId: troll.id, amount: 200, type: "slashing" });
  await world.invoke("damage_enemy", { enemyId: troll.id, amount: 5, type: "fire" });
  assert.equal(kit.enemy(troll.id).status, "alive");
  nextRound();
  assert.equal(kit.enemy(troll.id).status, "dead", "the burned troll got up");
});

// ---- enemy saves on the full save path (R4) ----

const ZOMBIE = {
  name: "Zombie", size: "Medium", type: "Undead", armor_class: 8, hit_points: 22, cr: 0.25, constitution: 16, constitution_save: 3,
  actions: [{ name: "Slam", desc: "Melee Weapon Attack: +3 to hit, reach 5 ft., one target. Hit: 4 (1d6 + 1) bludgeoning damage.", attack_bonus: 3, damage_dice: "1d6", damage_bonus: 1 }],
  special_abilities: [{ name: "Undead Fortitude", desc: "If damage reduces the zombie to 0 hit points, it must make a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, the zombie drops to 1 hit point instead." }],
};

await test("An enemy's Undead Fortitude and concentration saves are saves like any other: exhaustion 3 puts them at disadvantage.", async () => {
  const zombie = await stage(fighter, ZOMBIE);
  kit.setEnemy(zombie.id, { currentHp: 5, conditions: ["exhaustion 3"], conditionMeta: {} });
  const fortitude = await mk.forced([20, 1], () => world.invoke("damage_enemy", { enemyId: zombie.id, amount: 8, type: "slashing" }));
  assert.equal(fortitude.ok, true, fortitude.error);
  assert.equal(d20Count(fortitude.rolled), 2, "Undead Fortitude rolled one d20 under exhaustion 3");
  assert.equal(kit.enemy(zombie.id).status, "dead", "the worse die was not kept");
  const caster = await stage(fighter);
  kit.setEnemy(caster.id, { conditions: ["exhaustion 3"], conditionMeta: {} });
  encounters.setEnemyConcentration(caster.id, "Hold Person");
  const hit = await mk.forced([20, 1], () => world.invoke("damage_enemy", { enemyId: caster.id, amount: 4, type: "slashing" }));
  assert.equal(hit.ok, true, hit.error);
  assert.equal(d20Count(hit.rolled), 2, "the concentration save rolled one d20 under exhaustion 3");
  assert.equal(kit.enemy(caster.id).concentration, null);
});

// ---- Keen senses (G33) ----

await test("Keen Hearing and Smell: a hider has to beat the wolf's passive Perception with its advantage (+5).", async () => {
  const wolf = await stage(rogue, {
    name: "Wolf", size: "Medium", type: "Beast", armor_class: 13, hit_points: 11, cr: 0.25, wisdom: 12, senses: "passive Perception 13",
    actions: [{ name: "Bite", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage.", attack_bonus: 4, damage_dice: "2d4", damage_bonus: 2 }],
    special_abilities: [{ name: "Keen Hearing and Smell", desc: "The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell." }],
  });
  const board = kit.map();
  kit.openField(Array.from({ length: board.width }, (_, x) => [x, 7, "#"]));
  kit.place(rogue.id, 5, 5);
  kit.place(wolf.id, 5, 9);
  kit.place(fighter.id, 1, 1);
  kit.place(tief.id, 2, 1);
  const out = await mk.forced([14], () => world.invoke("take_action", { characterId: rogue.id, action: "hide" }));
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.vsPassivePerception, 18);
  assert.equal(out.result.hidden, false);
});

// ---- the grappler's free hand ----

await test("Grappling takes a free hand: with a weapon and a shield in hand the grab is refused and nothing is spent.", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }] });
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const out = await world.invoke("take_action", { characterId: fighter.id, action: "grapple", targetEnemyId: enemy.id });
  world.patch(fighter.id, { equipment: [] });
  assert.equal(out.ok, false, "a two-handed-full fighter grappled");
  assert.ok(!world.encounter().turnBudget?.actionUsed, "the refused grapple spent the action");
});

// ---- enemy reactions ----

await test("Parry: a creature with the reaction adds its bonus to its AC against one melee attack that would hit it, spending its reaction; the next attack meets its plain AC.", async () => {
  const captain = await stage(fighter, ROWS.banditCaptain);
  world.patch(fighter.id, { equipment: [{ name: "Longsword", qty: 1 }] });
  kit.place(fighter.id, 5, 5);
  kit.place(captain.id, 5, 6);
  // d20 10 + 6 = 16 against AC 15: a hit, turned by Parry's +2.
  const parried = await kit.swing(fighter.id, captain.id, [10, 6]);
  assert.equal(parried.ok, true, parried.error);
  assert.equal(parried.damage, null, "the parried swing still dealt damage");
  assert.ok(world.encounter().reactionsUsed.includes(captain.id), "Parry spent no reaction");
  const second = await kit.swing(fighter.id, captain.id, [10, 6]);
  assert.equal(second.ok, true, second.error);
  assert.ok(second.damage, "the second swing was parried with no reaction left");
  world.patch(fighter.id, { equipment: [] });
});

await kit.endFight();
world.close();
finish();
