// Spells on a character's attack, resolved by pc_attack (src/lib/dm/pc-attack*.ts),
// every die forced: a melee spell attack is a melee attack, the spell's own
// damage type, Hunter's Mark and Hex marking one creature, the weapon-only
// riders, Invisibility ending when its holder attacks or casts, Guiding Bolt,
// Spiritual Weapon cast from a higher slot, Branding Smite on the next hit,
// and the riders the attack cantrips carry.
//
// The rules, from SRD 5.1:
//   - Shocking Grasp, Inflict Wounds, Vampiric Touch: "make a melee spell
//     attack". A melee attack has no ranged-in-melee disadvantage, has
//     advantage on a prone target within 5 feet, and a touch reaches only the
//     creature beside the caster.
//   - A spell deals its own damage type.
//   - Hunter's Mark: +1d6 on weapon hits against the marked creature. Hex:
//     +1d6 necrotic on hits against the hexed creature. Divine Favor, Enlarge:
//     weapon attacks only.
//   - Invisibility: ends if the target attacks or casts a spell.
//   - Guiding Bolt: the next attack roll against the target before the end of
//     the caster's next turn has advantage.
//   - Spiritual Weapon: 1d8 + 1d8 for every two slot levels above 2nd.
//   - Branding Smite: the next time the caster hits with a weapon attack,
//     +2d6 radiant.
//   - Shocking Grasp: no reactions until the target's next turn. Ray of
//     Frost: -10 ft speed. Vampiric Touch: the caster regains half the
//     necrotic damage dealt. Acid Arrow: half damage on a miss.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";
import { slotsOf, FULL_CASTER_SLOTS, HALF_CASTER_SLOTS } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-pc-attack-spells");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");

