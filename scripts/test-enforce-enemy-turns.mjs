// The fight loop around the monsters (SRD 5.1, Combat): initiative rolled as
// the fight opens, surprise decided by Stealth against passive Perception,
// the enemies' turns taken when a character's turn ends, a companion walking
// on its own turn, a prone creature standing, a frightened one keeping away,
// a mounted rider moving at the mount's speed. And the doors the AI must not
// use to skip the rules: damage with no source, a teleport with no spell.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { d20Count, monsterKit } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-enemy-turns");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const rolls = await import("../src/lib/db/rolls.ts");
const { getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { advanceAfterTurn } = await import("../src/lib/dm/encounter-tools.ts");

const scout = world.addHero({
  name: "Scout", class: "fighter", level: 1, abilities: { wis: 14 }, proficiencies: TRAINED,
  maxHp: 60, ac: 10, acOverride: true, speed: 30,
});
const watcher = world.addHero({
  name: "Watcher", class: "fighter", level: 13, abilities: { wis: 20 },
  proficiencies: { ...TRAINED, skills: ["perception"] },
  maxHp: 60, ac: 10, acOverride: true, speed: 30,
  spellcasting: { ability: "int", slots: { 2: { max: 2, used: 0 } }, prepared: ["Misty Step"], known: [], cantrips: [] },
});
const heroes = [scout, watcher];

// Scout 19, the enemy 10, Watcher 3: the enemy's turn sits between theirs.
async function stage(count = 1, faces = { [scout.id]: 19, [watcher.id]: 3 }, enemyFace = 10) {
  await kit.endFight();
  for (const hero of heroes) {
    world.patch(hero.id, { currentHp: 60, conditions: [], conditionMeta: {} });
  }
  await kit.fight(count, { heroFaces: faces, enemyFace });
  kit.place(scout.id, 5, 5);
  kit.place(watcher.id, 5, 12);
  const enemies = world.enemies();
  enemies.forEach((enemy, index) => kit.place(enemy.id, 5 + index * 2, 6));
  return enemies;
}

const attacksBy = (enemy) =>
  rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack" && roll.attacker?.id === enemy.id).length;

async function walk(hero, x, y) {
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: hero.userId });
  return route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x, y }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
}

// ---- the enemies' turns after end_turn (N:S6, N:C7) ----

await test("When the model ends a character's turn, the enemies whose turns come next are handed to it to act now, and the auto-act backstop does not act them a second time.", async () => {
  const [enemy] = await stage();
  const turn = mk.aiTurn();
  world.say("player", "That's my turn.", scout);
  const ended = await mk.ai(turn, "end_turn", { characterId: scout.id });
  assert.equal(ended.ok, true, ended.error);
  assert.ok(JSON.stringify(ended.result.enemiesToAct ?? []).includes(enemy.id), "end_turn named no enemy to act");
  const hit = await mk.forced([15, 3], () => mk.ai(turn, "enemy_attack", { enemyId: enemy.id, targetCharacterId: scout.id }));
  assert.equal(hit.ok, true, hit.error);
  const before = attacksBy(enemy);
  advanceAfterTurn(world.campaign(), getDmTurn(turn.id));
  assert.equal(attacksBy(enemy), before, "the enemy the model acted was auto-acted again");
  assert.equal(kit.current().characterId, watcher.id);
});

// ---- an enemy acts on its own turn (N:C4) ----

await test("The AI's enemy acts on its own turn: before the pointer reaches it, its attack and its spells are refused; once end_turn hands it over, it acts.", async () => {
  const [enemy] = await stage();
  const turn = mk.aiTurn();
  const attacksBefore = attacksBy(enemy);
  const early = await mk.ai(turn, "enemy_attack", { enemyId: enemy.id, targetCharacterId: scout.id });
  assert.equal(early.ok, false, "an enemy attacked during Scout's turn, before its own");
  const spell = await mk.ai(turn, "cast_at_player", { characterId: scout.id, casterEnemyId: enemy.id, saveAbility: "dex", dc: 12, damage: "1d6" });
  assert.equal(spell.ok, false, "an enemy cast during Scout's turn, before its own");
  assert.equal(attacksBy(enemy), attacksBefore);
  world.say("player", "That's my turn.", scout);
  const ended = await mk.ai(turn, "end_turn", { characterId: scout.id });
  assert.equal(ended.ok, true, ended.error);
  const now = await mk.forced([15, 3], () => mk.ai(turn, "enemy_attack", { enemyId: enemy.id, targetCharacterId: scout.id }));
  assert.equal(now.ok, true, now.error);
  // The DM's own hand at the console is not held to the order.
  await stage();
  const [again] = world.enemies();
  kit.freshRound();
  const console = await mk.forced([15, 3], () => world.invoke("enemy_attack", { enemyId: again.id, targetCharacterId: scout.id }));
  assert.equal(console.ok, true, console.error);
});

