// Two rows docs/rules-coverage.md called enforced with no test behind them
// (SRD 5.1):
//
//   Agonizing Blast (Eldritch Invocation): the warlock adds their Charisma
//     modifier to the damage Eldritch Blast deals on a hit, to EACH beam.
//     Applied through the cantrip_damage_ability effect
//     (src/lib/srd/feature-effects.ts) on pc_attack
//     (src/lib/dm/pc-attack-profile.ts).
//   Polymorph: the new form is a beast whose challenge rating is no higher
//     than the target's level; the target takes the beast's hit points, and
//     damage that drops the form to 0 reverts it, the excess carrying over to
//     the creature's own hit points; the transformed creature cannot cast
//     spells (src/lib/dm/cast-buff.ts, src/lib/srd/shape-rules.ts,
//     src/lib/dm/pc-damage.ts, src/lib/dm/cast-rules.ts). The casting gate
//     on a polymorphed sheet is also held by test-enforce-casting-limits ("a
//     druid in Wild Shape cannot spend a slot until Beast Spells"); the check
//     here reaches the same gate through a real cast instead of a patch.
//   Polymorph at a hostile creature: its WIS save, the shapechanger and
//     0 hit point exclusions, the CR cap, the stat swap, the revert with
//     carry-over, the concentration end and the beast's attacks
//     (src/lib/dm/enemy-polymorph.ts).
//
// Every check reads a sheet, an enemy row or a refusal; dice are forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, table } from "./lib/enforce-spell-kit.mjs";
import { castingState, cleric, warlock } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-coverage-holes");
const { BEAST_FORMS } = await import("../src/lib/srd/beast-forms.ts");

// ---- Agonizing Blast ----

const AGONIZING = { name: "Invocation: Agonizing Blast", source: "choice" };
const CHA = 16;

// Two Eldritch Blast beams from a 5th level warlock, each a forced hit
// (d20 15, +6 against AC 13) with its d10 on `face`. Returns the damage
// each beam dealt, read off the dummy's hit points.
async function twoBeams(features, face) {
  const { world, sheets: [lock], enemies: [dummy] } = await table([warlock(5, { abilities: { cha: CHA, con: 14 }, features })]);
  const dealt = [];
  for (const beam of [1, 2]) {
    const before = enemyOf(world, dummy.id).currentHp;
    world.dice(15, face);
    // The warlock is first in the order: both beams come from one action.
    const out = await world.invokeAsIs("pc_attack", { characterId: lock.id, targetEnemyId: dummy.id, spell: "Eldritch Blast", damage: "1d10" });
    const left = world.clearDice();
    assert.equal(out.ok, true, `beam ${beam}: ${out.error}`);
    assert.equal(left, 0, `beam ${beam} left ${left} forced dice unrolled`);
    dealt.push(before - enemyOf(world, dummy.id).currentHp);
  }
  return dealt;
}

await test("Eldritch Blast without Agonizing Blast: each of the two beams at 5th level deals its d10 and nothing more", async () => {
  assert.deepEqual(await twoBeams([], 6), [6, 6]);
});

await test("Agonizing Blast: each of the two beams at 5th level adds the warlock's CHA modifier to its d10", async () => {
  const mod = abilityMod(CHA);
  assert.deepEqual(await twoBeams([AGONIZING], 6), [6 + mod, 6 + mod]);
});

// ---- Polymorph ----

const form = (name) => BEAST_FORMS.find((entry) => entry.name === name);
const MAMMOTH = form("Mammoth");
assert.equal(MAMMOTH.cr, 6, "the fixtures below lean on the Mammoth being CR 6");
assert.equal(form("Giant Ape").cr, 7, "the fixtures below lean on the Giant Ape being CR 7");

// A 7th level wizard with Polymorph and a 6th level cleric to turn.
async function polymorphTable() {
  const staged = await table([caster("wizard", "int", ["Polymorph"], ["Fire Bolt"], 7), cleric(6)]);
  const [wizard, target] = staged.sheets;
  const polymorph = (beast) => staged.world.invoke("cast_buff", { characterId: wizard.id, spell: "Polymorph", variant: beast, targetCharacterIds: [target.id] });
  return { ...staged, wizard, target, polymorph };
}

await test("Polymorph: a beast above the target's level is refused and nothing is spent; one at the target's level lands (CR 7 refused, CR 6 allowed for a 6th level target, cast by a 7th level wizard)", async () => {
  const { world, wizard, target, polymorph } = await polymorphTable();
  const before = castingState(world.sheet(wizard.id));
  const ape = await polymorph("giant ape");
  assert.equal(ape.ok, false, "a CR 7 form was given to a 6th level target");
  assert.match(ape.error, /CR 7/);
  assert.equal(castingState(world.sheet(wizard.id)), before, "the refused cast spent something");
  assert.equal(world.sheet(target.id).wildShape ?? null, null);
  const mammoth = await polymorph("mammoth");
  assert.equal(mammoth.ok, true, mammoth.error);
  assert.equal(world.sheet(target.id).wildShape?.form, MAMMOTH.name);
});

