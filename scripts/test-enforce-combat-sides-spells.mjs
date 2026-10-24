// A spell the engine casts on characters as a buff, at a character on the
// other side (issue 503, Phase 6; src/lib/dm/hostile-buffs.ts): the spell's
// own path on the target's sheet, after the save its text gives an unwilling
// creature.
//
//   - Polymorph at a turncoat, by cast_buff's targetEnemyId, cast_at_enemy or
//     targetCharacterIds: a failed WIS save, and the turncoat is a wolf, its
//     form on its sheet, the caster concentrating;
//   - a made save: the slot is spent and nothing changes;
//   - Enlarge/Reduce at a turncoat: a CON save;
//   - an ally in the party takes Polymorph with no save, as before.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-combat-sides-spells");
const world = await openWorld();
const kit = await combatKit(world);
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");

const BODY = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
const SLOTS = { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 3, used: 0 }, 5: { max: 1, used: 0 } };
const mage = world.addHero({
  name: "Vex", ...caster("wizard", "int", ["Polymorph", "Enlarge/Reduce"], [], 9), maxHp: 40, ac: 12, acOverride: true,
  equipment: [{ name: "Component pouch", qty: 1 }],
});
const friend = world.addHero({ name: "Mira", class: "fighter", level: 5, abilities: BODY, proficiencies: TRAINED, maxHp: 40, ac: 12, acOverride: true });

async function stage() {
  await kit.endFight();
  world.patch(mage.id, { concentratingOn: null, conditions: [], conditionMeta: {}, spellcasting: { ...world.sheet(mage.id).spellcasting, slots: SLOTS } });
  world.patch(friend.id, { conditions: [], conditionMeta: {}, wildShape: null });
  const joined = await world.invoke("add_companion", { gender: "Unknown", name: "Aldric", class: "fighter", race: "human", level: 3, personality: "Grim.", kind: "guest" });
  assert.equal(joined.ok, true, joined.error);
  const turncoat = joined.result.characterId;
  world.patch(turncoat, { abilities: BODY, proficiencies: TRAINED, maxHp: 30, currentHp: 30, ac: 12, acOverride: true, conditions: [], conditionMeta: {} });
  await kit.fight(1, { heroFaces: { [mage.id]: 20, [friend.id]: 18, [turncoat]: 3 } });
  moveToSide(world.campaign(), turncoat, "foe", { quiet: true });
  kit.place(mage.id, 2, 2);
  kit.place(friend.id, 2, 3);
  kit.place(turncoat, 4, 2);
  kit.giveTurn(mage.id);
  return world.sheet(turncoat);
}

const polymorphed = (id) => world.sheet(id).conditions.some((entry) => /polymorph/i.test(entry));
const slotsUsed = () => Object.values(world.sheet(mage.id).spellcasting.slots).reduce((sum, slot) => sum + slot.used, 0);

for (const [how, call] of [
  ["cast_buff's targetEnemyId", (target) => ({ tool: "cast_buff", args: { characterId: mage.id, spell: "Polymorph", variant: "Wolf", targetEnemyId: target } })],
  ["cast_at_enemy", (target) => ({ tool: "cast_at_enemy", args: { characterId: mage.id, spell: "Polymorph", variant: "Wolf", targetEnemyId: target } })],
  ["cast_buff's targetCharacterIds", (target) => ({ tool: "cast_buff", args: { characterId: mage.id, spell: "Polymorph", variant: "Wolf", targetCharacterIds: [target] } })],
]) {
  await test(`Polymorph at a turncoat through ${how}: a failed WIS save, and its sheet takes the wolf's form`, async () => {
    const turncoat = await stage();
    const { tool, args } = call(turncoat.id);
    world.diceLog();
    world.dice(1);
    const out = await world.invoke(tool, args);
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.ok(world.diceLog().some((die) => die.sides === 20), "the turncoat's WIS save was rolled");
    assert.ok(polymorphed(turncoat.id), JSON.stringify(out.result));
    assert.equal(world.sheet(turncoat.id).wildShape?.kind, "polymorph");
    assert.match(String(world.sheet(turncoat.id).wildShape?.form ?? world.sheet(turncoat.id).wildShape?.name ?? JSON.stringify(world.sheet(turncoat.id).wildShape)), /wolf/i);
    assert.equal(world.sheet(mage.id).concentratingOn, "Polymorph");
  });
}

await test("A turncoat that makes its WIS save keeps its own form; the slot is spent", async () => {
  const turncoat = await stage();
  const before = slotsUsed();
  world.dice(20);
  const out = await world.invoke("cast_buff", { characterId: mage.id, spell: "Polymorph", variant: "Wolf", targetEnemyId: turncoat.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(polymorphed(turncoat.id), false);
  assert.equal(world.sheet(turncoat.id).wildShape ?? null, null);
  assert.equal(slotsUsed(), before + 1, "the slot is spent");
  assert.match(String(out.result.noEffect ?? ""), /resists Polymorph/);
});

await test("Enlarge/Reduce at a turncoat: a CON save, made, and nothing changes", async () => {
  const turncoat = await stage();
  world.diceLog();
  world.dice(20);
  const out = await world.invoke("cast_buff", { characterId: mage.id, spell: "Enlarge/Reduce", variant: "reduced", targetCharacterIds: [turncoat.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.match(String(out.result.noEffect ?? ""), /CON save/);
  assert.equal(world.sheet(turncoat.id).conditions.some((entry) => /reduced/i.test(entry)), false);
});

await test("An ally in the party takes Polymorph with no save, as before", async () => {
  await stage();
  world.diceLog();
  const out = await world.invoke("cast_buff", { characterId: mage.id, spell: "Polymorph", variant: "Wolf", targetCharacterIds: [friend.id] });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.diceLog().some((die) => die.sides === 20), false, "no save for a willing ally");
  assert.ok(polymorphed(friend.id));
});

await kit.endFight();
finish();