await test("The backstop's enemy picks a character it can see over a hidden one", async () => {
  const { pickEnemyTarget } = await import("../src/lib/dm/encounter-logic.ts");
  const picked = pickEnemyTarget({ x: 0, y: 0 }, [
    { characterId: "near-hidden", ac: 10, position: { x: 1, y: 0 }, unseen: true },
    { characterId: "far-seen", ac: 18, position: { x: 4, y: 0 } },
  ]);
  assert.equal(picked, "far-seen");
  const onlyHidden = pickEnemyTarget({ x: 0, y: 0 }, [{ characterId: "near-hidden", ac: 10, position: { x: 1, y: 0 }, unseen: true }]);
  assert.equal(onlyHidden, "near-hidden");
});

// ---- "Play the rest for me" at a person's table ----

// A goblin's two attacks (SRD 5.1): its Scimitar in melee, its Shortbow at
// 80/320 ft. Its usual turn leads with the Scimitar.
const ARCHER = [
  { name: "Scimitar", toHit: 4, damage: "1d6+2", type: "slashing", mode: "melee", reach: 5 },
  { name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing", mode: "ranged", range: { normal: 80, long: 320 } },
];

// The lead ends Scout's turn, the pointer walks past the enemy, and "Play
// the rest for me" hands the enemy's turn to the server.
async function playTheRest(enemy, at) {
  kit.setEnemy(enemy.id, { stats: { attacks: ARCHER } });
  kit.place(scout.id, 2, 2);
  kit.place(watcher.id, 2, 0);
  kit.place(enemy.id, ...at);
  const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
  const { endOwnTurn, handOnEnemyTurns } = await import("../src/lib/dm/encounter-tools.ts");
  assert.equal(endOwnTurn(world.campaignId, world.owner.id), true, "Scout's turn ended");
  assert.ok((world.encounter().legendary.due ?? []).includes(enemy.id), "the enemy's turn is due");
  const campaign = world.campaign();
  world.dice(15, 3);
  const refused = onPersonsTurn(campaign, (turn) => handOnEnemyTurns(campaign, turn, true));
  world.clearDice();
  assert.equal(refused, null, refused);
}
const enemyRolls = (enemy) => rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack" && roll.attacker?.id === enemy.id);

await test("Played for the lead, an enemy that cannot reach anyone in melee this turn shoots its bow from where it stands, and the table reads it.", async () => {
  const [enemy] = await stage();
  const before = enemyRolls(enemy).length;
  // 45 ft from Scout, with 30 ft of speed: the Scimitar cannot get there.
  await playTheRest(enemy, [11, 2]);
  const made = enemyRolls(enemy).slice(0, enemyRolls(enemy).length - before);
  assert.equal(made.length, 1, "the enemy made no attack");
  assert.match(made[0].detail, /Shortbow/);
  assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [11, 2], "it walked up for nothing");
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const lines = getDatabase().prepare(`SELECT content FROM campaign_messages WHERE campaign_id = ? ORDER BY seq DESC LIMIT 5`).all(world.campaignId);
  assert.ok(lines.some((line) => line.content.includes(`${enemy.displayName} attacks Scout with Shortbow`)), "the chronicle has no line for the shot");
});

await test("Played for the lead, an enemy that can walk into melee still does, with its usual weapon.", async () => {
  const [enemy] = await stage();
  const before = enemyRolls(enemy).length;
  // 20 ft away: four squares, one of them its reach.
  await playTheRest(enemy, [6, 2]);
  const made = enemyRolls(enemy).slice(0, enemyRolls(enemy).length - before);
  assert.equal(made.length, 1, "the enemy made no attack");
  assert.match(made[0].detail, /Scimitar/);
  assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [3, 2], "it walked in");
});