await test("Polymorph: the target takes the beast's hit points and stat block, its own hit points kept aside", async () => {
  const { world, target, polymorph } = await polymorphTable();
  const own = world.sheet(target.id).currentHp;
  const out = await polymorph("mammoth");
  assert.equal(out.ok, true, out.error);
  const sheet = world.sheet(target.id);
  assert.equal(sheet.wildShape.kind, "polymorph");
  assert.deepEqual(
    { beastHp: sheet.wildShape.beastHp, beastMaxHp: sheet.wildShape.beastMaxHp, beastAc: sheet.wildShape.beastAc, abilities: sheet.wildShape.abilities },
    { beastHp: MAMMOTH.hp, beastMaxHp: MAMMOTH.hp, beastAc: MAMMOTH.ac, abilities: MAMMOTH.abilities },
  );
  assert.equal(sheet.currentHp, own, "the target's own hit points moved");
  assert.ok(sheet.conditions.some((name) => name.toLowerCase() === "polymorphed"));
});

await test("Polymorph: damage comes off the beast first; damage that drops it to 0 reverts the form and the excess carries over", async () => {
  const { world, target, polymorph } = await polymorphTable();
  const own = world.sheet(target.id).currentHp;
  assert.equal((await polymorph("mammoth")).ok, true);
  await world.invoke("apply_damage", { characterId: target.id, amount: 26, type: "bludgeoning" });
  assert.equal(world.sheet(target.id).wildShape?.beastHp, MAMMOTH.hp - 26);
  assert.equal(world.sheet(target.id).currentHp, own, "the beast's blow reached the target's own hit points");
  await world.invoke("apply_damage", { characterId: target.id, amount: MAMMOTH.hp - 26 + 7, type: "bludgeoning" });
  const sheet = world.sheet(target.id);
  assert.equal(sheet.wildShape ?? null, null, "the form held at 0 hit points");
  assert.ok(!sheet.conditions.some((name) => name.toLowerCase() === "polymorphed"), "the polymorphed condition outlived the form");
  assert.equal(sheet.currentHp, own - 7, "the excess did not carry over");
});

await test("Polymorph: the transformed creature cannot cast spells (reached through a real cast)", async () => {
  const { world, target, polymorph } = await polymorphTable();
  assert.equal((await polymorph("mammoth")).ok, true);
  const before = castingState(world.sheet(target.id));
  const bless = await world.invoke("cast_buff", { characterId: target.id, spell: "Bless" });
  assert.equal(bless.ok, false, "a polymorphed creature cast Bless");
  assert.match(bless.error, /polymorphed/);
  assert.equal(castingState(world.sheet(target.id)), before);
});

// ---- Polymorph at a hostile creature ----
//
// SRD 5.1: an unwilling creature makes a WIS save; a shapechanger or a
// creature at 0 hit points is unaffected. The beast's challenge rating is at
// most the target's. On a failure the beast's statistics replace its own (it
// keeps its alignment), it takes the beast's hit points, damage that drops
// the form to 0 reverts it with the excess carried over, and the form ends
// with the caster's concentration (src/lib/dm/enemy-polymorph.ts).

const BEAR = form("Brown Bear");
assert.equal(BEAR.cr, 1, "the fixtures below lean on the Brown Bear being CR 1");
const OWN = { cr: 2, xp: 450, alignment: "chaotic evil" };

// A 7th level wizard with Polymorph against one CR 2 dummy (90 HP, AC 13,
// saves +0) with `stats` laid over it.
async function hostileTable(stats = {}) {
  const staged = await table([caster("wizard", "int", ["Polymorph", "Bless"], [], 7)], 1, { ...OWN, ...stats });
  const { world, sheets: [wizard], enemies: [dummy] } = staged;
  // The save die is forced: 1 fails, 20 succeeds.
  const polymorph = async (beast, face, tool = "cast_buff") => {
    world.dice(...[face].flat());
    const out = await world.invoke(tool, { characterId: wizard.id, spell: "Polymorph", variant: beast, targetEnemyId: dummy.id, ...(tool === "cast_at_enemy" ? { saveAbility: "wis" } : {}) });
    world.clearDice();
    return { ...out, ...out.result };
  };
  const own = () => {
    const row = enemyOf(world, dummy.id);
    return { currentHp: row.currentHp, maxHp: row.maxHp, ac: row.ac, stats: row.stats };
  };
  return { world, wizard, dummy, polymorph, own };
}

