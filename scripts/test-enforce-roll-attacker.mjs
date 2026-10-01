// Every attack and damage roll the engine stores records who made it, and
// its detail says what was used and against whom, at every site that rolls
// one: a character's weapon or spell (digital and with real dice), their
// features and reactions, a companion beast, an enemy, a fall, an area, and
// the spells cast at a creature, which store the damage card of the dice they
// roll. characterId keeps its meaning (the PC the roll concerns: the target
// of an enemy's blow) and every such roll stays public. The text the readers
// build from these is pinned in test-roll-labels.mjs.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { monsterKit, ROWS } from "./lib/enforce-monsters.mjs";
import { caster, closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-roll-attacker");
const world = await openWorld({ campaign: { maxPlayers: 20 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { resolveOpportunityAttacks, resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

const hero = (overrides) => world.addHero({ maxHp: 300, proficiencies: TRAINED, ...overrides });
const aria = hero({ name: "Aria", class: "fighter", level: 5, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
const rogue = hero({ name: "Rook", class: "rogue", level: 5, abilities: { dex: 16 } });
const guard = hero({ name: "Garr", class: "fighter", level: 3, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }, { name: "Shield", qty: 1 }] });
const monk = hero({ name: "Mae", class: "monk", level: 5, abilities: { dex: 16, wis: 14 } });
const warlock = hero({ name: "Wren", class: "warlock", subclass: "The Fiend", level: 14, abilities: { str: 14, cha: 16 }, equipment: [{ name: "Mace", qty: 1 }] });
const hunter = hero({ name: "Hale", class: "ranger", subclass: "Hunter", level: 15, abilities: { dex: 16 }, equipment: [{ name: "Shortsword", qty: 1 }] });
const ranger = hero({ name: "Rhea", class: "ranger", subclass: "Beast Master", level: 3, abilities: { dex: 16, wis: 14 }, equipment: [{ name: "Longbow", qty: 1 }] });
const stalker = hero({ name: "Sable", class: "ranger", subclass: "Gloom Stalker", level: 15, abilities: { dex: 16, wis: 14 } });
const watcher = hero({ name: "Vale", class: "paladin", subclass: "Oath of the Watchers", level: 7, abilities: { str: 16, cha: 16 } });
const heroes = [aria, rogue, guard, monk, warlock, hunter, ranger, stalker, watcher];
// A pick or a style is recorded after the sheet is made, as the builder does.
for (const [who, names] of [
  [guard, ["Fighting Style: Protection"]],
  [warlock, ["Hurl Through Hell"]],
  [hunter, ["Superior Hunter's Defense: Stand Against the Tide"]],
  [stalker, ["Shadowy Dodge"]],
  [watcher, ["Vigilant Rebuke"]],
]) {
  world.patch(who.id, { features: [...world.sheet(who.id).features, ...names.map((name) => ({ name, description: "" }))] });
}
const base = new Map(heroes.map((entry) => [entry.id, world.sheet(entry.id)]));

const asSheet = (who) => ({ kind: "sheet", id: who.id, name: world.sheet(who.id).name });
const asEnemy = (enemy) => ({ kind: "enemy", id: enemy.id, name: enemy.displayName });
const snapshot = () => new Set(listRecentRolls(world.campaignId, 200).map((roll) => roll.id));
// The combat rolls stored since a snapshot, oldest first.
const combatSince = (before, campaignId = world.campaignId) =>
  listRecentRolls(campaignId, 200).filter((roll) => !before.has(roll.id) && (roll.kind === "attack" || roll.kind === "damage"));
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });

// The roll as the table and the readers see it: who, what against whom, the
// PC it concerns, and that everybody sees it.
function expectRoll(roll, { kind, attacker, detail, characterId }) {
  assert.ok(roll, `no ${kind} roll "${detail}" was stored`);
  assert.equal(roll.kind, kind);
  assert.deepEqual(roll.attacker, attacker);
  assert.equal(roll.detail, detail);
  assert.equal(roll.characterId, characterId);
  assert.equal(roll.visibility, "public");
}

// `first` at the pointer beside one dummy, everyone else's slate wiped.
async function stage(first, { enemies = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { equipment: made.equipment, resources: made.resources, ac: 12, acOverride: true, currentHp: 300 });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === first.id ? 19 : 2]));
  await kit.fight(enemies, { heroFaces });
  const list = world.enemies();
  for (const enemy of list) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  kit.giveTurn(first.id);
  kit.place(first.id, 5, 5);
  kit.place(list[0].id, 5, 6);
  return world.enemies();
}

async function enemyHits(enemy, target, faces) {
  kit.freshRound();
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return out;
}