await test("Played for the lead, a prone enemy that could walk into melee standing but not after standing up shoots its bow instead.", async () => {
  const [enemy] = await stage();
  await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "prone" });
  const before = enemyRolls(enemy).length;
  // 30 ft away: its 30 ft would carry it beside Scout, but standing costs 15.
  await playTheRest(enemy, [8, 2]);
  const made = enemyRolls(enemy).slice(0, enemyRolls(enemy).length - before);
  assert.equal(made.length, 1, "the enemy stood, walked short and made no attack");
  assert.match(made[0].detail, /Shortbow/);
  assert.ok(!kit.enemy(enemy.id).conditions.includes("prone"), "it stood to shoot");
  assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [8, 2]);
});

// ---- initiative at the start (N:S15, N:T12) ----

await test("When the AI opens a fight, the server rolls initiative for every character whose dice it rolls, so the fight starts in the same call.", async () => {
  await kit.endFight();
  const turn = mk.aiTurn();
  const started = await mk.ai(turn, "start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(started.ok, true, started.error);
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true, "the order waits on request_roll calls");
  assert.equal(encounter.order.filter((entry) => entry.kind === "pc").length, heroes.length);
});

// ---- surprise (C:G23, N:T7) ----

await test("An ambush is decided per creature: the hiders' Stealth against each opponent's passive Perception; only those who notice no threat are surprised.", async () => {
  await kit.endFight();
  // The goblin's initiative, then its Stealth: 13 plus its modifier lands
  // between the Scout's passive 12 and the Watcher's 20.
  const out = await mk.forced([10, 13], () =>
    world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }], ambush: "enemies" }),
  );
  assert.equal(out.ok, true, out.error);
  const surprised = world.encounter().surprisedIds;
  assert.ok(surprised.includes(scout.id), "the Scout (passive 12) was not surprised");
  assert.ok(!surprised.includes(watcher.id), "the Watcher (passive 20) was surprised");
});

// ---- prone enemies stand (C:G7) ----

await test("A prone creature stands up on its turn by spending half its speed, then attacks normally; without that much movement left it stays prone.", async () => {
  const [enemy] = await stage();
  await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "prone" });
  kit.freshRound();
  const up = await mk.forced([15, 15, 3], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: scout.id }));
  assert.equal(up.ok, true, up.error);
  assert.equal(d20Count(up.rolled), 1, "a creature that could stand attacked from the ground");
  assert.ok(!kit.enemy(enemy.id).conditions.includes("prone"));
  assert.equal(kit.token(enemy.id).movedThisRound, 3);
  await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "prone" });
  kit.freshRound();
  kit.place(enemy.id, 5, 6, 5);
  const down = await mk.forced([15, 15, 3], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: scout.id }));
  assert.equal(down.ok, true, down.error);
  assert.ok(kit.enemy(enemy.id).conditions.includes("prone"), "it stood with 5 feet of movement left");
  assert.equal(d20Count(down.rolled), 2);
});

// ---- frightened movement (C:G20) ----

await test("A frightened creature cannot willingly move closer to the source of its fear.", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 5, 10);
  await world.invoke("set_condition", { characterId: scout.id, condition: "frightened", sourceEnemyId: enemy.id });
  kit.giveTurn(scout.id);
  const closer = await walk(scout, 5, 7);
  assert.notEqual(closer.status, 200, "the frightened Scout walked toward the source");
  const away = await walk(scout, 5, 4);
  assert.equal(away.status, 200);
  // The other way round: a frightened enemy does not close on its source.
  await world.invoke("clear_condition", { characterId: scout.id, condition: "frightened" });
  await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "frightened", sourceCharacterId: scout.id });
  kit.freshRound();
  const before = [kit.token(enemy.id).x, kit.token(enemy.id).y];
  await mk.forced([15, 3], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: scout.id }));
  assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], before, "a frightened enemy walked up to its source");
});

// ---- mounted movement (C:G25) ----

await test("A mounted rider moves at the mount's speed, and mounting costs half the rider's own speed.", async () => {
  await stage();
  kit.place(scout.id, 1, 1);
  kit.giveTurn(scout.id);
  const mounted = await world.invoke("mount_up", { characterId: scout.id, mount: "Riding horse" });
  assert.equal(mounted.ok, true, mounted.error);
  // 60 ft is 12 squares, less 3 for mounting.
  const far = await walk(scout, 1, 11);
  assert.notEqual(far.status, 200, "mounting cost nothing");
  const ride = await walk(scout, 1, 10);
  assert.equal(ride.status, 200, "the rider moved at their own speed, not the horse's");
  await world.invoke("dismount", { characterId: scout.id });
});

