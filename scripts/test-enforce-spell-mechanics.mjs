// What ODM derives from a spell, against what the spell does.
//
// The cast tools do not trust the caller for a known spell: how it resolves
// (an attack roll, a save, no roll at all, healing), which save, whether a
// save halves, the damage type, the condition, and the dice at this caster
// level and this slot all come from spellMechanicsFor and spellDamageFor
// (src/lib/content/index.ts), which read the spell's own text. This suite
// holds both up against the literal SRD 5.1 table in
// scripts/lib/enforce-spell-table.mjs: every cantrip at every character
// level (the dice grow at 5th, 11th and 17th and nowhere else), every
// upcastable spell at every slot from its own level to 9th, and the two
// numbers every spell is cast with, save DC = 8 + proficiency + ability
// modifier and spell attack = proficiency + ability modifier.
//
// Where the text defeats the parser the server falls back to the caller's
// dice (docs/rules-coverage.md, "Unknown/homebrew spells: guidance"). That
// fallback is documented for spells no pack knows; for the SRD spells it
// reaches here it is recorded as a gap.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { fightWithoutMap, packAnswers, wizard } from "./lib/enforce-spells.mjs";
import { SPELL_TABLE } from "./lib/enforce-spell-table.mjs";

const { test, finish } = suite("test-enforce-spell-mechanics");
const world = await openWorld();
const pack = await packAnswers();
const { spellDamageFor, spellMechanicsFor, findSpellByName } = await import("../src/lib/content/index.ts");
const { computeSheetDerived, spellAttackFor, spellSaveDcFor } = await import("../src/lib/srd/index.ts");

// Without the pack only the authored layer answers, and only for how a spell
// resolves (the dice need the pack's text), so the table shrinks to the rows
// ODM authored itself. Shadowed and 2024 rows are the data suite's findings,
// not this one's.
const SKIP = new Set(["Haste", "Hex", "Chromatic Orb"]);
const rows = SPELL_TABLE.filter(
  (row) => !SKIP.has(row.name) && (pack ? true : spellMechanicsFor({ spell: row.name }) !== null && row.srd === false),
);
const diceOf = (name, casterLevel, slotLevel) =>
  spellDamageFor({ spell: name, userId: world.owner.id, casterLevel, slotLevel })?.dice ?? null;

// "8d6" plus n times "1d6" is "10d6": the arithmetic of the upcast line. The
// rest of a payload rides along unchanged: Disintegrate's "10d6+40" from a
// 7th level slot is "13d6+40".
function scaled(base, step, times) {
  const [head, ...rest] = base.split("+");
  const [count, sides] = head.split("d").map(Number);
  const [more, stepSides] = step.split("d").map(Number);
  assert.equal(sides, stepSides, "the table only scales like dice");
  return [`${count + more * times}d${sides}`, ...rest].join("+");
}

// What a spell rolls at its own level: the whole payload where the book
// prints more than one term (Disintegrate's 10d6 + 40).
const printed = (row) => row.whole ?? row.dice;

// Sum of dice counts in an expression, so "2d8+4d6" and "8d6" compare by
// how much is rolled rather than by spelling.
const diceCount = (expression) =>
  [...String(expression ?? "").matchAll(/(\d+)d\d+/g)].reduce((sum, match) => sum + Number(match[1]), 0);

