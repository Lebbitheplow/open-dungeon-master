// What a character's class features and feats do to their own attacks,
// resolved by pc_attack (src/lib/dm/pc-attack*.ts), every die forced: Martial
// Arts and its bonus strike, Stunning Strike, Reckless Attack both ways,
// Frenzy, Divine Strike's damage type, Bardic Inspiration on an attack roll,
// Colossus Slayer, the reach of a widened critical range and of Ki-Empowered
// Strikes, the Grappler feat, the ally Sneak Attack needs, knocking a
// creature out, and the situational advantage the AI may claim.
//
// The rules, from SRD 5.1:
//   - Martial Arts: unarmed strikes and monk weapons (shortsword, simple melee
//     weapons that are not two-handed or heavy) may use DEX and the Martial
//     Arts die, and after the Attack action with one of them a bonus action
//     makes one unarmed strike. Only with no armor and no shield.
//   - Stunning Strike (monk 5): on a melee weapon hit, 1 ki: CON save against
//     the ki DC (8 + proficiency + WIS) or stunned.
//   - Reckless Attack (barbarian 2): on the first attack of the turn,
//     advantage on melee weapon attacks using STR this turn; attack rolls
//     against the barbarian have advantage until their next turn.
//   - Frenzy (Berserker 3): while raging in a frenzy, one melee weapon attack
//     as a bonus action on each turn after this one.
//   - Divine Strike (Life 8): 1d8 radiant once per turn on a weapon hit.
//   - Bardic Inspiration: the die is added to one attack roll, check or save.
//   - Colossus Slayer (Hunter 3): 1d8 more once per turn against a creature
//     below its hit point maximum.
//   - Improved Critical: WEAPON attacks crit on 19. Ki-Empowered Strikes:
//     UNARMED strikes count as magical.
//   - Grappler: advantage on attacks against a creature you are grappling.
//   - Sneak Attack: the other enemy of the target must not be incapacitated.
//   - Knocking a creature out: a melee attacker that drops a creature to 0
//     may knock it out instead; it falls unconscious and is out of the fight.
//   - Advantage comes from circumstances; a claimed one needs a circumstance
//     the engine does not already decide.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-pc-attack-features");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const maps = await import("../src/lib/db/battle-maps.ts");

