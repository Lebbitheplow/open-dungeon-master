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
//   - Spiritual Weapon: 1d8 + 1d8 for every two slot levels above 2nd. The
//     weapon appears within 60 feet; its strike is "against a creature
//     within 5 feet of the weapon", and a later bonus action moves it up to
//     20 feet first (issue 659).
//   - Globe of Invulnerability: a spell of 5th level or lower cast from
//     outside has no effect on a creature inside. Antilife Shell: a living
//     creature cannot reach through it with a melee attack.
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
// A 13th level wizard for Arcane Sword (7th level).
const mage = world.addHero({
  class: "wizard", level: 13, abilities: { int: 18, con: 14 }, proficiencies: TRAINED,
  // Its material: a miniature platinum sword worth 250 gp.
  equipment: [{ name: "Miniature platinum sword", qty: 1, worth: 250 }],
  spellcasting: { ability: "int", slots: slotsOf(FULL_CASTER_SLOTS[12]), known: [], prepared: ["Arcane Sword"], cantrips: [] },
});
const heroes = [wizard, cleric, ranger, paladin, fighter, mage];
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

// Issue 659: the weapon's strike is measured from the weapon, which appears
// within 60 feet of the cleric and moves up to 20 feet with each later
// strike. Measured from the cleric, a foe 30 feet off could not be struck.
const weaponZone = () => (kit.map()?.spellZones ?? []).filter((zone) => zone.spell === "Spiritual Weapon");
const tokenAt = (refId) => {
  const token = kit.token(refId);
  return { x: token.x, y: token.y };
};
// The cleric's next turn: a new round, the turn's spending forgotten, and a
// round of the weapon's minute gone.
function nextRound() {
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, round: encounter.round + 1, turnBudget: null });
  const sheet = world.sheet(cleric.id);
  const meta = { ...sheet.conditionMeta };
  if (meta["spiritual weapon"]) meta["spiritual weapon"] = { ...meta["spiritual weapon"], rounds: (meta["spiritual weapon"].rounds ?? 10) - 1 };
  world.patch(cleric.id, { conditionMeta: meta });
}

await test("Spiritual Weapon laid on a named square strikes a foe 30 feet from the cleric, and the cleric does not move.", async () => {
  const [enemy] = await stage(cleric);
  kit.place(enemy.id, 5, 12);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", atX: 5, atY: 11 });
  assert.equal(cast.ok, true, cast.error);
  assert.deepEqual(weaponZone().map((zone) => zone.origin), [{ x: 5, y: 11 }], "the weapon was not laid where it was named");
  const swing = await kit.swing(cleric.id, enemy.id, [15, 3], { weapon: "Spiritual Weapon" });
  assert.equal(swing.ok, true, swing.error);
  assert.deepEqual(tokenAt(cleric.id), { x: 5, y: 5 }, "the cleric walked");
});

await test("On a later turn the weapon flies up to 20 feet to the foe and strikes it.", async () => {
  const [enemy] = await stage(cleric);
  kit.place(enemy.id, 5, 12);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", atX: 5, atY: 11 });
  assert.equal(cast.ok, true, cast.error);
  nextRound();
  kit.place(enemy.id, 9, 11);
  const swing = await kit.swing(cleric.id, enemy.id, [15, 3], { weapon: "Spiritual Weapon" });
  assert.equal(swing.ok, true, swing.error);
  const [zone] = weaponZone();
  assert.ok(Math.max(Math.abs(zone.origin.x - 9), Math.abs(zone.origin.y - 11)) <= 1, "the weapon is not beside the foe");
  assert.ok(Math.max(Math.abs(zone.origin.x - 5), Math.abs(zone.origin.y - 11)) <= 4, "the weapon flew more than 20 feet");
  assert.deepEqual(tokenAt(cleric.id), { x: 5, y: 5 });
});