await test("Polymorph at a creature: a beast above its challenge rating is refused before anything is spent (a Mammoth, CR 6, at a CR 2 creature)", async () => {
  const { world, wizard, dummy, polymorph, own } = await hostileTable();
  const before = { caster: castingState(world.sheet(wizard.id)), enemy: own() };
  const out = await polymorph("mammoth", 1);
  assert.equal(out.ok, false, "a CR 6 form was given to a CR 2 creature");
  assert.match(out.error, /CR 6/);
  assert.equal(castingState(world.sheet(wizard.id)), before.caster, "the refused cast spent something");
  assert.deepEqual(own(), before.enemy);
  assert.equal(world.sheet(wizard.id).wildShape ?? null, null, "the caster was transformed");
  assert.ok(!enemyOf(world, dummy.id).conditions.includes("polymorphed"));
});

await test("Polymorph at a creature: a shapechanger, or a creature at 0 hit points, is unaffected and the spell is refused before it is spent", async () => {
  const { world, wizard, polymorph, own } = await hostileTable({ traits: ["Shapechanger: The creature can use its action to polymorph into a Small or Medium humanoid, or back into its true form."] });
  const before = { caster: castingState(world.sheet(wizard.id)), enemy: own() };
  const out = await polymorph("brown bear", 1);
  assert.equal(out.ok, false, "a shapechanger was polymorphed");
  assert.match(out.error, /shapechanger/i);
  assert.equal(castingState(world.sheet(wizard.id)), before.caster);
  assert.deepEqual(own(), before.enemy);

  const down = await hostileTable();
  const { patchEnemyHp } = await import("../src/lib/db/encounters.ts");
  patchEnemyHp(down.dummy.id, 0, "alive");
  const spent = castingState(down.world.sheet(down.wizard.id));
  const atZero = await down.polymorph("brown bear", 1);
  assert.equal(atZero.ok, false, "a creature at 0 hit points was polymorphed");
  assert.match(atZero.error, /0 hit points/);
  assert.equal(castingState(down.world.sheet(down.wizard.id)), spent);
});

await test("Polymorph at a creature: a successful WIS save leaves it as it was, and the slot is spent", async () => {
  const { world, wizard, polymorph, own } = await hostileTable();
  const before = { caster: castingState(world.sheet(wizard.id)), enemy: own() };
  const out = await polymorph("brown bear", 20);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.saved, true);
  assert.deepEqual(own(), before.enemy);
  assert.notEqual(castingState(world.sheet(wizard.id)), before.caster, "the slot was not spent");
});

await test("Polymorph at a creature: Magic Resistance rolls its save with advantage (rolled 1 and 20, it saves)", async () => {
  const { polymorph, own } = await hostileTable({ traits: ["Magic Resistance: The creature has advantage on saving throws against spells and other magical effects."] });
  const before = own();
  const out = await polymorph("brown bear", [1, 20]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.saved, true, "advantage was not given");
  assert.deepEqual(own(), before);
});

await test("Polymorph at a creature: a failed WIS save gives it the beast's statistics and hit points, keeping its alignment, and the caster stays as they were (cast_buff and cast_at_enemy)", async () => {
  for (const tool of ["cast_buff", "cast_at_enemy"]) {
    const { world, wizard, dummy, polymorph } = await hostileTable();
    const out = await polymorph("brown bear", 1, tool);
    assert.equal(out.ok, true, `${tool}: ${out.error}`);
    assert.equal(out.saved, false);
    const row = enemyOf(world, dummy.id);
    assert.deepEqual(
      { currentHp: row.currentHp, maxHp: row.maxHp, ac: row.ac, cr: row.stats.cr, attacks: row.stats.attacks.map((attack) => attack.name), perTurn: row.stats.attacksPerTurn },
      { currentHp: BEAR.hp, maxHp: BEAR.hp, ac: BEAR.ac, cr: BEAR.cr, attacks: BEAR.attacks.map((attack) => attack.name), perTurn: 2 },
      tool,
    );
    assert.deepEqual(row.stats.abilities, BEAR.abilities, `${tool}: the mind is the beast's too`);
    assert.equal(row.stats.saveMods.wis, abilityMod(BEAR.abilities.wis));
    assert.equal(row.stats.alignment, OWN.alignment, `${tool}: the alignment changed`);
    assert.ok(row.conditions.includes("polymorphed"), `${tool}: no polymorphed condition`);
    assert.equal(world.sheet(wizard.id).wildShape ?? null, null, `${tool}: the caster was transformed`);
  }
});