const monk = world.addHero({
  class: "monk", level: 5, abilities: { str: 10, dex: 16, wis: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Quarterstaff", qty: 1 }, { name: "Longbow", qty: 1 }],
});
const barbarian = world.addHero({
  class: "barbarian", subclass: "Path of the Berserker", level: 3, abilities: { str: 16, dex: 12 },
  proficiencies: TRAINED, equipment: [{ name: "Greataxe", qty: 1 }, { name: "Handaxe", qty: 2 }],
});
const fighter = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }],
});
const cleric = world.addHero({
  class: "cleric", subclass: "Life Domain", level: 8, abilities: { str: 14, wis: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Mace", qty: 1 }],
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
});
const ranger = world.addHero({
  class: "ranger", subclass: "Hunter", level: 3, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const rogue = world.addHero({
  class: "rogue", level: 5, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Shortsword", qty: 1 }],
});
const wizard = world.addHero({
  class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
});
const heroes = [monk, barbarian, fighter, cleric, ranger, rogue, wizard];
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

// The named hero at the pointer, toe to toe with the first dummy.
async function stage(hero, { count = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { features: made.features, equipment: made.equipment, resources: made.resources, feats: made.feats });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2]));
  await kit.fight(count, { heroFaces });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  kit.place(hero.id, 5, 5);
  kit.place(enemies[0].id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemies;
}

const dieCount = (roll, sides) =>
  (roll?.breakdown?.terms ?? []).filter((term) => term.sides === sides).reduce((sum, term) => sum + term.count, 0);
const hasCondition = (conditions, name) => conditions.some((entry) => entry.toLowerCase() === name);
const kiUsed = (id) => {
  const resources = world.sheet(id).resources ?? {};
  const entry = Object.entries(resources).find(([key]) => key.toLowerCase().includes("ki"));
  return entry ? entry[1].used : null;
};

// ---- Martial Arts ----

await test("A monk's Martial Arts lets a monk weapon (a quarterstaff) use DEX and the Martial Arts die, not only an unarmed strike.", async () => {
  const [enemy] = await stage(monk);
  const swing = await kit.swing(monk.id, enemy.id, [10, 4], { weapon: "Quarterstaff" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.total, 10 + abilityMod(16) + proficiencyBonus(5));
  assert.equal(swing.damage.total, 4 + abilityMod(16));
});

await test("After taking the Attack action with an unarmed strike or a monk weapon, a monk makes one unarmed strike as a bonus action; nobody else can.", async () => {
  const [enemy] = await stage(monk);
  const early = await kit.swing(monk.id, enemy.id, [10, 3], { weapon: "unarmed strike", bonusAttack: "martial arts" });
  assert.equal(early.ok, false, "the bonus strike came before the Attack action");
  assert.equal((await kit.swing(monk.id, enemy.id, [10, 3], { weapon: "Quarterstaff" })).ok, true);
  const bonus = await kit.swing(monk.id, enemy.id, [10, 3], { weapon: "unarmed strike", bonusAttack: "martial arts" });
  assert.equal(bonus.ok, true, bonus.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  assert.equal(world.encounter().turnBudget.attacksMade, 1, "the bonus strike used an attack of the Attack action");
  const [other] = await stage(fighter);
  assert.equal((await kit.swing(fighter.id, other.id, [10, 3])).ok, true);
  const refused = await kit.swing(fighter.id, other.id, [10, 3], { weapon: "unarmed strike", bonusAttack: "martial arts" });
  assert.equal(refused.ok, false);
});

await test("Martial Arts works only while the monk wears no armor and carries no shield.", async () => {
  const [enemy] = await stage(monk);
  world.patch(monk.id, { equipment: [...base.get(monk.id).equipment, { name: "Chain Shirt", qty: 1, equipped: true }] });
  const swing = await kit.swing(monk.id, enemy.id, [10, 1], { weapon: "unarmed strike" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.total, 10 + abilityMod(10) + proficiencyBonus(5));
  assert.equal(swing.damage.total, 1 + abilityMod(10));
});

// ---- Stunning Strike ----

await test("Stunning Strike spends 1 ki on a melee weapon hit and stuns a creature that fails a CON save against the ki DC; a miss spends nothing.", async () => {
  const [enemy] = await stage(monk);
  const before = kiUsed(monk.id);
  const miss = await kit.swing(monk.id, enemy.id, [2], { weapon: "unarmed strike", stunningStrike: true });
  assert.equal(miss.ok, true, miss.error);
  assert.equal(miss.result.hit, false);
  assert.equal(kiUsed(monk.id), before, "a miss spent ki");
  // Hit, damage die, then the dummy's CON save (+1) on a 1: 2 against DC 8+3+2.
  const hit = await kit.swing(monk.id, enemy.id, [15, 3, 1], { weapon: "unarmed strike", stunningStrike: true });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(hit.unused, 0);
  assert.equal(kiUsed(monk.id), before + 1);
  assert.equal(hasCondition(kit.enemy(enemy.id).conditions, "stunned"), true);
  const [other] = await stage(fighter);
  const refused = await kit.swing(fighter.id, other.id, [15, 3, 1], { stunningStrike: true });
  assert.equal(refused.ok, false);
});

// ---- Reckless Attack ----

await test("Reckless Attack gives the barbarian advantage on STR melee weapon attacks this turn; a fighter has no such option.", async () => {
  const [enemy] = await stage(barbarian);
  const swing = await kit.swing(barbarian.id, enemy.id, [3, 15, 4], { weapon: "Greataxe", reckless: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2);
  assert.equal(hasCondition(world.sheet(barbarian.id).conditions, "reckless"), true);
  const [other] = await stage(fighter);
  assert.equal((await kit.swing(fighter.id, other.id, [15, 4], { reckless: true })).ok, false);
});

await test("After Reckless Attack, attack rolls against the barbarian have advantage until their next turn.", async () => {
  const [enemy] = await stage(barbarian);
  assert.equal((await kit.swing(barbarian.id, enemy.id, [3, 15, 4], { weapon: "Greataxe", reckless: true })).ok, true);
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  world.clearDice();
  world.dice(5, 5, 1);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: barbarian.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.lastRolls(60).find((roll) => roll.kind === "attack" && !before.has(roll.id)).advantage, "advantage");
});

// ---- Frenzy ----

await test("A raging Berserker in a frenzy makes one melee weapon attack as a bonus action; without rage, or without Frenzy, it is refused.", async () => {
  const [enemy] = await stage(barbarian);
  assert.equal((await kit.swing(barbarian.id, enemy.id, [15, 4], { weapon: "Greataxe" })).ok, true);
  const calm = await kit.swing(barbarian.id, enemy.id, [15, 4], { weapon: "Greataxe", bonusAttack: "frenzy" });
  assert.equal(calm.ok, false, "a frenzy without a rage");
  world.patch(barbarian.id, { conditions: ["raging"] });
  const wild = await kit.swing(barbarian.id, enemy.id, [15, 4], { weapon: "Greataxe", bonusAttack: "frenzy" });
  assert.equal(wild.ok, true, wild.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  assert.equal(hasCondition(world.sheet(barbarian.id).conditions, "frenzied"), true);
  // The rage ends; the frenzy costs one level of exhaustion when the fight is over.
  world.patch(barbarian.id, { conditions: ["frenzied"] });
  await world.invoke("end_encounter", { outcome: "truce" });
  assert.equal(world.sheet(barbarian.id).exhaustion, 1);
  assert.equal(hasCondition(world.sheet(barbarian.id).conditions, "frenzied"), false);
  world.patch(barbarian.id, { conditions: [], exhaustion: 0 });
});

// ---- Divine Strike ----

await test("A Life cleric's Divine Strike deals radiant damage, so a creature resisting the mace's bludgeoning takes the 1d8 in full.", async () => {
  const [enemy] = await stage(cleric);
  kit.setEnemy(enemy.id, { stats: { resist: "bludgeoning" } });
  const swing = await kit.swing(cleric.id, enemy.id, [15, 4, 5], { weapon: "Mace" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.unused, 0);
  // Mace 4 + STR 2 = 6 bludgeoning, halved to 3; 5 radiant.
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 3 - 5);
});

// ---- Bardic Inspiration ----

await test("A held Bardic Inspiration die is added to the holder's attack roll and spent by it.", async () => {
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { conditions: ["bardic inspiration (d8)"] });
  const swing = await kit.swing(fighter.id, enemy.id, [10, 6, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(dieCount(swing.toHit, 8), 1);
  assert.equal(swing.toHit.total, 10 + 6 + abilityMod(16) + proficiencyBonus(5));
  assert.equal(world.sheet(fighter.id).conditions.length, 0);
});

// ---- Hunter's Prey ----

await test("Colossus Slayer adds 1d8 once per turn to a weapon hit on a creature below its hit point maximum.", async () => {
  const [enemy] = await stage(ranger);
  world.patch(ranger.id, { features: [...base.get(ranger.id).features, { name: "Hunter's Prey: Colossus Slayer", source: "choice" }] });
  const fresh = await kit.swing(ranger.id, enemy.id, [15, 4, 4], { weapon: "Longsword" });
  assert.equal(dieCount(fresh.damage, 8), 1, "a creature at full health");
  kit.freshTurn();
  const wounded = await kit.swing(ranger.id, enemy.id, [15, 4, 4], { weapon: "Longsword" });
  assert.equal(wounded.unused, 0);
  assert.equal(dieCount(wounded.damage, 8), 2);
});

await test("A Hunter ranger at 3rd level has one Hunter's Prey pick to make, and a Hunter's Prey feature finds its pick", async () => {
  const { optionSlotsFor, findOptionByFeatureName } = await import("../src/lib/srd/options.ts");
  assert.equal(optionSlotsFor("ranger", "Hunter", 3, "hunters_prey"), 1);
  assert.equal(optionSlotsFor("ranger", "Hunter", 2, "hunters_prey"), 0);
  assert.equal(optionSlotsFor("fighter", "Champion", 3, "hunters_prey"), 0);
  assert.equal(findOptionByFeatureName("Hunter's Prey: Colossus Slayer")?.n, "Colossus Slayer");
});

await test("Horde Breaker: once a turn, an extra weapon attack on a different creature within 5 feet of one already attacked, using no attack of the action.", async () => {
  const [a, b] = await stage(ranger, { count: 2 });
  kit.place(b.id, 6, 6);
  world.patch(ranger.id, { features: [...base.get(ranger.id).features, { name: "Hunter's Prey: Horde Breaker", source: "choice" }] });
  const early = await kit.swing(ranger.id, b.id, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(early.ok, false, "Horde Breaker came before any attack");
  assert.equal((await kit.swing(ranger.id, a.id, [15, 4], { weapon: "Longsword" })).ok, true);
  const same = await kit.swing(ranger.id, a.id, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(same.ok, false, "Horde Breaker struck the same creature");
  const extra = await kit.swing(ranger.id, b.id, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(extra.ok, true, extra.error);
  assert.equal(world.encounter().turnBudget.attacksMade, 1);
  const again = await kit.swing(ranger.id, b.id, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(again.ok, false, "a second Horde Breaker attack in one turn");
});

// ---- crit range and Ki-Empowered Strikes ----

await test("Improved Critical widens the critical range of weapon attacks only; a spell attack on a 19 is no critical hit.", async () => {
  const [enemy] = await stage(wizard);
  world.patch(wizard.id, { features: [...base.get(wizard.id).features, { name: "Improved Critical", source: "story" }] });
  kit.place(enemy.id, 5, 9);
  const bolt = await kit.swing(wizard.id, enemy.id, [19, 5, 5, 5, 5], { spell: "Fire Bolt", damage: "2d10" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(bolt.result.hit, true);
  assert.notEqual(bolt.result.crit, true);
});

await test("Ki-Empowered Strikes make a monk's unarmed strikes magical, not a nonmagical longbow.", async () => {
  const [enemy] = await stage(monk);
  world.patch(monk.id, { features: [...base.get(monk.id).features, { name: "Ki-Empowered Strikes", source: "class" }] });
  kit.setEnemy(enemy.id, { stats: { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } });
  kit.place(enemy.id, 5, 9);
  const bow = await kit.swing(monk.id, enemy.id, [15, 6], { weapon: "Longbow" });
  assert.equal(bow.ok, true, bow.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - Math.floor((6 + abilityMod(16)) / 2));
});

// ---- Grappler ----

await test("The Grappler feat gives advantage on attacks against a creature its holder is grappling.", async () => {
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { feats: ["Grappler"] });
  kit.setEnemy(enemy.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: fighter.id } } });
  const swing = await kit.swing(fighter.id, enemy.id, [3, 15, 4], { weapon: "Longsword" });
  assert.equal(d20Faces(swing.toHit).length, 2);
});

// ---- Sneak Attack's ally ----

await test("Sneak Attack's ally next to the target must not be incapacitated; an ally at 0 hit points does not count.", async () => {
  const [enemy] = await stage(rogue);
  kit.place(fighter.id, 5, 7);
  world.patch(fighter.id, { currentHp: 0, conditions: ["unconscious", "prone"] });
  const swing = await kit.swing(rogue.id, enemy.id, [15, 4, 1, 1, 1], { weapon: "Shortsword" });
  world.patch(fighter.id, { currentHp: world.sheet(fighter.id).maxHp, conditions: [] });
  assert.equal(swing.unused, 3);
});

// ---- knocking out ----

await test("A melee attack declared nonlethal that drops a creature to 0 knocks it out: unconscious, still on the board, and out of the fight.", async () => {
  const [enemy] = await stage(fighter);
  kit.setEnemy(enemy.id, { currentHp: 3 });
  const board = kit.map();
  const swing = await kit.swing(fighter.id, enemy.id, [15, 6], { weapon: "Longsword", nonlethal: true });
  assert.equal(swing.ok, true, swing.error);
  const after = encounters.getEnemy(enemy.id);
  assert.equal(after.status, "alive");
  assert.equal(after.currentHp, 0);
  assert.equal(hasCondition(after.conditions, "unconscious"), true);
  assert.notEqual(maps.getTokenByRef(board.id, enemy.id), null, "the token left the board");
  assert.equal(world.encounter(), null, "the fight did not end with its last foe knocked out");
  const [far] = await stage(fighter);
  kit.place(far.id, 5, 9);
  assert.equal((await kit.swing(fighter.id, far.id, [15, 6], { weapon: "Longbow", nonlethal: true })).ok, false);
});

// ---- the AI's situational advantage ----

async function aiSwing(characterId, enemyId, faces, args) {
  const turn = createDmTurn(world.campaignId, [], "ai");
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  world.clearDice();
  world.dice(...faces);
  const out = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, {
    name: "pc_attack",
    args: { characterId, targetEnemyId: enemyId, ...args },
  });
  world.clearDice();
  return { out, roll: kit.lastRolls(60).find((roll) => roll.kind === "attack" && !before.has(roll.id)) };
}

await test("The AI's advantage on a player's attack needs a named circumstance the engine does not already decide; a bare or already-decided claim is dropped.", async () => {
  const [enemy] = await stage(fighter);
  const bare = await aiSwing(fighter.id, enemy.id, [15, 4, 4], { weapon: "Longsword", advantage: "advantage" });
  assert.equal(bare.out.ok, true, bare.out.error);
  assert.equal(bare.roll.advantage, "none");
  kit.freshTurn();
  const claimed = await aiSwing(fighter.id, enemy.id, [15, 4, 4], { weapon: "Longsword", advantage: "advantage", advantageReason: "the goblin is prone" });
  assert.equal(claimed.roll.advantage, "none", "prone is the engine's to decide");
  kit.freshTurn();
  const ruled = await aiSwing(fighter.id, enemy.id, [15, 4, 4], { weapon: "Longsword", advantage: "advantage", advantageReason: "the goblin slips on the wet deck" });
  assert.equal(ruled.roll.advantage, "advantage");
});

await test("the human DM's advantage still stands as a ruling", async () => {
  const [enemy] = await stage(fighter);
  const swing = await kit.swing(fighter.id, enemy.id, [3, 15, 4], { weapon: "Longsword", advantage: "advantage" });
  assert.equal(swing.toHit.advantage, "advantage");
});

await kit.endFight();
world.close();
finish();