await test("A foe beside the cleric but beyond the weapon's move is out of its reach, and the bonus action is left unspent; approach never walks the cleric.", async () => {
  const [enemy] = await stage(cleric);
  kit.place(enemy.id, 9, 9);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", atX: 5, atY: 12 });
  assert.equal(cast.ok, true, cast.error);
  nextRound();
  kit.place(enemy.id, 5, 6);
  const swing = await kit.swing(cleric.id, enemy.id, [15, 3], { weapon: "Spiritual Weapon" });
  assert.equal(swing.ok, false);
  assert.equal(swing.out.refused, "rules", swing.error);
  assert.match(swing.error, /is at \(5,12\)/);
  assert.equal(world.encounter().turnBudget?.bonusUsed ?? false, false, "the refused strike spent the bonus action");
  const walked = await kit.swing(cleric.id, enemy.id, [15, 3], { weapon: "Spiritual Weapon", approach: true });
  assert.equal(walked.ok, false);
  assert.deepEqual(tokenAt(cleric.id), { x: 5, y: 5 }, "approach walked the cleric for the weapon");
});

await test("On the casting turn a weapon laid on a named square strikes only a creature within 5 feet of that square.", async () => {
  const [enemy] = await stage(cleric);
  kit.place(enemy.id, 9, 11);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", atX: 5, atY: 11 });
  assert.equal(cast.ok, true, cast.error);
  const swing = await kit.swing(cleric.id, enemy.id, [15, 3], { weapon: "Spiritual Weapon" });
  assert.equal(swing.ok, false);
  assert.equal(swing.out.refused, "rules");
  assert.match(swing.error, /square named when it was cast/);
});

await test("With no square named the weapon appears beside the nearest foe in range, and its first strike may set it down beside another.", async () => {
  const [a, b] = await stage(cleric, { count: 2 });
  kit.place(a.id, 5, 10);
  kit.place(b.id, 12, 5);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon" });
  assert.equal(cast.ok, true, cast.error);
  const [laid] = weaponZone();
  assert.ok(Math.max(Math.abs(laid.origin.x - 5), Math.abs(laid.origin.y - 10)) <= 1, "it was not laid beside the nearest foe");
  const swing = await kit.swing(cleric.id, b.id, [15, 3], { weapon: "Spiritual Weapon" });
  assert.equal(swing.ok, true, swing.error);
  const [moved] = weaponZone();
  assert.ok(Math.max(Math.abs(moved.origin.x - 12), Math.abs(moved.origin.y - 5)) <= 1, "the weapon did not appear beside the foe it struck");
});

await test("A weapon named beyond its 60 feet is refused before anything is spent.", async () => {
  await stage(cleric);
  const slots = JSON.stringify(world.sheet(cleric.id).spellcasting.slots);
  // 65 feet from the cleric at (5,5), along whichever side of the board is long enough.
  const map = kit.map();
  const far = map.width > map.height ? { atX: 18, atY: 5 } : { atX: 5, atY: 18 };
  assert.ok(Math.max(map.width, map.height) > 18, "the board is too small for this test");
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", ...far });
  assert.notEqual(cast.ok, true);
  assert.match(cast.error ?? "", /within 60 feet/);
  assert.equal(JSON.stringify(world.sheet(cleric.id).spellcasting.slots), slots, "a slot was spent");
});

await test("Recasting leaves one weapon on the board, and the weapon leaves it with its condition.", async () => {
  const [enemy] = await stage(cleric);
  kit.place(enemy.id, 5, 12);
  await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", atX: 5, atY: 11 });
  nextRound();
  const again = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", atX: 6, atY: 11 });
  assert.equal(again.ok, true, again.error);
  assert.equal(weaponZone().length, 1);
  world.patch(cleric.id, { conditions: [], conditionMeta: {} });
  const { liveZones } = await import("../src/lib/dm/zone-store.ts");
  assert.equal(liveZones(kit.map(), world.encounter()).filter((zone) => zone.spell === "Spiritual Weapon").length, 0, "the weapon outlived its condition");
});