await test("each spell resolves the way the book says: attack, save, no roll, or healing", () => {
  const problems = [];
  for (const row of rows.filter((entry) => entry.how)) {
    const mech = spellMechanicsFor({ spell: row.name })?.mech ?? null;
    if (mech?.resolution !== row.how) {
      problems.push(`${row.name}: resolves as ${mech?.resolution ?? "nothing"}, the book says ${row.how}`);
      continue;
    }
    if (row.save && mech.save !== row.save) {
      problems.push(`${row.name}: ${mech.save} save, the book says ${row.save}`);
    }
    if (row.how === "save" && row.half !== undefined && Boolean(mech.halfOnSave) !== row.half) {
      problems.push(`${row.name}: half on a save ${Boolean(mech.halfOnSave)}, the book says ${row.half}`);
    }
    if (row.type && mech.damageType !== row.type) {
      problems.push(`${row.name}: ${mech.damageType} damage, the book says ${row.type}`);
    }
    if (row.condition && mech.condition?.name !== row.condition) {
      problems.push(`${row.name}: applies ${mech.condition?.name}, the book says ${row.condition}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(rows.length > 0);
});

if (pack) {
  await test("a cantrip's dice grow at 5th, 11th and 17th level and at no other", () => {
    const problems = [];
    for (const row of rows.filter((entry) => entry.tiers)) {
      for (let level = 1; level <= 20; level += 1) {
        const expected = level >= 17 ? row.tiers[2] : level >= 11 ? row.tiers[1] : level >= 5 ? row.tiers[0] : row.dice;
        const got = diceOf(row.name, level);
        if (got !== expected) {
          problems.push(`${row.name} at level ${level}: ${got}, the book says ${expected}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  await test("a cantrip scales with character level, whatever slot the caller names", () => {
    const named = rows.find((entry) => entry.tiers);
    assert.equal(diceOf(named.name, 1, 9), named.dice);
    assert.equal(diceOf(named.name, 20, 1), named.tiers[2]);
    // Out of range levels are clamped, not extrapolated.
    assert.equal(diceOf(named.name, 0), named.dice);
    assert.equal(diceOf(named.name, 99), named.tiers[2]);
  });

  await test("a levelled spell rolls its printed dice at its own level", () => {
    const problems = [];
    for (const row of rows.filter((entry) => entry.dice && entry.up && entry.level > 0)) {
      const got = diceOf(row.name, 20, row.level);
      const omitted = diceOf(row.name, 20, undefined);
      if (got !== printed(row) || omitted !== printed(row)) {
        problems.push(`${row.name}: ${got} (${omitted} with no slot named), the book says ${printed(row)}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  await test("upcasting adds the printed dice for every slot level above the spell's own", () => {
    const problems = [];
    for (const row of rows.filter((entry) => entry.dice && entry.up)) {
      for (let slot = row.level; slot <= 9; slot += 1) {
        const expected = scaled(printed(row), row.up, slot - row.level);
        const got = diceOf(row.name, 1, slot);
        if (got !== expected) {
          problems.push(`${row.name} from a level ${slot} slot: ${got}, the book says ${expected}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  await test("a slot below the spell's level never shrinks the dice", () => {
    assert.equal(diceOf("Fireball", 5, 1), "8d6");
    assert.equal(diceOf("Fireball", 5, 3), "8d6");
    assert.equal(diceOf("Fireball", 5, 4), "9d6");
    assert.equal(diceOf("Fireball", 5, 9), "14d6");
  });

  await test("the staples, one by one", () => {
    const fireball = spellMechanicsFor({ spell: "Fireball" });
    assert.deepEqual(
      { ...fireball.mech, level: fireball.spellLevel, concentration: fireball.concentration },
      // The area's size rides along: it bounds how far from the caster a
      // caught creature may stand (aoe-spell.ts).
      { resolution: "save", save: "dex", halfOnSave: true, damageType: "fire", area: true, areaFeet: 20, level: 3, concentration: false },
    );
    const hold = spellMechanicsFor({ spell: "Hold Person" });
    assert.equal(hold.mech.save, "wis");
    assert.deepEqual(hold.mech.condition, { name: "paralyzed", saveEnds: true });
    assert.equal(hold.concentration, true);
    assert.equal(hold.spellLevel, 2);
    const sacred = spellMechanicsFor({ spell: "Sacred Flame" });
    assert.equal(sacred.mech.save, "dex");
    assert.equal(Boolean(sacred.mech.halfOnSave), false, "a cantrip save is all or nothing");
    assert.equal(spellMechanicsFor({ spell: "Magic Missile" }).mech.resolution, "auto");
    assert.equal(spellMechanicsFor({ spell: "Spiritual Weapon" }).concentration, false);
    assert.equal(spellMechanicsFor({ spell: "Spirit Guardians" }).concentration, true);
    assert.equal(spellMechanicsFor({ spell: "Bless" }).concentration, true);
    assert.equal(spellMechanicsFor({ spell: "Hunter's Mark" }).concentration, true);
    assert.equal(findSpellByName("Healing Word").data.casting_time, "1 bonus action");
  });

  await test("a known spell with no upcast line rolls its own printed dice, not the caller's", () => {
      const missing = rows
        .filter((row) => row.dice && row.level > 0 && !row.up && row.how !== "heal")
        .filter((row) => diceOf(row.name, 20, row.level) === null)
        .map((row) => row.name);
      assert.deepEqual(missing, [], `no dice derived for: ${missing.join(", ")}`);
  });

  await test("a spell that prints two damage terms or a flat bonus rolls all of it", () => {
      const short = rows
        .filter((row) => row.whole)
        .map((row) => ({ row, got: diceOf(row.name, 20, row.level) }))
        .filter(({ got }) => got !== null)
        .filter(({ row, got }) => diceCount(got) !== diceCount(row.whole) || /\+\d+$/.test(row.whole) !== /\+\d+$/.test(got))
        .map(({ row, got }) => `${row.name} rolls ${got}, the book says ${row.whole}`);
      assert.deepEqual(short, [], short.join("; "));
  });

  await test("Wall of Fire rolls 5d8 at 4th level", () => {
      assert.equal(diceOf("Wall of Fire", 20, 4), "5d8", `derived ${diceOf("Wall of Fire", 20, 4)}`);
  });

  await test("Dimension Door, Teleport and Wish do not resolve as automatic damage", () => {
      const wrong = ["Dimension Door", "Teleport", "Wish"].filter(
        (name) => spellMechanicsFor({ spell: name })?.mech.resolution === "auto",
      );
      assert.deepEqual(wrong, [], `resolve as automatic damage: ${wrong.join(", ")}`);
  });
}

// ---- the two numbers every spell is cast with ----

const SCORES = [8, 10, 13, 16, 18, 20];
const LEVELS = [1, 4, 5, 8, 9, 12, 13, 16, 17, 20];

await test("save DC is 8 + proficiency + ability modifier, for every caster", () => {
  for (const [classId, ability] of [["wizard", "int"], ["cleric", "wis"], ["sorcerer", "cha"], ["paladin", "cha"], ["ranger", "wis"], ["warlock", "cha"], ["bard", "cha"], ["druid", "wis"]]) {
    for (const level of LEVELS) {
      for (const score of SCORES) {
        const sheet = {
          class: classId,
          level,
          classes: [],
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, [ability]: score },
          proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] },
          equipment: [],
          features: [],
          feats: [],
          conditions: [],
          spellcasting: { ability, slots: {}, known: [], prepared: [], cantrips: [] },
        };
        const derived = computeSheetDerived(sheet);
        const label = `${classId} ${level}, ${ability} ${score}`;
        assert.equal(derived.spellSaveDc, 8 + proficiencyBonus(level) + abilityMod(score), label);
        assert.equal(derived.spellAttack, proficiencyBonus(level) + abilityMod(score), label);
        assert.equal(spellSaveDcFor(sheet, "Fireball"), derived.spellSaveDc);
        assert.equal(spellAttackFor(sheet, "Fire Bolt"), derived.spellAttack);
      }
    }
  }
});

await test("a character with no spellcasting has no save DC and no spell attack", () => {
  const derived = computeSheetDerived({
    class: "fighter",
    level: 10,
    classes: [],
    abilities: { str: 18, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
    proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] },
    equipment: [],
    features: [],
    feats: [],
    conditions: [],
    spellcasting: null,
  });
  assert.equal(derived.spellSaveDc, null);
  assert.equal(derived.spellAttack, null);
});

await test("the DC an enemy saves against is the sheet's, at every level and score", async () => {
  for (const [level, score] of [[1, 16], [5, 16], [9, 20], [17, 20], [20, 8]]) {
    const table = await openWorld();
    const hero = table.addHero(wizard(level, { abilities: { int: score } }));
    await fightWithoutMap(table, [{ monster: "goblin", count: 1 }]);
    const [enemy] = table.enemies();
    table.dice(1);
    const cast = await table.invoke("cast_at_enemy", {
      characterId: hero.id,
      targetEnemyId: enemy.id,
      spell: "Hold Person",
      saveAbility: "wis",
      level: 2,
    });
    // A 1st level wizard has no 2nd level slot: the DC is only on a cast that happens.
    if (level === 1) {
      assert.equal(cast.ok, false);
      continue;
    }
    assert.equal(cast.ok, true, cast.error);
    assert.equal(cast.result.dc, 8 + proficiencyBonus(level) + abilityMod(score), `level ${level}, int ${score}`);
  }
});

world.close();
finish();
