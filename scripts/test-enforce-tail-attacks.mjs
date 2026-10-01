// What still rode a player's attack by narration after the first two waves:
// Inspiration spent on an attack, a magic weapon's natural-20 dice on the
// physical dice path and its typed dice on an opportunity attack, a vial of
// basic poison, Shillelagh, and the class features that change an attack
// (Feral Senses, Foe Slayer, Stroke of Luck, Giant Killer, the Hunter's
// Uncanny Dodge, Open Hand Technique, Hurl Through Hell). Every die forced.
//
// The rules, from SRD 5.1:
//   - Inspiration: spent for advantage on one attack roll, saving throw or
//     ability check.
//   - A magic weapon's natural-20 dice (Vicious Weapon) ride that hit's
//     damage whoever rolls the d20; a Flame Tongue's 2d6 is fire damage.
//   - Basic poison: coats one slashing or piercing weapon (an action); a
//     creature hit makes a DC 10 CON save or takes 1d4 poison damage.
//   - Shillelagh: a club or quarterstaff uses the spellcasting ability for
//     attack and damage, deals a d8, and is magical.
//   - Feral Senses (ranger 18): attacking a creature you can't see has no
//     disadvantage for it.
//   - Foe Slayer (ranger 20): once a turn, add WIS to the attack roll or the
//     damage of an attack against a favored enemy.
//   - Stroke of Luck (rogue 20): a missed attack hits instead; once a short
//     rest.
//   - Giant Killer (Hunter's Prey): when a Large or larger creature within 5
//     feet hits or misses the ranger, the reaction attacks it at once.
//   - Superior Hunter's Defense: Uncanny Dodge halves an attack's damage.
//   - Open Hand Technique: a Flurry of Blows hit can knock the target prone
//     (DEX save), push it 15 feet (STR save), or take its reactions until the
//     end of the monk's next turn.
//   - Hurl Through Hell (Fiend 14): a hit banishes the creature until the end
//     of the warlock's next turn; it returns and, unless a fiend, takes 10d10
//     psychic damage. Once a long rest.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-tail-attacks");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");

const fighter = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const druid = world.addHero({
  class: "druid", level: 5, abilities: { str: 8, wis: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Club", qty: 1 }],
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, known: [], prepared: [], cantrips: ["Shillelagh"] },
});
const ranger = world.addHero({
  class: "ranger", subclass: "Hunter", level: 20, abilities: { str: 16, wis: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  features: [
    { name: "Feral Senses", description: "" }, { name: "Foe Slayer", description: "" },
    { name: "Favored Enemy: humanoids", description: "" },
  ],
});
const hunter = world.addHero({
  class: "ranger", subclass: "Hunter", level: 15, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  features: [
    { name: "Hunter's Prey: Giant Killer", description: "" },
    { name: "Superior Hunter's Defense: Uncanny Dodge", description: "" },
  ],
});
const rogue = world.addHero({
  class: "rogue", level: 20, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Rapier", qty: 1 }],
  features: [{ name: "Stroke of Luck", description: "" }],
});
const monk = world.addHero({
  class: "monk", subclass: "Way of the Open Hand", level: 5, abilities: { dex: 16, wis: 14 }, proficiencies: TRAINED,
  features: [{ name: "Open Hand Technique", description: "" }],
});
const warlock = world.addHero({
  class: "warlock", subclass: "The Fiend", level: 14, abilities: { str: 14, cha: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Mace", qty: 1 }],
  features: [{ name: "Hurl Through Hell", description: "" }],
});
const heroes = [fighter, druid, ranger, hunter, rogue, monk, warlock];
// A sheet is created with its class's own feature list; the picks and the
// favored enemy a player records are added after, as the builder does.
for (const [hero, names] of [
  [ranger, ["Feral Senses", "Foe Slayer", "Favored Enemy: humanoids"]],
  [hunter, ["Hunter's Prey: Giant Killer", "Superior Hunter's Defense: Uncanny Dodge"]],
  [rogue, ["Stroke of Luck"]],
  [monk, ["Open Hand Technique"]],
  [warlock, ["Hurl Through Hell"]],
]) {
  const held = world.sheet(hero.id).features;
  const added = names.filter((name) => !held.some((feature) => feature.name === name));
  world.patch(hero.id, { features: [...held, ...added.map((name) => ({ name, description: "" }))] });
}
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

// The named hero at the pointer, toe to toe with a dummy that will not die.
async function stage(hero, { count = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { equipment: made.equipment, conditions: [], conditionMeta: {}, resources: made.resources });
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

const has = (conditions, name) => conditions.map((entry) => entry.toLowerCase()).includes(name);
const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;
const setUses = (hero, id, max = 1) =>
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, [id]: { max, used: 0 } } });