// ---- a character's own blows ----

await test("pc_attack: the attack and its damage are the character's, against the creature they targeted.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  const swing = await kit.swing(aria.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, true, swing.error);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asSheet(aria), detail: `Longsword vs ${enemy.displayName}`, characterId: aria.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A spell attack's half damage on a miss (Acid Arrow) is the caster's, against the target.", async () => {
  const { world: spells, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Acid Arrow"], [], 5)]);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(2, 2, 2, 2, 2);
  const out = await spells.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, enemyId: goblin.id, spell: "Acid Arrow" });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const damage = combatSince(before, spells.campaignId).find((roll) => roll.kind === "damage");
  expectRoll(damage, { kind: "damage", attacker: { kind: "sheet", id: wizard.id, name: wizard.name }, detail: `Acid Arrow (half on a miss) vs ${goblin.displayName}`, characterId: wizard.id });
});

await test("With real dice, the parked roll still says what it is for, and the rolls the player submits carry the attacker and the new detail, marked physical.", async () => {
  const [enemy] = await stage(aria);
  setMemberRealDice(world.campaignId, aria.userId, true);
  const before = snapshot();
  const parked = await world.invoke("pc_attack", { characterId: aria.id, targetEnemyId: enemy.id, enemyId: enemy.id });
  assert.equal(parked.ok, true, parked.error);
  const answer = async (kind, faces) => {
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === kind);
    assert.ok(pending, `no ${kind} roll was parked`);
    world.signIn({ id: aria.userId });
    const out = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return pending;
  };
  const toHit = await answer("attack", [18]);
  assert.equal(toHit.reason, `Longsword attack against ${enemy.displayName}`);
  const damage = await answer("damage", [5]);
  assert.equal(damage.reason, `Longsword damage against ${enemy.displayName}`);
  setMemberRealDice(world.campaignId, aria.userId, false);
  const [hitRoll, damageRoll] = combatSince(before);
  const expected = { attacker: asSheet(aria), detail: `Longsword vs ${enemy.displayName} (physical)`, characterId: aria.id };
  expectRoll(hitRoll, { kind: "attack", ...expected });
  expectRoll(damageRoll, { kind: "damage", ...expected });
});