await test("A wall between the cleric and the foe does not stop the weapon striking from the foe's side of it.", async () => {
  const [enemy] = await stage(cleric);
  kit.place(enemy.id, 5, 12);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", atX: 5, atY: 11 });
  assert.equal(cast.ok, true, cast.error);
  nextRound();
  kit.openField(Array.from({ length: 9 }, (_, x) => [x + 1, 8, "#"]));
  const swing = await kit.swing(cleric.id, enemy.id, [15, 3], { weapon: "Spiritual Weapon" });
  assert.equal(swing.ok, true, swing.error);
  assert.ok(!(swing.out.notes ?? []).some((note) => /cover/.test(note)), "the foe had cover from the weapon beside it");
});

await test("A strike from Spiritual Weapon on a creature inside a Globe of Invulnerability is cast and has no effect.", async () => {
  const [enemy] = await stage(cleric);
  kit.place(enemy.id, 5, 12);
  await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spiritual Weapon", atX: 5, atY: 11 });
  world.patch(wizard.id, { concentratingOn: "Globe of Invulnerability" });
  kit.place(wizard.id, 6, 13);
  const { saveZones } = await import("../src/lib/dm/zone-store.ts");
  const map = kit.map();
  const cells = [];
  for (let y = 11; y <= 15; y += 1) for (let x = 4; x <= 8; x += 1) if (!(x === 5 && y === 11)) cells.push(y * map.width + x);
  saveZones(map.id, [...map.spellZones, { id: "globe", spell: "Globe of Invulnerability", casterId: wizard.id, casterKind: "pc", casterName: "Wizard", origin: { x: 6, y: 13 }, cells, concentration: true, castRound: world.encounter().round, untilRound: null, slotLevel: 6, dc: null }]);
  const swing = await kit.swing(cleric.id, enemy.id, [15, 3], { weapon: "Spiritual Weapon" });
  assert.equal(swing.result.hit, false, JSON.stringify(swing.out));
  assert.match(swing.result.note ?? "", /Globe of Invulnerability/);
  world.patch(wizard.id, { concentratingOn: null });
});

await test("A character's sword cannot reach through an Antilife Shell to a creature inside it.", async () => {
  const [enemy] = await stage(fighter);
  kit.place(fighter.id, 5, 6);
  kit.place(enemy.id, 6, 6);
  kit.place(wizard.id, 8, 6);
  world.patch(wizard.id, { concentratingOn: "Antilife Shell" });
  const { saveZones } = await import("../src/lib/dm/zone-store.ts");
  const map = kit.map();
  saveZones(map.id, [...map.spellZones, { id: "shell", spell: "Antilife Shell", casterId: wizard.id, casterKind: "pc", casterName: "Wizard", origin: { x: 8, y: 6 }, cells: [], concentration: true, castRound: world.encounter().round, untilRound: null, slotLevel: 5, dc: null }]);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, false);
  assert.match(swing.error ?? "", /Antilife Shell/);
  world.patch(wizard.id, { concentratingOn: null });
});