// ---- Inspiration ----

await test("Inspiration spent on an attack gives the attack roll advantage and is used up.", async () => {
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { resources: { ...world.sheet(fighter.id).resources, inspiration: { max: 1, used: 0 } } });
  const swing = await kit.swing(fighter.id, enemy.id, [3, 15, 4], { useInspiration: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, "the attack roll had no advantage");
  assert.equal(swing.result.hit, true);
  assert.equal(used(fighter, "inspiration"), 1, "Inspiration was not spent");
  kit.freshTurn();
  const again = await kit.swing(fighter.id, enemy.id, [15, 4], { useInspiration: true });
  assert.equal(again.ok, false, "a second spend with no Inspiration held went through");
});

// ---- magic weapons ----

await test("With the player's own dice, a Vicious Weapon's natural 20 still adds its 2d6 (doubled by the critical) to the damage roll.", async () => {
  const { handlePcAttack, resolvePendingPcAttack, PC_ATTACK_PARKED } = await import("../src/lib/dm/pc-attack.ts");
  const { createDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
  const { insertRoll } = await import("../src/lib/db/rolls.ts");
  const { rollExpression } = await import("../src/lib/dice.ts");
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { equipment: [{ name: "Vicious Longsword", qty: 1 }] });
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  const sheets = world.sheets();
  const seen = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
  const parked = handlePcAttack(
    world.campaign(), turn,
    JSON.stringify({ characterId: fighter.id, targetEnemyId: enemy.id, weapon: "Vicious Longsword" }),
    sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), new Set([world.sheet(fighter.id).userId]), null,
  );
  assert.equal(parked[PC_ATTACK_PARKED], true, JSON.stringify(parked));
  const pending = listOpenPendingRolls(world.campaignId).find((entry) => !seen.has(entry.id));
  world.clearDice();
  world.dice(20);
  const roll = insertRoll({
    campaignId: world.campaignId, characterId: fighter.id, requestedBy: "dm", kind: "attack",
    detail: pending.detail, result: rollExpression(pending.expression),
  });
  world.clearDice();
  resolvePendingPcAttack(pending, roll);
  const damage = listOpenPendingRolls(world.campaignId).find((entry) => !seen.has(entry.id) && entry.kind === "damage");
  assert.ok(damage, "no damage roll was parked");
  const d6 = [...damage.expression.matchAll(/(\d+)d6/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  assert.equal(d6, 4, `the natural 20's dice are missing: ${damage.expression}`);
});

await test("A Flame Tongue's 2d6 on an opportunity attack is fire damage: a creature immune to fire takes only the sword's slashing.", async () => {
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { equipment: [{ name: "Flame Tongue", qty: 1, attuned: true }] });
  kit.setEnemy(enemy.id, { stats: { immune: "fire" } });
  world.clearDice();
  world.dice(15, 4, 3, 3);
  resolvePcOpportunityAttacks(world.campaign(), enemy.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
  world.clearDice();
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + abilityMod(16)), "the fire dice landed on a fire-immune creature");
});

// ---- basic poison ----

await test("A vial of basic poison coats a slashing or piercing weapon; the next creature it hits makes a DC 10 CON save or takes 1d4 poison, and the coat is used.", async () => {
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { equipment: [{ name: "Longsword", qty: 1 }, { name: "Poison, basic (vial)", qty: 1 }] });
  const coat = await world.invoke("use_item", { characterId: fighter.id, item: "Poison, basic (vial)" });
  assert.equal(coat.ok, true, coat.error);
  assert.ok(has(world.sheet(fighter.id).conditions, "poisoned weapon"), "no coat on the weapon");
  kit.freshTurn();
  // Hit, the longsword's d8, the dummy's CON save on a 1 (+1 = 2), the poison's d4.
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4, 1, 3]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.unused, 0, "the poison's save and die were never rolled");
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + abilityMod(16)) - 3);
  assert.equal(has(world.sheet(fighter.id).conditions, "poisoned weapon"), false);
});

