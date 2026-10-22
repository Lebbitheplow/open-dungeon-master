// The SRD 5.1 creature table in play (issue 480): every beast is a Wild
// Shape and Polymorph form with its own numbers, every Find Familiar form is
// there, the conjuring spells call what SRD 5.1 holds and nothing else, and
// a natural attack lands everything its stat block prints: rider damage of
// another type, the save its hit forces, the condition or grapple it lays.
//
// The rules, from SRD 5.1 (the stat blocks are the SRD's own):
//   - Wild Shape: a beast of CR 1/4 with no flying or swimming speed at 2nd
//     level, CR 1/2 with no flying speed at 4th, CR 1 at 8th; Circle of the
//     Moon: CR 1 from 2nd, a third of the druid level from 6th.
//   - Polymorph: a beast of CR no higher than the target's level.
//   - Find Familiar: "bat, cat, crab, frog (toad), hawk, lizard, octopus,
//     owl, poisonous snake, fish (quipper), rat, raven, sea horse, spider, or
//     weasel"; a familiar cannot attack, Pact of the Chain's imp, quasit,
//     pseudodragon and sprite can.
//   - Imp, Sting: +5, 1d4+3 piercing, and a DC 11 Constitution save, 3d6
//     poison on a failure, half on a success.
//   - Quasit, Claws: +4, 1d4+3 piercing, and a DC 10 Constitution save or
//     2d4 poison and poisoned for 1 minute, the save repeated each turn.
//   - Black Bear: +4 to hit; Brown Bear: +6. Flying Snake, Bite: +6, 1
//     piercing plus 3d4 poison. Frog and Sea Horse: no attack at all.
//   - Elk, Hooves: "one prone creature" only.
//   - Conjure Minor Elementals: elementals of CR 2 or lower; SRD 5.1's
//     mephits are the dust, ice, magma and steam mephits.
//
// Every check reads a sheet, an enemy row or a refusal; dice are forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables, enemyOf } from "./lib/enforce-spell-kit.mjs";
import { board, holdTurn, place } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-srd-creatures");

const DRUID = (level, extra = {}) => ({
  class: "druid",
  level,
  maxHp: 40,
  abilities: { wis: 16 },
  equipment: [{ name: "Scimitar", qty: 1, equipped: true }],
  ...extra,
});
const WARLOCK = { class: "warlock", level: 3, maxHp: 30, abilities: { cha: 16 } };

// A druid shaped before the fight, standing beside the dummy (AC 13, 90 hit
// points, saves +0) on their own turn.
async function shaped(level, form, extra = {}, stats = {}) {
  const { world, sheets: [druid], enemies: [dummy] } = await board([DRUID(level, extra)], { 0: { x: 3, y: 4 }, e0: { x: 4, y: 4 } }, { stats });
  const out = await world.invoke("use_resource", { characterId: druid.id, resource: "Wild Shape", form });
  assert.equal(out.ok, true, out.error);
  holdTurn(world, druid.id);
  return { world, druid, dummy };
}

const bite = (world, id, dummy, weapon, faces) => {
  world.dice(...faces);
  return world.invoke("pc_attack", { characterId: id, targetEnemyId: dummy.id, weapon }).finally(() => world.clearDice());
};

// ---- Wild Shape and Polymorph ----

await test("A black bear's bite is +4 to hit and a brown bear's +6, as SRD 5.1 prints them: a 9 and a 7 on the die both hit AC 13.", async () => {
  const black = await shaped(4, "black bear");
  const out = await bite(black.world, black.druid.id, black.dummy, "Bite", [9, 3]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.rolled, 13);
  assert.equal(out.result.hit, true);
  assert.equal(enemyOf(black.world, black.dummy.id).currentHp, 90 - 5, "1d6+2");
  const brown = await shaped(8, "brown bear");
  const claws = await bite(brown.world, brown.druid.id, brown.dummy, "Claws", [7, 2, 3]);
  assert.equal(claws.result.rolled, 13);
  assert.equal(claws.result.hit, true);
  assert.equal(enemyOf(brown.world, brown.dummy.id).currentHp, 90 - 9, "2d6+4");
});

await test("A flying snake's bite deals 1 piercing and its 3d4 poison rides the hit.", async () => {
  const { world, druid, dummy } = await shaped(8, "flying snake");
  const out = await bite(world, druid.id, dummy, "Bite", [10, 1, 2, 3]);
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, dummy.id).currentHp, 90 - 7);
});

await test("The 3d4 poison meets the creature's own immunity: a creature immune to poison takes the 1 piercing alone.", async () => {
  const { world, druid, dummy } = await shaped(8, "flying snake", {}, { immune: "poison" });
  await bite(world, druid.id, dummy, "Bite", [10, 4, 4, 4]);
  assert.equal(enemyOf(world, dummy.id).currentHp, 89);
});