// Arcane Sword (SRD 5.1): the sword hovers within 60 feet; "when the sword
// appears, you make a melee spell attack against a target of your choice
// within 5 feet of the sword"; a bonus action on each later turn moves it 20
// feet and repeats the attack. It was a ranged attack from the wizard, and
// every strike was a new casting with its 7th level slot.
await test("Arcane Sword's first strike comes with the casting, from the sword; a later strike moves it 20 feet for the bonus action and spends no slot.", async () => {
  const [enemy] = await stage(mage);
  kit.place(enemy.id, 5, 12);
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Arcane Sword", level: 7, atX: 5, atY: 11 });
  assert.equal(cast.ok, true, cast.error);
  const slots = JSON.stringify(world.sheet(mage.id).spellcasting.slots);
  const first = await kit.swing(mage.id, enemy.id, [15, 3, 3, 3], { weapon: "Arcane Sword" });
  assert.equal(first.ok, true, first.error);
  assert.equal(dieCount(first.damage, 10), 3, "the sword's 3d10");
  assert.equal(world.encounter().turnBudget?.bonusUsed ?? false, false, "the strike that comes with the casting spent the bonus action");
  assert.equal(JSON.stringify(world.sheet(mage.id).spellcasting.slots), slots, "the strike spent a slot");
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, round: encounter.round + 1, turnBudget: null });
  const meta = { ...world.sheet(mage.id).conditionMeta };
  meta["arcane sword"] = { ...meta["arcane sword"], rounds: 9 };
  world.patch(mage.id, { conditionMeta: meta });
  kit.place(enemy.id, 9, 11);
  const later = await kit.swing(mage.id, enemy.id, [15, 3, 3, 3], { weapon: "Arcane Sword" });
  assert.equal(later.ok, true, later.error);
  assert.equal(world.encounter().turnBudget?.bonusUsed, true, "the later strike is the bonus action");
  assert.equal(JSON.stringify(world.sheet(mage.id).spellcasting.slots), slots, "a later strike spent a slot");
  const [sword] = (kit.map()?.spellZones ?? []).filter((zone) => zone.spell === "Arcane Sword");
  assert.ok(Math.max(Math.abs(sword.origin.x - 9), Math.abs(sword.origin.y - 11)) <= 1, "the sword is not beside the foe");
  assert.deepEqual(tokenAt(mage.id), { x: 5, y: 5 }, "the wizard walked");
});

await test("The Tentacle of the Deeps strikes a creature within 10 feet of the tentacle, wherever its warlock stands.", async () => {
  const [enemy] = await stage(wizard);
  kit.place(enemy.id, 5, 13);
  world.patch(wizard.id, { conditions: ["tentacle of the deeps"], conditionMeta: { "tentacle of the deeps": { rounds: 9 } } });
  const swing = await kit.swing(wizard.id, enemy.id, [15, 3], { weapon: "Tentacle of the Deeps" });
  assert.equal(swing.ok, true, swing.error);
  const [tentacle] = (kit.map()?.spellZones ?? []).filter((zone) => zone.spell === "Tentacle of the Deeps");
  assert.ok(tentacle, "the tentacle was not set on the board");
  assert.ok(Math.max(Math.abs(tentacle.origin.x - 5), Math.abs(tentacle.origin.y - 13)) <= 2, "the tentacle is not within 10 feet of the foe");
  assert.deepEqual(tokenAt(wizard.id), { x: 5, y: 5 });
});

await test("The Force Ballista fires from the cannon, set down within 5 feet of its artificer.", async () => {
  const [enemy] = await stage(wizard);
  kit.place(enemy.id, 5, 14);
  world.patch(wizard.id, { conditions: ["eldritch cannon"], conditionMeta: { "eldritch cannon": { rounds: 590 } } });
  const swing = await kit.swing(wizard.id, enemy.id, [15, 3], { weapon: "Force Ballista" });
  assert.equal(swing.ok, true, swing.error);
  const [cannon] = (kit.map()?.spellZones ?? []).filter((zone) => zone.spell === "Eldritch Cannon");
  assert.ok(cannon, "the cannon was not set on the board");
  assert.ok(Math.max(Math.abs(cannon.origin.x - 5), Math.abs(cannon.origin.y - 5)) <= 1, "the cannon is not within 5 feet of its artificer");
});

await test("A ranged granted strike reaches its own range and no farther, with no long range past it.", async () => {
  const { buildAttackProfile } = await import("../src/lib/dm/pc-attack-profile.ts");
  const crowned = { ...world.sheet(wizard.id), conditions: ["crown of stars"] };
  const built = buildAttackProfile(world.campaignId, crowned, { weapon: "Crown of Stars" });
  assert.equal(built.profile.rangeTiles, 24, "Crown of Stars reaches 120 feet");
  assert.equal(built.profile.longRangeTiles, 24, "a spell attack has no long range");
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