await test("A character's opportunity attack is theirs, against the creature that broke away.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  world.clearDice();
  world.dice(15, 4);
  resolvePcOpportunityAttacks(world.campaign(), enemy.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
  world.clearDice();
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asSheet(aria), detail: `Longsword (opportunity attack) vs ${enemy.displayName}`, characterId: aria.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A blow at an object is the character's, against the object.", async () => {
  await kit.endFight();
  const before = snapshot();
  world.dice(15, 6);
  const out = await world.invoke("damage_object", { name: "the oak door", material: "wood", size: "medium", characterId: aria.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asSheet(aria), detail: "Longsword vs the oak door", characterId: aria.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A coated weapon's poison is the character's, against the creature hit.", async () => {
  const [enemy] = await stage(aria);
  world.patch(aria.id, { equipment: [{ name: "Longsword", qty: 1 }, { name: "Poison, basic (vial)", qty: 1 }] });
  const coat = await world.invoke("use_item", { characterId: aria.id, item: "Poison, basic (vial)" });
  assert.equal(coat.ok, true, coat.error);
  kit.freshTurn();
  const before = snapshot();
  // Hit, the longsword's d8, the dummy's CON save on a 1, the poison's d4.
  const swing = await kit.swing(aria.id, enemy.id, [15, 4, 1, 3]);
  assert.equal(swing.ok, true, swing.error);
  const poison = combatSince(before).find((roll) => roll.kind === "damage" && roll.detail.startsWith("Basic poison"));
  expectRoll(poison, { kind: "damage", attacker: asSheet(aria), detail: `Basic poison vs ${enemy.displayName}`, characterId: aria.id });
});

await test("Hurl Through Hell's return damage is the warlock's, against the creature that comes back.", async () => {
  const [enemy] = await stage(warlock);
  world.patch(warlock.id, { resources: { ...world.sheet(warlock.id).resources, hurl_through_hell: { max: 1, used: 0 } } });
  const hit = await kit.swing(warlock.id, enemy.id, [15, 3], { weapon: "Mace", hurlThroughHell: true });
  assert.equal(hit.ok, true, hit.error);
  assert.ok(kit.endTurn(world.sheet(warlock.id).userId));
  for (let step = 0; step < 20 && kit.current().characterId !== warlock.id; step += 1) {
    assert.ok(kit.endTurn(world.sheet(kit.current().characterId).userId));
  }
  const before = snapshot();
  world.clearDice();
  world.dice(new Array(10).fill(5));
  assert.ok(kit.endTurn(world.sheet(warlock.id).userId));
  world.clearDice();
  const [back] = combatSince(before);
  expectRoll(back, { kind: "damage", attacker: asSheet(warlock), detail: `Hurl Through Hell vs ${enemy.displayName}`, characterId: warlock.id });
});

// ---- reactions ----

await test("Deflect Missiles' throw back is the monk's, against the archer.", async () => {
  const [enemy] = await stage(aria);
  world.patch(monk.id, { resources: { ...world.sheet(monk.id).resources, ki: { max: 5, used: 0 } } });
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.place(monk.id, 5, 5);
  kit.place(aria.id, 9, 9);
  kit.place(enemy.id, 5, 8);
  await enemyHits(enemy, monk, [15, 6]);
  const before = snapshot();
  world.dice(10, 15, 4);
  const out = await react(monk, "Deflect Missiles", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asSheet(monk), detail: `Caught missile vs ${enemy.displayName}`, characterId: monk.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("Protection's second roll of the attack is the enemy's, against the protected ally.", async () => {
  const [enemy] = await stage(aria);
  kit.place(aria.id, 9, 9);
  kit.place(rogue.id, 5, 5);
  kit.place(guard.id, 5, 4);
  await enemyHits(enemy, rogue, [10, 3]);
  const before = snapshot();
  world.dice(2);
  const out = await react(guard, "Protection", { targetCharacterId: rogue.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [again] = combatSince(before);
  expectRoll(again, { kind: "attack", attacker: asEnemy(enemy), detail: "Club again, at disadvantage (Protection) vs Rook", characterId: null });
});

await test("An authored reaction's second roll of the attack (Shadowy Dodge) is the enemy's, against the one it hit.", async () => {
  const [enemy] = await stage(aria);
  kit.place(aria.id, 9, 9);
  kit.place(stalker.id, 5, 5);
  await enemyHits(enemy, stalker, [10, 3]);
  const before = snapshot();
  world.dice(2);
  const out = await react(stalker, "Shadowy Dodge");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [again] = combatSince(before);
  expectRoll(again, { kind: "attack", attacker: asEnemy(enemy), detail: "Club again, at disadvantage (Shadowy Dodge) vs Sable", characterId: null });
});

await test("An authored reaction that strikes back (Vigilant Rebuke) is the holder's, against the creature it strikes.", async () => {
  const [enemy] = await stage(aria);
  kit.place(watcher.id, 5, 4);
  const before = snapshot();
  world.dice(4, 4);
  const out = await react(watcher, "Vigilant Rebuke", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [rebuke] = combatSince(before);
  expectRoll(rebuke, { kind: "damage", attacker: asSheet(watcher), detail: `Vigilant Rebuke vs ${enemy.displayName}`, characterId: watcher.id });
});

await test("Stand Against the Tide's repeated attack is the enemy's, against the creature the Hunter turned it on.", async () => {
  const [attacker, other] = await stage(hunter, { enemies: 2 });
  kit.place(hunter.id, 5, 5);
  kit.place(other.id, 4, 5);
  kit.setEnemy(other.id, { ac: 5 });
  world.patch(hunter.id, { ac: 30, acOverride: true });
  await enemyHits(attacker, hunter, [2]);
  const before = snapshot();
  world.dice(18, 5);
  const out = await react(hunter, "Stand Against the Tide", { targetEnemyId: other.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [toHit, damage] = combatSince(before);
  expectRoll(toHit, { kind: "attack", attacker: asEnemy(attacker), detail: `Club again (Stand Against the Tide) vs ${other.displayName}`, characterId: null });
  expectRoll(damage, { kind: "damage", attacker: asEnemy(attacker), detail: `Club (Stand Against the Tide) vs ${other.displayName}`, characterId: null });
});

// ---- a companion beast ----

await test("A companion beast's attack is the beast's (its owner's sheet holds it), against its target.", async () => {
  const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  base.set(ranger.id, world.sheet(ranger.id));
  const [enemy] = await stage(ranger);
  const wolf = world.sheet(ranger.id).pets[0];
  const before = snapshot();
  world.dice(15, 3, 3);
  const bite = await world.invoke("pet_attack", { characterId: ranger.id, petName: wolf.name, targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: { kind: "pet", id: ranger.id, name: wolf.name }, detail: `${wolf.attacks[0].name} vs ${enemy.displayName}`, characterId: ranger.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

// ---- an enemy's blows ----

await test("enemy_attack: the attack and its damage are the enemy's, against the character, whom characterId still names.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  await enemyHits(enemy, aria, [15, 3]);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asEnemy(enemy), detail: "Club vs Aria", characterId: aria.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A hit's rider damage (a giant spider's poison) is the enemy's, against the character.", async () => {
  const [spider] = await stage(aria);
  mk.stage(spider.id, ROWS.giantSpider);
  kit.freshRound();
  const before = snapshot();
  const out = await mk.forced([15, 8, 20, 6, 6], () => world.invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: aria.id }));
  assert.equal(out.ok, true, out.error);
  const rider = combatSince(before).find((roll) => roll.kind === "damage" && roll.detail.includes("(poison)"));
  expectRoll(rider, { kind: "damage", attacker: asEnemy(kit.enemy(spider.id)), detail: "Bite (poison) vs Aria", characterId: aria.id });
});

await test("An enemy's opportunity attack is the enemy's, against the character who pulled away.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  world.clearDice();
  world.dice(18, 6);
  resolveOpportunityAttacks(world.campaign(), aria.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asEnemy(enemy), detail: "Club (opportunity attack) vs Aria", characterId: null };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A falling enemy's damage has no attacker and names the creature it lands on.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  const out = await mk.forced([3, 3, 3], () => world.invoke("damage_enemy", { enemyId: enemy.id, source: "hazard", fallFeet: 30 }));
  assert.equal(out.ok, true, out.error);
  const [fall] = combatSince(before);
  expectRoll(fall, { kind: "damage", attacker: null, detail: `30 ft fall (3d6 bludgeoning) on ${enemy.displayName}`, characterId: null });
});

await test("The post-fight summary does not give a character the enemy's natural 20 against them.", async () => {
  const [enemy] = await stage(aria);
  await enemyHits(enemy, aria, [20, 3, 3]);
  const encounterId = world.encounter().id;
  await kit.endFight();
  const row = getDatabase().prepare("SELECT summary_json FROM encounters WHERE id = ?").get(encounterId);
  const fighter = JSON.parse(row.summary_json).fighters.find((line) => line.characterId === aria.id);
  assert.equal(fighter.nat20s, 0);
});

// ---- spells cast at a creature, and areas ----

const onTurn = (campaignId, rollId) =>
  getDatabase().prepare("SELECT COUNT(*) AS n FROM dm_turns WHERE campaign_id = ? AND roll_ids_json LIKE ?").get(campaignId, `%${rollId}%`).n > 0;

await test("cast_at_enemy stores a public damage card of its dice: the caster's, against the target, on the turn, not applied.", async () => {
  const { world: spells, sheets: [cleric], enemies: [goblin] } = await table([caster("cleric", "wis", [], ["Sacred Flame"], 5)]);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(1, 6);
  const out = await spells.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Sacred Flame", saveAbility: "dex" });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [card] = combatSince(before, spells.campaignId);
  expectRoll(card, { kind: "damage", attacker: { kind: "sheet", id: cleric.id, name: cleric.name }, detail: `Sacred Flame vs ${goblin.displayName}`, characterId: cleric.id });
  assert.equal(card.applied, false);
  assert.ok(onTurn(spells.campaignId, card.id), "the card is not on the turn's rolls");
});

await test("cast_at_player stores a public damage card: the casting enemy's, or nobody's for a trap, against the character.", async () => {
  const { world: spells, sheets: [fighter], enemies: [shaman] } = await table([{ ...FIGHTER, name: "Aria" }], 1, { spells: ["Sacred Flame"] });
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(1, 6);
  const cast = await spells.invoke("cast_at_player", { characterId: fighter.id, casterEnemyId: shaman.id, spell: "Sacred Flame", saveAbility: "dex", dc: 13, damage: "1d8", damageType: "radiant" });
  spells.clearDice();
  assert.equal(cast.ok, true, cast.error);
  spells.dice(1, 3);
  const trap = await spells.invoke("cast_at_player", { characterId: fighter.id, source: "Poison dart trap", saveAbility: "dex", dc: 12, damage: "1d4", damageType: "poison" });
  spells.clearDice();
  assert.equal(trap.ok, true, trap.error);
  const [spell, dart] = combatSince(before, spells.campaignId);
  expectRoll(spell, { kind: "damage", attacker: asEnemy(shaman), detail: "Sacred Flame vs Aria", characterId: fighter.id });
  expectRoll(dart, { kind: "damage", attacker: null, detail: "Poison dart trap vs Aria", characterId: fighter.id });
  assert.ok(onTurn(spells.campaignId, spell.id), "the card is not on the turn's rolls");
});

await test("Each damaging ray of Prismatic Spray stores a card: the caster's, against the creature it strikes.", async () => {
  const { world: spells, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Prismatic Spray"], [], 13), { ...FIGHTER, name: "Bren" }]);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  // Each creature: its DEX save, its ray (1: red), the ray's 10d6.
  spells.dice(1, 1, ...new Array(10).fill(2), 1, 1, ...new Array(10).fill(2));
  const out = await spells.invoke("aoe_damage", { casterId: wizard.id, spell: "Prismatic Spray", enemyIds: [goblin.id], characterIds: [fighter.id], saveAbility: "dex", dc: 17, level: 7 });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const wizardRoller = { kind: "sheet", id: wizard.id, name: wizard.name };
  const [onGoblin, onBren] = combatSince(before, spells.campaignId);
  expectRoll(onGoblin, { kind: "damage", attacker: wizardRoller, detail: `Prismatic Spray (red) vs ${goblin.displayName}`, characterId: wizard.id });
  expectRoll(onBren, { kind: "damage", attacker: wizardRoller, detail: "Prismatic Spray (red) vs Bren", characterId: fighter.id });
});

await test("A character's area spell is theirs and names the creatures it can harm, not the ally Sculpt Spells shapes it around.", async () => {
  const { world: spells, sheets: [wizard, fighter], enemies } = await table([caster("wizard", "int", ["Fireball"], [], 5), { ...FIGHTER, name: "Bren" }], 3);
  spells.patch(wizard.id, { features: [...spells.sheet(wizard.id).features, { name: "Sculpt Spells", source: "test" }] });
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1, 1, 1);
  const out = await spells.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: enemies.map((enemy) => enemy.id), characterIds: [fighter.id], saveAbility: "dex", dc: 15, level: 3 });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: { kind: "sheet", id: wizard.id, name: wizard.name }, detail: `Fireball on ${enemies.map((enemy) => enemy.displayName).join(", ")}`, characterId: null });
});

await test("An enemy's area spell is the enemy's and names every character it catches.", async () => {
  const { world: spells, sheets, enemies: [mage] } = await table(
    [{ ...FIGHTER, name: "Aria" }, { ...FIGHTER, name: "Bren" }, { ...FIGHTER, name: "Cora" }], 1, { spells: ["Fireball"] },
  );
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1, 1, 1);
  const out = await spells.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Fireball", characterIds: sheets.map((sheet) => sheet.id), saveAbility: "dex", dc: 15, damage: "8d6", type: "fire" });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: asEnemy(mage), detail: "Fireball on Aria, Bren, Cora", characterId: null });
});

await test("An area roll leaves out an enemy whose token the players cannot see.", async () => {
  const { world: spells, sheets: [wizard], enemies: [seen, unseen] } = await table([caster("wizard", "int", ["Fireball"], [], 5)], 2);
  await layMap(spells, ["..........", "..........", ".........."], { [wizard.id]: { x: 0, y: 0 }, [seen.id]: { x: 6, y: 1 }, [unseen.id]: { x: 7, y: 1 } });
  getDatabase().prepare("UPDATE battle_tokens SET hidden = 1 WHERE ref_id = ?").run(unseen.id);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1, 1);
  const out = await spells.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [seen.id, unseen.id], saveAbility: "dex", dc: 15, level: 3 });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: { kind: "sheet", id: wizard.id, name: wizard.name }, detail: `Fireball on ${seen.displayName}`, characterId: null });
  // Left off the card, not out of the blast.
  const hidden = spells.enemies().find((enemy) => enemy.id === unseen.id);
  assert.ok(hidden.currentHp < hidden.maxHp, "the hidden goblin took no damage");
});

await test("An area that catches only hidden enemies names none of them, and they still take the damage.", async () => {
  const { world: spells, sheets: [wizard], enemies: [unseen] } = await table([caster("wizard", "int", ["Fireball"], [], 5)]);
  await layMap(spells, ["..........", "..........", ".........."], { [wizard.id]: { x: 0, y: 0 }, [unseen.id]: { x: 7, y: 1 } });
  getDatabase().prepare("UPDATE battle_tokens SET hidden = 1 WHERE ref_id = ?").run(unseen.id);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1);
  const out = await spells.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [unseen.id], saveAbility: "dex", dc: 15, level: 3 });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: { kind: "sheet", id: wizard.id, name: wizard.name }, detail: "Fireball", characterId: null });
  const hidden = spells.enemies().find((enemy) => enemy.id === unseen.id);
  assert.equal(hidden.currentHp, hidden.maxHp - 24);
});

await kit.endFight();
closeTables();
world.close();
finish();