await test("Polymorph at a creature: damage comes off the beast; damage that drops it to 0 reverts the form, its own block back exactly, and the excess carries over", async () => {
  const { world, dummy, polymorph, own } = await hostileTable();
  const before = own();
  assert.equal((await polymorph("brown bear", 1)).saved, false);
  await world.invoke("damage_enemy", { enemyId: dummy.id, amount: 10 });
  assert.equal(enemyOf(world, dummy.id).currentHp, BEAR.hp - 10);
  await world.invoke("damage_enemy", { enemyId: dummy.id, amount: BEAR.hp - 10 + 7 });
  const row = enemyOf(world, dummy.id);
  assert.equal(row.status, "alive", "the creature died with its form");
  assert.deepEqual(own(), { ...before, currentHp: before.currentHp - 7 }, "the own block did not come back, or the excess did not carry over");
  assert.ok(!row.conditions.includes("polymorphed"), "the polymorphed condition outlived the form");
});

await test("Polymorph at a creature: the caster's concentration breaking restores its own statistics and hit points exactly", async () => {
  const { world, wizard, dummy, polymorph, own } = await hostileTable();
  const before = own();
  assert.equal((await polymorph("brown bear", 1)).saved, false);
  await world.invoke("damage_enemy", { enemyId: dummy.id, amount: 5 });
  assert.equal(world.sheet(wizard.id).concentratingOn, "Polymorph");
  // Down to 0: concentration ends with no save.
  await world.invoke("apply_damage", { characterId: wizard.id, amount: world.sheet(wizard.id).currentHp, type: "bludgeoning" });
  assert.equal(world.sheet(wizard.id).concentratingOn ?? null, null);
  assert.deepEqual(own(), before, "the creature's own block or hit points did not come back exactly");
  assert.ok(!enemyOf(world, dummy.id).conditions.includes("polymorphed"));
});

await test("Polymorph at a creature: its attacks are the beast's (enemy_attack swings the Brown Bear's bite and claws)", async () => {
  const { world, wizard, dummy, polymorph } = await hostileTable();
  assert.equal((await polymorph("brown bear", 1)).saved, false);
  world.dice(1, 1);
  const out = await world.invoke("enemy_attack", { enemyId: dummy.id, targetCharacterId: wizard.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.multiattack, BEAR.attacks.map((attack) => attack.name).join(", "));
});

await test("Polymorph at a creature: Dispel Magic ending it gives the creature its own block back", async () => {
  const staged = await table([caster("wizard", "int", ["Polymorph", "Dispel Magic"], [], 7)], 1, OWN);
  const { world, sheets: [wizard], enemies: [dummy] } = staged;
  const before = enemyOf(world, dummy.id);
  world.dice(1);
  const out = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Polymorph", variant: "brown bear", targetEnemyId: dummy.id });
  world.clearDice();
  assert.equal(out.result?.saved, false, out.error);
  // The 4th level slot went on Polymorph: from a 3rd, the DC 14 check, forced.
  world.dice(20);
  const dispel = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: dummy.id, spell: "Dispel Magic", level: 3 });
  world.clearDice();
  assert.equal(dispel.ok, true, dispel.error);
  const after = enemyOf(world, dummy.id);
  assert.deepEqual({ hp: after.currentHp, max: after.maxHp, ac: after.ac, stats: after.stats }, { hp: before.currentHp, max: before.maxHp, ac: before.ac, stats: before.stats });
});

await test("True Polymorph at a creature shares the path: a failed WIS save makes it the beast, and a shapechanger is not spared", async () => {
  const staged = await table([caster("wizard", "int", ["True Polymorph"], [], 17)], 1, { ...OWN, traits: ["Shapechanger: The creature can use its action to polymorph into a Small or Medium humanoid."] });
  const { world, sheets: [wizard], enemies: [dummy] } = staged;
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: dummy.id, spell: "True Polymorph", saveAbility: "wis", variant: "brown bear" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false);
  assert.equal(enemyOf(world, dummy.id).currentHp, BEAR.hp);
  assert.equal(enemyOf(world, dummy.id).stats.polymorphedFrom?.spell, "True Polymorph");
});

await test("cast_buff refuses a targetEnemyId a buff cannot honour before anything is spent (Bless at an enemy)", async () => {
  const { world, wizard, dummy } = await hostileTable();
  const before = castingState(world.sheet(wizard.id));
  const out = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Bless", targetEnemyId: dummy.id });
  assert.equal(out.ok, false, "Bless landed with an enemy named");
  assert.match(out.error, /enemy/i);
  assert.equal(castingState(world.sheet(wizard.id)), before, "the refused cast spent something");
  assert.ok(!world.sheet(wizard.id).conditions.includes("blessed"), "the buff fell back on the caster");
});

closeTables();
finish();