// ---- Shillelagh ----

await test("Under Shillelagh a club attacks with the spellcasting ability and deals a d8.", async () => {
  const [enemy] = await stage(druid);
  world.patch(druid.id, { conditions: ["shillelagh"], conditionMeta: { shillelagh: { rounds: 10, spell: "Shillelagh", source: druid.id } } });
  const swing = await kit.swing(druid.id, enemy.id, [10, 5], { weapon: "Club" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.rolled, 10 + abilityMod(16) + proficiencyBonus(5), "the club did not swing with WIS");
  assert.equal(swing.damage?.breakdown?.terms?.find((term) => term.sides)?.sides, 8);
  assert.equal(swing.result.damage, 5 + abilityMod(16));
});

// ---- ranger capstones ----

await test("Feral Senses: a ranger attacking an invisible creature rolls without disadvantage.", async () => {
  const [enemy] = await stage(ranger);
  kit.setEnemy(enemy.id, { conditions: ["invisible"] });
  const swing = await kit.swing(ranger.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 1, "the unseen target still cost disadvantage");
});

await test("Foe Slayer: once a turn, the ranger's WIS modifier is added to an attack roll against a favored enemy, turning a near miss into a hit.", async () => {
  const [enemy] = await stage(ranger);
  // +9 to hit (STR 3, proficiency 6): a 2 is 11 against AC 13, and +3 is 14.
  const near = await kit.swing(ranger.id, enemy.id, [2, 4]);
  assert.equal(near.ok, true, near.error);
  assert.equal(near.result.hit, true, "Foe Slayer did not turn the near miss into a hit");
  const again = await kit.swing(ranger.id, enemy.id, [2]);
  assert.equal(again.result.hit, false, "Foe Slayer rode a second attack in one turn");
});

await test("Blindsense: the rogue attacks a hidden or invisible creature within 10 feet at its square (ODM never makes anyone guess one), still at disadvantage, since knowing where is not seeing (SRD 5.1).", async () => {
  const [enemy] = await stage(rogue);
  kit.setEnemy(enemy.id, { conditions: ["invisible"] });
  const swing = await kit.swing(rogue.id, enemy.id, [15, 3, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2);
});

// ---- Stroke of Luck ----

await test("Stroke of Luck turns a missed attack into a hit, once a short rest; a hit spends nothing.", async () => {
  const [enemy] = await stage(rogue);
  setUses(rogue, "stroke_of_luck");
  const hit = await kit.swing(rogue.id, enemy.id, [15, 4], { strokeOfLuck: true });
  assert.equal(hit.result.hit, true);
  assert.equal(used(rogue, "stroke_of_luck"), 0, "a hit spent Stroke of Luck");
  kit.freshTurn();
  const miss = await kit.swing(rogue.id, enemy.id, [2, 4], { strokeOfLuck: true });
  assert.equal(miss.ok, true, miss.error);
  assert.equal(miss.result.hit, true, "the miss stayed a miss");
  assert.equal(used(rogue, "stroke_of_luck"), 1);
});

// ---- Hunter picks ----

async function largeSwingsAtHunter(enemy) {
  kit.setEnemy(enemy.id, { stats: { size: "Large" } });
  kit.giveTurn(fighter.id);
  kit.place(fighter.id, 9, 9);
  kit.freshRound();
  world.clearDice();
  world.dice(15, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hunter.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
}

await test("Giant Killer: a Large creature within 5 feet that attacked the Hunter is attacked back at once with the reaction.", async () => {
  const [enemy] = await stage(hunter);
  await largeSwingsAtHunter(enemy);
  const back = await kit.swing(hunter.id, enemy.id, [15, 4]);
  assert.equal(back.ok, true, back.error);
  assert.ok(world.encounter().reactionsUsed.includes(hunter.id));
});

await test("Superior Hunter's Defense: Uncanny Dodge halves the damage of the attack that hit the ranger.", async () => {
  const [enemy] = await stage(hunter);
  await largeSwingsAtHunter(enemy);
  const hurt = world.sheet(hunter.id).maxHp - world.sheet(hunter.id).currentHp;
  assert.ok(hurt > 0);
  const out = await world.invoke("use_reaction", { characterId: hunter.id, feature: "Uncanny Dodge" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hunter.id).maxHp - world.sheet(hunter.id).currentHp, Math.floor(hurt / 2));
});

// ---- Open Hand Technique ----

await test("Open Hand Technique: a Flurry of Blows hit knocks the target prone when it fails a DEX save against the ki DC.", async () => {
  const [enemy] = await stage(monk);
  world.patch(monk.id, { resources: { ...world.sheet(monk.id).resources, ki: { max: 5, used: 0 } } });
  assert.equal((await kit.swing(monk.id, enemy.id, [15, 3], { weapon: "unarmed strike" })).ok, true);
  assert.equal((await kit.swing(monk.id, enemy.id, [15, 3], { weapon: "unarmed strike" })).ok, true);
  const flurry = await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "flurry of blows" });
  assert.equal(flurry.ok, true, flurry.error);
  const strike = await kit.swing(monk.id, enemy.id, [15, 3, 1], { weapon: "unarmed strike", openHand: "prone" });
  assert.equal(strike.ok, true, strike.error);
  assert.ok(has(kit.enemy(enemy.id).conditions, "prone"), "the flurry hit did not knock it prone");
});

await test("Open Hand Technique rides only a Flurry of Blows strike, and only for an Open Hand monk.", async () => {
  const [enemy] = await stage(monk);
  const plain = await kit.swing(monk.id, enemy.id, [15, 3, 1], { weapon: "unarmed strike", openHand: "prone" });
  assert.equal(plain.ok, false, "an Attack action swing took Open Hand Technique");
  assert.equal(has(kit.enemy(enemy.id).conditions, "prone"), false);
  const [other] = await stage(fighter);
  const refused = await kit.swing(fighter.id, other.id, [15, 3], { openHand: "prone" });
  assert.equal(refused.ok, false);
});

await test("A declared Stroke of Luck with the use already spent is refused before the roll.", async () => {
  const [enemy] = await stage(rogue);
  world.patch(rogue.id, { resources: { ...world.sheet(rogue.id).resources, stroke_of_luck: { max: 1, used: 1 } } });
  const out = await kit.swing(rogue.id, enemy.id, [2, 4], { strokeOfLuck: true });
  assert.equal(out.ok, false);
  assert.equal(out.toHit, null, "a roll was made");
});

// ---- Hurl Through Hell ----

await test("Hurl Through Hell: the hit creature is gone until the end of the warlock's next turn, then returns and takes 10d10 psychic damage.", async () => {
  const [enemy] = await stage(warlock);
  setUses(warlock, "hurl_through_hell");
  const hit = await kit.swing(warlock.id, enemy.id, [15, 3], { weapon: "Mace", hurlThroughHell: true });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(used(warlock, "hurl_through_hell"), 1, "Hurl Through Hell was not spent");
  assert.ok(has(kit.enemy(enemy.id).conditions, "hurled through hell"));
  const hp = kit.enemy(enemy.id).currentHp;
  // End this turn, walk the order back to the warlock, then end their next
  // turn: 10d10 of 5s.
  assert.ok(kit.endTurn(world.sheet(warlock.id).userId));
  assert.ok(has(kit.enemy(enemy.id).conditions, "hurled through hell"), "it came back as the warlock's own turn ended");
  for (let step = 0; step < 12 && kit.current().characterId !== warlock.id; step += 1) {
    assert.ok(kit.endTurn(world.sheet(kit.current().characterId).userId));
  }
  assert.ok(has(kit.enemy(enemy.id).conditions, "hurled through hell"), "it came back before the warlock's next turn ended");
  world.clearDice();
  world.dice(new Array(10).fill(5));
  assert.ok(kit.endTurn(world.sheet(warlock.id).userId));
  world.clearDice();
  assert.equal(has(kit.enemy(enemy.id).conditions, "hurled through hell"), false, `still gone: ${JSON.stringify(kit.enemy(enemy.id).conditionMeta)}`);
  assert.equal(kit.enemy(enemy.id).currentHp, hp - 50, "no 10d10 psychic on the return");
});

await kit.endFight();
world.close();
finish();