const wizard = world.addHero({
  class: "wizard", level: 5, abilities: { int: 16, con: 14 }, proficiencies: TRAINED,
  spellcasting: {
    ability: "int", slots: slotsOf(FULL_CASTER_SLOTS[4]), known: [],
    prepared: ["Invisibility", "Mage Armor", "Vampiric Touch", "Melf's Acid Arrow", "Acid Arrow"],
    cantrips: ["Shocking Grasp", "Fire Bolt", "Ray of Frost", "Chill Touch"],
  },
});
const cleric = world.addHero({
  class: "cleric", level: 7, abilities: { wis: 16, str: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Mace", qty: 1 }],
  spellcasting: {
    ability: "wis", slots: slotsOf(FULL_CASTER_SLOTS[6]), known: [],
    prepared: ["Guiding Bolt", "Inflict Wounds", "Spiritual Weapon"], cantrips: [],
  },
});
const ranger = world.addHero({
  class: "ranger", level: 5, abilities: { dex: 16, str: 14, wis: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }],
  spellcasting: { ability: "wis", slots: slotsOf(HALF_CASTER_SLOTS[4]), known: ["Hunter's Mark"], prepared: [], cantrips: [] },
});
const paladin = world.addHero({
  class: "paladin", level: 5, abilities: { str: 16, cha: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  spellcasting: { ability: "cha", slots: slotsOf(HALF_CASTER_SLOTS[4]), known: [], prepared: ["Branding Smite", "Divine Favor"], cantrips: [] },
});
const fighter = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const heroes = [wizard, cleric, ranger, paladin, fighter];
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

// The named hero at the pointer, toe to toe with the first dummy.
async function stage(hero, { count = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { spellcasting: made.spellcasting, conditions: [], conditionMeta: {}, concentratingOn: null });
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
const holds = (conditions, pattern) => conditions.some((entry) => pattern.test(entry));

// ---- melee spell attacks ----

await test("A touch spell attack is a melee attack: no ranged-in-melee disadvantage beside a second foe, and advantage on a prone target within 5 feet.", async () => {
  const [a, b] = await stage(wizard, { count: 2 });
  kit.place(b.id, 4, 5);
  const grasp = await kit.swing(wizard.id, a.id, [15, 3, 3], { spell: "Shocking Grasp", damage: "2d8" });
  assert.equal(grasp.ok, true, grasp.error);
  assert.equal(d20Faces(grasp.toHit).length, 1);
  kit.freshTurn();
  kit.setEnemy(a.id, { conditions: ["prone"] });
  const prone = await kit.swing(wizard.id, a.id, [3, 15, 3, 3], { spell: "Shocking Grasp", damage: "2d8" });
  assert.equal(d20Faces(prone.toHit).length, 2);
});

await test("A touch spell attack reaches only a creature beside the caster.", async () => {
  const [enemy] = await stage(wizard);
  kit.place(enemy.id, 5, 9);
  const far = await kit.swing(wizard.id, enemy.id, [15, 3, 3], { spell: "Shocking Grasp", damage: "2d8" });
  assert.equal(far.ok, false);
});

// ---- the spell's damage type ----

if (world.hasPack) {
  await test("A known attack spell deals its own damage type, whatever type the caller names.", async () => {
    const [enemy] = await stage(wizard);
    kit.place(enemy.id, 5, 9);
    kit.setEnemy(enemy.id, { stats: { immune: "fire" } });
    const bolt = await kit.swing(wizard.id, enemy.id, [15, 6, 6], { spell: "Fire Bolt", damage: "2d10", damageType: "cold" });
    assert.equal(bolt.ok, true, bolt.error);
    assert.equal(kit.enemy(enemy.id).currentHp, 400);
  });
}

// ---- marks and weapon-only riders ----

await test("Hunter's Mark adds its 1d6 only to weapon hits on the marked creature.", async () => {
  const [a, b] = await stage(ranger, { count: 2 });
  kit.place(b.id, 6, 6);
  const cast = await world.invoke("cast_buff", { characterId: ranger.id, spell: "Hunter's Mark", targetEnemyId: a.id });
  assert.equal(cast.ok, true, cast.error);
  const marked = await kit.swing(ranger.id, a.id, [15, 4, 4], { weapon: "Longsword" });
  assert.equal(dieCount(marked.damage, 6), 1, "the marked creature");
  const other = await kit.swing(ranger.id, b.id, [15, 4, 4], { weapon: "Longsword" });
  assert.equal(other.unused, 1, "a creature not marked took the mark's die");
  assert.equal(dieCount(other.damage, 6), 0);
});

await test("Divine Favor's 1d4 rides weapon attacks only, never a spell attack.", async () => {
  const [enemy] = await stage(wizard);
  kit.place(enemy.id, 5, 9);
  world.patch(wizard.id, { conditions: ["divine favor"] });
  const bolt = await kit.swing(wizard.id, enemy.id, [15, 5, 5, 3], { spell: "Fire Bolt", damage: "2d10" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(dieCount(bolt.damage, 4), 0);
});

// ---- Invisibility ----

await test("Invisibility ends when its holder attacks: the first attack has advantage, the next does not.", async () => {
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { conditions: ["invisible"], conditionMeta: { invisible: { rounds: 600, spell: "Invisibility", source: wizard.id } } });
  const first = await kit.swing(fighter.id, enemy.id, [3, 15, 4], { weapon: "Longsword" });
  assert.equal(d20Faces(first.toHit).length, 2);
  assert.equal(holds(world.sheet(fighter.id).conditions, /^invisible$/i), false);
  const second = await kit.swing(fighter.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(d20Faces(second.toHit).length, 1);
});

await test("Invisibility ends when its holder casts a spell.", async () => {
  await stage(wizard);
  world.patch(wizard.id, { conditions: ["invisible"], conditionMeta: { invisible: { rounds: 600, spell: "Invisibility", source: wizard.id } } });
  const armor = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Mage Armor" });
  assert.equal(armor.ok, true, armor.error);
  assert.equal(holds(world.sheet(wizard.id).conditions, /^invisible$/i), false);
});

await test("Greater Invisibility lasts through the holder's attacks", async () => {
  const [enemy] = await stage(fighter);
  world.patch(fighter.id, { conditions: ["invisible"], conditionMeta: { invisible: { rounds: 10, spell: "Greater Invisibility", source: wizard.id } } });
  await kit.swing(fighter.id, enemy.id, [3, 15, 4], { weapon: "Longsword" });
  assert.equal(holds(world.sheet(fighter.id).conditions, /^invisible$/i), true);
});

// ---- Guiding Bolt ----

await test("A Guiding Bolt hit gives the next attack roll against the target advantage, and that attack spends it.", async () => {
  const [enemy] = await stage(cleric);
  kit.place(enemy.id, 5, 9);
  const bolt = await kit.swing(cleric.id, enemy.id, [15, 1, 1, 1, 1], { spell: "Guiding Bolt", damage: "4d6" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(bolt.result.hit, true);
  kit.giveTurn(fighter.id);
  kit.place(fighter.id, 5, 8);
  const swing = await kit.swing(fighter.id, enemy.id, [3, 15, 4], { weapon: "Longsword" });
  assert.equal(d20Faces(swing.toHit).length, 2);
  assert.equal(holds(kit.enemy(enemy.id).conditions, /guiding bolt/i), false);
});

// ---- Spiritual Weapon ----

await test("Spiritual Weapon cast from a 4th level slot strikes for 2d8.", async () => {
  const [enemy] = await stage(cleric);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", level: 4 });
  assert.equal(cast.ok, true, cast.error);
  kit.freshTurn();
  const swing = await kit.swing(cleric.id, enemy.id, [15, 3, 3], { weapon: "Spiritual Weapon" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(dieCount(swing.damage, 8), 2);
});

// ---- Branding Smite ----

await test("Branding Smite adds 2d6 radiant to the next weapon hit and is spent by it; a miss keeps it.", async () => {
  const [enemy] = await stage(paladin);
  const cast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Branding Smite" });
  assert.equal(cast.ok, true, cast.error);
  kit.freshTurn();
  const miss = await kit.swing(paladin.id, enemy.id, [2], { weapon: "Longsword" });
  assert.equal(miss.result.hit, false);
  assert.equal(holds(world.sheet(paladin.id).conditions, /branding smite/i), true, "a miss spent the smite");
  kit.freshTurn();
  const hit = await kit.swing(paladin.id, enemy.id, [15, 4, 3, 3], { weapon: "Longsword" });
  assert.equal(dieCount(hit.damage, 6), 2);
  assert.equal(holds(world.sheet(paladin.id).conditions, /branding smite/i), false);
});

// ---- cantrip riders ----

await test("A creature hit by Shocking Grasp takes no reaction until its next turn: walking away from it provokes nothing.", async () => {
  const [enemy] = await stage(wizard);
  const grasp = await kit.swing(wizard.id, enemy.id, [15, 3, 3], { spell: "Shocking Grasp", damage: "2d8" });
  assert.equal(grasp.result.hit, true);
  world.clearDice();
  world.dice(20, 6);
  const out = resolveOpportunityAttacks(world.campaign(), wizard.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  assert.equal(out.notes.length, 0, out.notes.join(" "));
});

await test("A creature hit by Ray of Frost loses 10 feet of speed until the caster's next turn.", async () => {
  const [enemy] = await stage(wizard);
  kit.place(enemy.id, 5, 9);
  const ray = await kit.swing(wizard.id, enemy.id, [15, 3, 3], { spell: "Ray of Frost", damage: "2d8" });
  assert.equal(ray.result.hit, true);
  const { conditionSpeed } = await import("../src/lib/srd/condition-effects.ts");
  assert.equal(conditionSpeed(kit.enemy(enemy.id).conditions, 30), 20);
});

await test("Vampiric Touch heals its caster half the necrotic damage it deals.", async () => {
  const [enemy] = await stage(wizard);
  world.patch(wizard.id, { currentHp: 10 });
  const touch = await kit.swing(wizard.id, enemy.id, [15, 4, 4, 4], { spell: "Vampiric Touch", damage: "3d6", level: 3 });
  assert.equal(touch.ok, true, touch.error);
  assert.equal(world.sheet(wizard.id).currentHp, 10 + 6);
});

await kit.endFight();
world.close();
finish();