// ---- companions walk (N:S7) ----

await test("An AI companion walks on its own turn with its own speed, through move_token, as a player would from the board.", async () => {
  await kit.endFight();
  const joined = await world.invoke("add_companion", {
    gender: "Unknown",
    name: "Brannoc", class: "fighter", race: "human", level: 1, personality: "Steady.", kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  const companionId = joined.result.characterId;
  try {
    await kit.fight(1, { heroFaces: { [scout.id]: 19, [watcher.id]: 3, [companionId]: 18 } });
    kit.place(scout.id, 5, 5);
    kit.place(watcher.id, 5, 12);
    kit.place(companionId, 1, 1);
    kit.giveTurn(companionId);
    const turn = mk.aiTurn();
    const moved = await mk.ai(turn, "move_token", { token: companionId, x: 1, y: 5 });
    assert.equal(moved.ok, true, moved.error);
    assert.deepEqual([kit.token(companionId).x, kit.token(companionId).y], [1, 5]);
    assert.equal(kit.token(companionId).movedThisRound, 4);
    const past = await mk.ai(turn, "move_token", { token: companionId, x: 1, y: 12 });
    assert.notDeepEqual([kit.token(companionId).x, kit.token(companionId).y], [1, 12], "a companion walked past its speed");
    assert.ok(past);
  } finally {
    await kit.endFight();
    await world.invoke("dismiss_companion", { characterId: companionId });
  }
});

// ---- the AI's damage and teleport doors (N:B4, N:C6, N:B8) ----

await test("The AI's damage_enemy is for harm that is no creature's attack (a hazard, the environment); an ally's blow goes through a recruited ally's own attack.", async () => {
  const [enemy] = await stage();
  const turn = mk.aiTurn();
  const bare = await mk.ai(turn, "damage_enemy", { enemyId: enemy.id, amount: 10 });
  assert.equal(bare.ok, false, "damage with no source landed");
  const ally = await mk.ai(turn, "damage_enemy", { enemyId: enemy.id, amount: 10, source: "ally" });
  assert.equal(ally.ok, false, "an unrecruited ally's blow landed");
  // A hazard's damage is dice the server rolls (src/lib/dm/ai-gate.ts).
  const written = await mk.ai(turn, "damage_enemy", { enemyId: enemy.id, amount: 10, source: "hazard", reason: "the chandelier falls" });
  assert.equal(written.ok, false, "a number the model wrote landed");
  world.dice(5, 5);
  const falling = await mk.ai(turn, "damage_enemy", { enemyId: enemy.id, dice: "2d6", source: "hazard", reason: "the chandelier falls" });
  world.clearDice();
  assert.equal(falling.ok, true, falling.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 30);
  // The DM's own hand is not the AI's.
  assert.equal((await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 5 })).ok, true);
});

await test("The AI moves a combatant by teleport only through the spell that does it, cast and paid for, or a hazard; the DM's own hand stays free.", async () => {
  await stage();
  kit.giveTurn(watcher.id);
  const turn = mk.aiTurn();
  world.say("player", "I Misty Step away.", watcher);
  const free = await mk.ai(turn, "teleport_token", { token: watcher.id, x: 8, y: 12 });
  assert.equal(free.ok, false, "a free teleport");
  const misty = await mk.ai(turn, "teleport_token", { token: watcher.id, x: 8, y: 12, spell: "Misty Step", casterId: watcher.id });
  assert.equal(misty.ok, true, misty.error);
  assert.equal(world.sheet(watcher.id).spellcasting.slots[2].used, 1);
  world.patch(watcher.id, { spellcasting: watcher.spellcasting });
  assert.equal((await world.invoke("teleport_token", { token: watcher.id, x: 9, y: 12 })).ok, true);
});

