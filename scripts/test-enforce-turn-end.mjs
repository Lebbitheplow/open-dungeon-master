// Effects that last "until the end of" a combatant's next turn, and the
// other rules that hang on a turn's end or start: every die forced, the turn
// order walked with the players' own End Turn.
//
// The rules, from SRD 5.1:
//   - Stunning Strike (monk 5): the target is stunned "until the end of your
//     next turn".
//   - Guiding Bolt: "the next attack roll made against this target before the
//     end of your next turn has advantage".
//   - Ray of Frost: speed down 10 feet "until the start of your next turn";
//     Chill Touch: no hit points regained "until the start of your next turn"
//     (both START, not end: the brief's list named them, the SRD text wins).
//   - Chill Touch on an undead: disadvantage on attack rolls against the
//     caster "until the end of your next turn".
//   - An effect that ends at the end of a turn outlasts that turn's start.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { slotsOf, FULL_CASTER_SLOTS } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-turn-end");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);

const monk = world.addHero({
  class: "monk", level: 5, abilities: { dex: 16, wis: 14 }, proficiencies: TRAINED,
});
const cleric = world.addHero({
  class: "cleric", level: 5, abilities: { wis: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Mace", qty: 1 }],
  spellcasting: { ability: "wis", slots: slotsOf(FULL_CASTER_SLOTS[4]), known: [], prepared: ["Guiding Bolt"], cantrips: [] },
});
const wizard = world.addHero({
  class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: slotsOf(FULL_CASTER_SLOTS[4]), known: [], prepared: [], cantrips: ["Ray of Frost", "Chill Touch"] },
});
const heroes = [monk, cleric, wizard];
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));
const userOf = (hero) => world.sheet(hero.id).userId;

// `first` at the head of the order, the others after it, one dummy last.
async function stage(first, { gapTiles = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    world.patch(entry.id, { spellcasting: base.get(entry.id).spellcasting, conditions: [], conditionMeta: {}, resources: { ...world.sheet(entry.id).resources, ki: { max: 5, used: 0 } } });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry, index) => [entry.id, entry.id === first.id ? 19 : 10 - index]));
  await kit.fight(1, { heroFaces });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(first.id, 5, 5);
  kit.place(enemy.id, 5, 5 + gapTiles);
  assert.equal(kit.current().characterId, first.id);
  return enemy;
}

// Ends turns with the players' own button until `hero` holds the floor again.
function walkTo(hero) {
  for (let step = 0; step < 8; step += 1) {
    const current = kit.current();
    assert.ok(kit.endTurn(world.sheet(current.characterId).userId), "End Turn was refused");
    if (kit.current().characterId === hero.id) {
      return;
    }
  }
  throw new Error("the order never came back");
}

const has = (conditions, name) => conditions.map((entry) => entry.toLowerCase()).includes(name);

// ---- until the end of the next turn ----

await test("Stunning Strike stuns until the END of the monk's next turn: the creature is still stunned while the monk's next turn runs.", async () => {
  const enemy = await stage(monk);
  const hit = await kit.swing(monk.id, enemy.id, [15, 3, 1], { weapon: "unarmed strike", stunningStrike: true });
  assert.equal(hit.ok, true, hit.error);
  assert.ok(has(kit.enemy(enemy.id).conditions, "stunned"));
  walkTo(monk);
  assert.ok(has(kit.enemy(enemy.id).conditions, "stunned"), "the stun ended as the monk's next turn started");
  assert.ok(kit.endTurn(userOf(monk)));
  assert.equal(has(kit.enemy(enemy.id).conditions, "stunned"), false, "the stun outlived the monk's next turn");
});

await test("Guiding Bolt's advantage holds until the END of the caster's next turn, so the caster's own next attack still has it.", async () => {
  const enemy = await stage(cleric, { gapTiles: 4 });
  const bolt = await kit.swing(cleric.id, enemy.id, [15, 3, 3, 3, 3], { spell: "Guiding Bolt", damage: "4d6" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.ok(has(kit.enemy(enemy.id).conditions, "guiding bolt"));
  walkTo(cleric);
  assert.ok(has(kit.enemy(enemy.id).conditions, "guiding bolt"), "Guiding Bolt ended as the caster's next turn started");
  assert.ok(kit.endTurn(userOf(cleric)));
  assert.equal(has(kit.enemy(enemy.id).conditions, "guiding bolt"), false);
});

await test("Ray of Frost's slow ends at the START of the caster's next turn, as the SRD says.", async () => {
  const enemy = await stage(wizard, { gapTiles: 4 });
  const ray = await kit.swing(wizard.id, enemy.id, [15, 3], { spell: "Ray of Frost", damage: "2d8" });
  assert.equal(ray.ok, true, ray.error);
  assert.ok(has(kit.enemy(enemy.id).conditions, "ray of frost"));
  walkTo(wizard);
  assert.equal(has(kit.enemy(enemy.id).conditions, "ray of frost"), false);
});

await test("An effect that lasts until the end of a creature's own next turn outlives that turn's start and ends once the turn is over (the pattern of Vicious Mockery).", async () => {
  const enemy = await stage(monk);
  kit.setEnemy(enemy.id, { conditions: ["mocked"], conditionMeta: { mocked: { untilTurnEndOf: enemy.id, source: monk.id } } });
  // The monk's turn ends: the pointer walks past the dummy (its turn starts)
  // and lands on the next character.
  assert.ok(kit.endTurn(userOf(monk)));
  const walked = kit.enemy(enemy.id);
  assert.ok(has(walked.conditions, "mocked") || kit.current().characterId === monk.id, "ended before the creature's turn came");
  // Back round to the monk: the creature's turn started as the pointer passed
  // it, so the effect still holds while that turn is being played...
  walkTo(monk);
  assert.ok(has(kit.enemy(enemy.id).conditions, "mocked"), "ended as the creature's turn started");
  // ...and is gone once the pointer moves on (the server's backstop ends it
  // sooner, as soon as it has played the creature's turn).
  assert.ok(kit.endTurn(userOf(monk)));
  assert.equal(has(kit.enemy(enemy.id).conditions, "mocked"), false);
});

await test("Chill Touch on an undead keeps its disadvantage against the caster until the end of the caster's next turn.", async () => {
  const enemy = await stage(wizard, { gapTiles: 4 });
  kit.setEnemy(enemy.id, { stats: { type: "undead" } });
  const touch = await kit.swing(wizard.id, enemy.id, [15, 3], { spell: "Chill Touch", damage: "2d8" });
  assert.equal(touch.ok, true, touch.error);
  assert.ok(has(kit.enemy(enemy.id).conditions, "undead dread (chill touch)"));
  walkTo(wizard);
  assert.equal(has(kit.enemy(enemy.id).conditions, "chill touch"), false, "the no-healing part outlived the start of the caster's turn");
  assert.ok(has(kit.enemy(enemy.id).conditions, "undead dread (chill touch)"), "the dread ended as the caster's turn started");
  assert.ok(kit.endTurn(userOf(wizard)));
  assert.equal(has(kit.enemy(enemy.id).conditions, "undead dread (chill touch)"), false);
});

await test("Old rows with no end-of-turn meta load and tick as before: a bare untilTurnOf still ends as the turn starts.", async () => {
  const enemy = await stage(monk);
  kit.setEnemy(enemy.id, { conditions: ["stunned"], conditionMeta: { stunned: { untilTurnOf: monk.id } } });
  walkTo(monk);
  assert.equal(has(kit.enemy(enemy.id).conditions, "stunned"), false);
});

finish();