await test("A frog has no attack: the druid in its form cannot attack, not even with the scimitar that melded into it.", async () => {
  const { world, druid, dummy } = await shaped(4, "frog");
  assert.deepEqual(world.sheet(druid.id).wildShape.attacks, []);
  for (const weapon of [undefined, "Scimitar", "Bite"]) {
    const out = await bite(world, druid.id, dummy, weapon, [20, 6]);
    assert.equal(out.ok, false, `${weapon}: ${JSON.stringify(out).slice(0, 200)}`);
    assert.match(out.error, /no attack/);
  }
  assert.equal(enemyOf(world, dummy.id).currentHp, 90);
});

await test("A sea horse, which only swims, opens at druid 4th level and has no attack either.", async () => {
  const { world, druid } = await shaped(4, "sea horse");
  assert.equal(world.sheet(druid.id).wildShape.form, "Sea Horse");
  assert.equal(world.sheet(druid.id).wildShape.speed, 0);
});

await test("An elk's hooves strike only a prone creature; its ram strikes the standing one.", async () => {
  const { world, druid, dummy } = await shaped(2, "elk");
  const standing = await bite(world, druid.id, dummy, "Hooves", [20, 4, 4]);
  assert.equal(standing.ok, false);
  assert.match(standing.error, /only a prone creature/);
  const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");
  patchEnemyConditions(dummy.id, ["prone"], {});
  const down = await bite(world, druid.id, dummy, "Hooves", [15, 2, 2]);
  assert.equal(down.ok, true, down.error);
});

await test("A giant octopus's tentacles reach 15 feet and their hit grapples and restrains, held by the druid at the block's escape DC 16.", async () => {
  const { world, druid, dummy } = await shaped(9, "giant octopus", { subclass: "Circle of the Moon" });
  place(world, dummy.id, 6, 4);
  const out = await bite(world, druid.id, dummy, "Tentacles", [15, 3, 3]);
  assert.equal(out.ok, true, out.error);
  const held = enemyOf(world, dummy.id);
  assert.ok(held.conditions.includes("grappled") && held.conditions.includes("restrained"), held.conditions.join());
  assert.equal(held.conditionMeta.grappled.source, druid.id);
  assert.equal(held.conditionMeta.grappled.escapeDc, 16);
});

await test("Polymorph turns a 5th level character into an elephant (CR 4) with its own numbers.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["Polymorph"], [], 9));
  const fighter = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Polymorph", level: 4, variant: "elephant", targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  const shape = world.sheet(fighter.id).wildShape;
  assert.deepEqual([shape.form, shape.beastHp, shape.beastAc, shape.abilities.str], ["Elephant", 76, 12, 22]);
  assert.deepEqual(shape.attacks.map((attack) => [attack.name, attack.toHit, attack.damage]), [["Gore", 8, "3d8+6"], ["Stomp", 8, "3d10+6"]]);
});

// ---- familiars ----

await test("Find Familiar takes every form the spell names: crab, lizard, octopus, quipper (the fish), sea horse, a frog asked for as a toad.", async () => {
  const world = await openWorld();
  const wizard = world.addHero({ ...caster("wizard", "int", ["Find Familiar"], [], 3), gold: 50 });
  for (const [asked, form] of [["crab", "Crab"], ["lizard", "Lizard"], ["octopus", "Octopus"], ["quipper", "Quipper"], ["fish", "Quipper"], ["sea horse", "Sea Horse"], ["toad", "Frog"], ["snake", "Poisonous Snake"]]) {
    const out = await world.invoke("summon_pet", { characterId: wizard.id, kind: "familiar", form: asked });
    assert.equal(out.ok, true, `${asked}: ${out.error}`);
    const pet = world.sheet(wizard.id).pets.find((entry) => entry.kind === "familiar");
    assert.equal(pet.form, form);
    assert.deepEqual(pet.attacks, [], `${form} keeps no attack: a familiar cannot attack`);
  }
  const unknown = await world.invoke("summon_pet", { characterId: wizard.id, kind: "familiar", form: "badger" });
  assert.equal(unknown.ok, false);
  for (const form of ["crab", "lizard", "octopus", "quipper", "sea horse"]) {
    assert.match(unknown.error, new RegExp(`\\b${form}\\b`));
  }
});

async function chainFamiliar(form, stats = {}) {
  const { world, sheets: [warlock], enemies: [dummy] } = await board([WARLOCK], { 0: { x: 3, y: 4 }, e0: { x: 4, y: 4 } }, { stats });
  world.patch(warlock.id, { features: [...world.sheet(warlock.id).features, { name: "Pact of the Chain", source: "class" }] });
  const out = await world.invoke("summon_pet", { characterId: warlock.id, kind: "familiar", form });
  assert.equal(out.ok, true, out.error);
  holdTurn(world, warlock.id);
  return { world, warlock, dummy };
}

const command = (world, warlock, dummy, faces) => {
  world.dice(...faces);
  return world.invoke("pet_attack", { characterId: warlock.id, targetEnemyId: dummy.id }).finally(() => world.clearDice());
};