// A class feature's teleport is paid by its spend (src/lib/dm/feature-teleport.ts):
// move_token names the feature and its user, spends no slot, and goes no
// farther than the feature allows, once.
await test("The AI teleports a character by the feature they just spent, within its range and only once.", async () => {
  const { creditFeatureTeleport } = await import("../src/lib/dm/feature-teleport.ts");
  await stage();
  kit.giveTurn(watcher.id);
  const turn = mk.aiTurn();
  world.say("player", "I step between the shadows.", watcher);
  const slots = JSON.stringify(world.sheet(watcher.id).spellcasting.slots);
  creditFeatureTeleport(watcher.id, "Walk Between", 30);
  const far = await mk.ai(turn, "move_token", { token: watcher.id, x: 5, y: 20, teleport: true, spell: "Walk Between", casterCharacterId: watcher.id });
  assert.equal(far.ok, false, "a jump past the feature's 30 feet");
  const step = await mk.ai(turn, "move_token", { token: watcher.id, x: 8, y: 12, teleport: true, spell: "Walk Between", casterCharacterId: watcher.id });
  assert.equal(step.ok, true, step.error);
  assert.equal(JSON.stringify(world.sheet(watcher.id).spellcasting.slots), slots, "the feature's teleport spent a slot");
  const again = await mk.ai(turn, "move_token", { token: watcher.id, x: 9, y: 12, teleport: true, spell: "Walk Between", casterCharacterId: watcher.id });
  assert.equal(again.ok, false, "one spend paid for two teleports");
});

// An enemy's teleport is the ability on its block, named in enemyAbility
// beside casterEnemyId, as an area's is (aoe_damage).
await test("The AI teleports an enemy by the ability on its stat block, and by no other.", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { stats: { ...enemy.stats, traits: ["Fey Step. The creature magically teleports up to 30 feet to an unoccupied space it can see."] } });
  const turn = mk.aiTurn();
  const alone = await mk.ai(turn, "move_token", { token: enemy.id, x: 9, y: 6, teleport: true, enemyAbility: "Fey Step" });
  assert.match(alone.error ?? "", /send it with casterEnemyId/);
  const unlisted = await mk.ai(turn, "move_token", { token: enemy.id, x: 9, y: 6, teleport: true, enemyAbility: "Shadow Step", casterEnemyId: enemy.id });
  assert.match(unlisted.error ?? "", /has no Shadow Step on its stat block/);
  const step = await mk.ai(turn, "move_token", { token: enemy.id, x: 9, y: 6, teleport: true, enemyAbility: "Fey Step", casterEnemyId: enemy.id });
  assert.equal(step.ok, true, step.error);
});

// ---- companion auto-act (N:R8) ----

await test("A companion whose action is already spent this turn is not given a second one by the auto-act backstop.", async () => {
    await kit.endFight();
    const joined = await world.invoke("add_companion", {
      gender: "Unknown",
      name: "Wren", class: "fighter", race: "human", level: 1, personality: "Quiet.", kind: "guest",
    });
    assert.equal(joined.ok, true, joined.error);
    const companionId = joined.result.characterId;
    try {
      await kit.fight(1, { heroFaces: { [scout.id]: 3, [watcher.id]: 2, [companionId]: 19 } });
      const [enemy] = world.enemies();
      kit.place(companionId, 5, 5);
      kit.place(enemy.id, 5, 6);
      const encounter = world.encounter();
      assert.equal(kit.current().characterId, companionId);
      kit.saveEncounter({
        ...encounter,
        turnBudget: {
          ownerId: companionId, round: encounter.round, actionUsed: true, bonusUsed: false, reactionUsed: false,
          attacksMade: 0, attacksAllowed: 1, oncePerTurn: [], dashed: false, disengaged: false,
        },
      });
      const turn = mk.aiTurn();
      const before = rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
      world.dice(15, 4);
      advanceAfterTurn(world.campaign(), getDmTurn(turn.id));
      world.clearDice();
      const after = rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
      assert.equal(after, before, "the backstop swung for a companion whose action was spent");
      assert.notEqual(kit.current()?.characterId, companionId);
    } finally {
      await kit.endFight();
      await world.invoke("dismiss_companion", { characterId: companionId });
    }
});

// ---- low rows ----

await test("Damage the engine rolled lands in full on an enemy: there is no cap of 200 on one blow.", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  const out = await mk.forced([1], () =>
    world.invoke("aoe_damage", { enemyIds: [enemy.id], damage: 250, saveAbility: "dex", dc: 30, halfOnSave: false }),
  );
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 50);
});

await test("The human DM's damage_enemy needs no source", async () => {
  const [enemy] = await stage();
  const out = await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 7 });
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 33);
});

await kit.endFight();
world.close();
finish();
