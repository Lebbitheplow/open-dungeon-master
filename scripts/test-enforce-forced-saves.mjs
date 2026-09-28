// The saving throws an enemy forces on a character (cast_at_player: an
// enemy's spell, a trap, a breath weapon on one target): the save is rolled
// by the server with the bonus the sheet gives, against the DC the caster
// sets, and what follows is decided by the total and nothing else.
//
// The rules, from SRD 5.1:
//   - A save is d20 + ability modifier, + proficiency bonus when proficient
//     in that save. It succeeds when the total meets the DC.
//   - A natural 20 or a natural 1 decides nothing on a saving throw.
//   - A spell that deals half damage on a save says so; one that does not
//     deals nothing to a creature that saves.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-forced-saves");
const world = await openWorld();

const SCORES = { str: 12, dex: 16, con: 14, int: 8, wis: 15, cha: 11 };
const scout = world.addHero({
  class: "ranger", level: 5, abilities: SCORES,
  proficiencies: { ...TRAINED, saves: ["str", "dex"], skills: ["stealth", "perception", "survival"], expertise: ["stealth"] },
});
const PB = proficiencyBonus(5);

const reset = () => {
  world.patch(scout.id, { conditions: [], conditionMeta: {}, exhaustion: 0, currentHp: scout.maxHp, tempHp: 0 });
  world.clearDice();
  world.diceLog();
};

// An enemy's spell or a trap on one character. The console's form and the
// handler disagree about the fields, so both shapes are sent.
const hex = (hero, args) =>
  world.invoke("cast_at_player", {
    spell: "Test Hex", characterIds: [hero.id], characterId: hero.id, source: "Test Hex", ...args,
  });

await test("cast_at_player: the save is the sheet's, against the DC given", async () => {
  reset();
  const total = 9 + abilityMod(16) + PB;
  world.dice(9, 4, 4);
  const saved = await hex(scout, { saveAbility: "dex", dc: total, damage: "2d6", halfOnSave: true });
  assert.equal(world.clearDice(), 0);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.result.save, total);
  assert.equal(saved.result.saved, true);
  assert.equal(saved.result.damage, 4);
  assert.equal(world.sheet(scout.id).currentHp, scout.maxHp - 4);

  reset();
  world.dice(9, 4, 4);
  const failed = await hex(scout, { saveAbility: "dex", dc: total + 1, damage: "2d6", halfOnSave: true });
  world.clearDice();
  assert.equal(failed.result.saved, false);
  assert.equal(world.sheet(scout.id).currentHp, scout.maxHp - 8);
});

await test("cast_at_player: a condition lands on a failed save and not on a made one", async () => {
  reset();
  world.dice(2);
  const failed = await hex(scout, { saveAbility: "wis", dc: 15, condition: "frightened", rounds: 3 });
  world.clearDice();
  assert.equal(failed.result.saved, false);
  assert.ok(world.sheet(scout.id).conditions.includes("frightened"));
  assert.equal(world.sheet(scout.id).conditionMeta.frightened.rounds, 3);
  reset();
  world.dice(19);
  const made = await hex(scout, { saveAbility: "wis", dc: 15, condition: "frightened", rounds: 3 });
  world.clearDice();
  assert.equal(made.result.saved, true);
  assert.deepEqual(world.sheet(scout.id).conditions, []);
});

await test("cast_at_player: a natural 20 short of the DC fails, and no save means no damage unless it halves", async () => {
  reset();
  world.dice(20, 4, 4);
  const out = await hex(scout, { saveAbility: "int", dc: 25, damage: "2d6" });
  world.clearDice();
  assert.equal(out.result.saved, false);
  assert.equal(world.sheet(scout.id).currentHp, scout.maxHp - 8);
  reset();
  world.dice(15, 4, 4);
  const none = await hex(scout, { saveAbility: "dex", dc: 10, damage: "2d6" });
  world.clearDice();
  assert.equal(none.result.saved, true);
  assert.equal(world.sheet(scout.id).currentHp, scout.maxHp);
});

await test("cast_at_player: every save uses the sheet's bonus, trained or not", async () => {
  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    reset();
    const bonus = abilityMod(SCORES[ability]) + (["str", "dex"].includes(ability) ? PB : 0);
    world.dice(10);
    // A bonus offered by the caller is not the sheet's and is not used.
    const out = await hex(scout, { saveAbility: ability, dc: 10, condition: "frightened", rounds: 1, bonus: 9, modifier: 9 });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.save, 10 + bonus, ability);
    assert.equal(out.result.saved, 10 + bonus >= 10, ability);
  }
});

await test("cast_at_player: a character at 0 hit points is not brought below it", async () => {
  reset();
  world.patch(scout.id, { currentHp: 1 });
  world.dice(2, 6, 6);
  const out = await hex(scout, { saveAbility: "dex", dc: 20, damage: "2d6" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(scout.id).currentHp, 0);
});

await test("a lasting effect on saves applies to a forced save", async () => {
  reset();
  await world.invoke("set_effect", {
    characterId: scout.id, name: "Ward", field: "save",
    modifiers: [{ field: "save", mode: "add", value: 3 }],
  });
  try {
    world.dice(10, 1);
    const out = await hex(scout, { saveAbility: "con", dc: 10, damage: "1d4" });
    world.clearDice();
    assert.equal(out.result.save, 10 + abilityMod(14) + 3, `the save came to ${out.result.save} under a +3 effect`);
  } finally {
    await world.invoke("clear_effect", { characterId: scout.id, name: "Ward" });
  }
});

await test("a forced save spends the inspiration die it adds", async () => {
  reset();
  world.patch(scout.id, { conditions: ["bardic inspiration (d6)"] });
  world.dice(10, 4, 1);
  const out = await hex(scout, { saveAbility: "con", dc: 10, damage: "1d4" });
  world.clearDice();
  assert.equal(out.result.save, 10 + 4 + abilityMod(14));
  assert.deepEqual(world.sheet(scout.id).conditions, [], "the inspiration die was rolled and kept");
});

await test("The DM console's forms for Cast at a player and Cast at an enemy reach the engine.", async () => {
  const { adjudication, checkArgs } = await import("../src/lib/dm/invoke-catalog.ts");
  // What the form asks for is what the handler needs: filled in, it passes
  // the form's own check and the engine resolves it.
  reset();
  const filled = {
    characterId: scout.id, saveAbility: "wis", dc: 13, condition: "paralyzed", rounds: 10,
    spell: "Hold Person",
  };
  assert.equal(checkArgs(adjudication("cast_at_player"), filled), null);
  world.dice(2);
  const out = await world.invoke("cast_at_player", filled);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false);
  assert.ok(world.sheet(scout.id).conditions.includes("paralyzed"));
  // A form left without its save is stopped by the form, by name.
  reset();
  const bare = checkArgs(adjudication("cast_at_player"), { characterId: scout.id, dc: 13 });
  assert.match(String(bare), /save/i);
  // The list of targets an older console sends is read as its first.
  world.dice(19);
  const listed = await world.invoke("cast_at_player", {
    characterIds: [scout.id], saveAbility: "wis", dc: 13, condition: "frightened", rounds: 1,
  });
  world.clearDice();
  assert.equal(listed.ok, true, listed.error);
  assert.equal(listed.result.saved, true);
  // Cast at an enemy asks for the target and the save its handler reads.
  const names = adjudication("cast_at_enemy").fields.filter((field) => field.required).map((field) => field.name);
  assert.deepEqual(names.sort(), ["characterId", "saveAbility", "spell", "targetEnemyId"]);
});

reset();
world.close();
finish();