await test("An imp's sting deals 3d6 poison only on a failed DC 11 Constitution save, and half on a success.", async () => {
  const failed = await chainFamiliar("imp");
  // A 15 hits; the sting's 1d4 rolls 2 (5 piercing); the dummy's save rolls
  // 5 against DC 11; the poison rolls 6, 6, 6.
  const out = await command(failed.world, failed.warlock, failed.dummy, [15, 2, 5, 6, 6, 6]);
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(failed.world, failed.dummy.id).currentHp, 90 - 5 - 18);
  const saved = await chainFamiliar("imp");
  await command(saved.world, saved.warlock, saved.dummy, [15, 2, 15, 6, 6, 6]);
  assert.equal(enemyOf(saved.world, saved.dummy.id).currentHp, 90 - 5 - 9);
});

await test("A quasit's claws are piercing, and a failed DC 10 Constitution save adds 2d4 poison and a minute poisoned, saved against each turn.", async () => {
  // Resistant to piercing: the claws' 5 halves to 2; the 2d4 poison does not.
  const { world, warlock, dummy } = await chainFamiliar("quasit", { resist: "piercing" });
  const out = await command(world, warlock, dummy, [15, 2, 3, 4, 4]);
  assert.equal(out.ok, true, out.error);
  const after = enemyOf(world, dummy.id);
  assert.equal(after.currentHp, 90 - 2 - 8);
  assert.ok(after.conditions.includes("poisoned"));
  assert.deepEqual(after.conditionMeta.poisoned.saveEnds, { ability: "con", dc: 10 });
  assert.equal(after.conditionMeta.poisoned.rounds, 10);
});

await test("A pseudodragon's sting poisons on a failed DC 11 save and, failed by 5 or more, puts the creature to sleep for the hour.", async () => {
  const { world, warlock, dummy } = await chainFamiliar("pseudodragon");
  world.dice(15, 2, 4);
  const out = await world.invoke("pet_attack", { characterId: warlock.id, targetEnemyId: dummy.id, attack: "Sting" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const after = enemyOf(world, dummy.id);
  assert.ok(after.conditions.includes("poisoned") && after.conditions.includes("unconscious"), after.conditions.join());
  assert.equal(after.conditionMeta.unconscious.endsOnDamage, true);
});

// ---- companions and conjured creatures ----

await test("A Beast Master's companion is a Medium or smaller beast: an elk (Large) is refused, a giant poisonous snake bonds with its poison.", async () => {
  const world = await openWorld();
  const ranger = world.addHero({ class: "ranger", subclass: "Beast Master", level: 3, maxHp: 30 });
  const elk = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "elk" });
  assert.equal(elk.ok, false);
  assert.match(elk.error, /Medium or smaller/);
  const snake = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "giant poisonous snake" });
  assert.equal(snake.ok, true, snake.error);
  const [pet] = world.sheet(ranger.id).pets;
  assert.deepEqual([pet.attacks[0].toHit, pet.attacks[0].damage, pet.attacks[0].onHit.damage], [6 + 2, "1d4+4+2", "3d6"]);
});

await test("Conjure Minor Elementals calls SRD 5.1's mephits and refuses a mud or smoke mephit, which it does not hold.", async () => {
  // A minute's casting: out of a fight.
  const world = await openWorld();
  const druid = world.addHero(caster("druid", "wis", ["Conjure Minor Elementals"], [], 9));
  for (const name of ["mud mephit", "smoke mephit"]) {
    const out = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Minor Elementals", level: 4, variant: name });
    assert.equal(out.ok, false, name);
    assert.match(out.error, /no stat block here/);
  }
  const steam = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Minor Elementals", level: 4, variant: "steam mephit" });
  assert.equal(steam.ok, true, steam.error);
});

await test("Conjure Animals calls a giant poisonous snake, whose 10-foot bite forces the DC 11 Constitution save for 3d6 poison.", async () => {
  const { world, sheets: [druid], enemies: [dummy] } = await board([caster("druid", "wis", ["Conjure Animals"], [], 5)], { 0: { x: 3, y: 4 }, e0: { x: 12, y: 4 } });
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "giant poisonous snake", count: 1 });
  assert.equal(cast.ok, true, cast.error);
  const [snake] = world.sheets().filter((sheet) => sheet.summon);
  place(world, snake.id, 10, 4);
  holdTurn(world, snake.id);
  world.dice(10, 2, 3, 6, 6, 6);
  const out = await world.invoke("pc_attack", { characterId: snake.id, targetEnemyId: dummy.id, weapon: "Bite" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, dummy.id).currentHp, 90 - 6 - 18);
});

await test("Conjure Woodland Beings calls a sea hag (fey, CR 2) and Conjure Fey a green hag (CR 3), as SRD 5.1's fey are.", async () => {
  const world = await openWorld();
  const druid = world.addHero(caster("druid", "wis", ["Conjure Woodland Beings", "Conjure Fey"], [], 13));
  const hag = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Woodland Beings", level: 4, variant: "sea hag" });
  assert.equal(hag.ok, true, hag.error);
  const green = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Fey", level: 6, variant: "green hag" });
  assert.equal(green.ok, true, green.error);
});

closeTables();
finish();
