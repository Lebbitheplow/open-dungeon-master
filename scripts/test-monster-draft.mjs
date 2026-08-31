// The monster a person writes. A draft IS an EnemyStats with a name on it,
// so almost everything here is about the boundary: what a client may send,
// what gets clamped, and the one thing that must be refused outright rather
// than clamped, which is a damage expression the dice engine cannot roll.
// See docs/workshop-plan.md phase 6.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  MAX_ATTACKS,
  MAX_TRAITS,
  SAVE_ABILITIES,
  SIZES,
  blankDraft,
  checkAttack,
  checkMonsterDraft,
  describeMonster,
  draftFromCr,
  draftFromData,
  draftFromStats,
  draftToData,
  readMonster,
} = await import("../src/lib/bestiary/monster-draft.ts");
const { xpForCr } = await import("../src/lib/srd/encounter-math.ts");
const { isValidExpression } = await import("../src/lib/dice.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const goblin = {
  name: "Gutter Goblin",
  ac: 15,
  maxHp: 7,
  cr: 0.25,
  attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", type: "slashing" }],
};

// ---- attacks ----

test("an attack needs a name and rollable damage", () => {
  assert.ok("error" in checkAttack({ damage: "1d6" }));
  assert.ok("error" in checkAttack({ name: "Bite" }));
  assert.ok("attack" in checkAttack({ name: "Bite", damage: "1d6+2" }));
});

test("damage the dice engine cannot roll is refused, not repaired", () => {
  // This is the one rule with teeth. An unrollable expression is not a
  // weaker attack, it is an attack that throws in the middle of a fight,
  // and the only place it can still be fixed is here.
  const bad = checkAttack({ name: "Bite", damage: "1d6 + banana" });
  assert.ok("error" in bad);
  assert.match(bad.error, /not a dice expression/);
});

test("whitespace in a damage expression is closed up rather than rejected", () => {
  const checked = checkAttack({ name: "Bite", damage: "2d10 + 5" });
  assert.equal(checked.attack.damage, "2d10+5");
  assert.ok(isValidExpression(checked.attack.damage));
});

test("an attack with no damage type is untyped rather than blank", () => {
  assert.equal(checkAttack({ name: "Slam", damage: "1d8" }).attack.type, "untyped");
});

// ---- the draft ----

test("a monster needs a name", () => {
  assert.ok("error" in checkMonsterDraft({ ...goblin, name: "   " }));
});

test("a bad attack fails the whole draft, naming which one", () => {
  const checked = checkMonsterDraft({
    ...goblin,
    attacks: [
      { name: "Scimitar", toHit: 4, damage: "1d6+2", type: "slashing" },
      { name: "Bow", toHit: 4, damage: "not dice", type: "piercing" },
    ],
  });
  assert.ok("error" in checked);
  assert.match(checked.error, /notdice/);
});

test("numbers are clamped rather than refused", () => {
  // A DM who types 5000 hit points meant a tough monster and should get one.
  const { draft } = checkMonsterDraft({ ...goblin, ac: 99, maxHp: 99999, attacksPerTurn: 40 });
  assert.equal(draft.stats.ac, 30);
  assert.equal(draft.stats.maxHp, 1000);
  // Clipped to what the engine will actually swing.
  assert.equal(draft.stats.attacksPerTurn, 3);
});

test("garbage in a number field falls back rather than becoming NaN", () => {
  const { draft } = checkMonsterDraft({ ...goblin, ac: "chainmail", maxHp: null });
  assert.equal(draft.stats.ac, 12);
  assert.equal(draft.stats.maxHp, 10);
});

test("XP is computed from the rating, never taken from the client", () => {
  const { draft } = checkMonsterDraft({ ...goblin, cr: 5, xp: 999999 });
  assert.equal(draft.stats.xp, xpForCr(5));
});

test("the attack and trait lists are bounded", () => {
  const { draft } = checkMonsterDraft({
    ...goblin,
    attacks: Array.from({ length: 12 }, (_, index) => ({
      name: `Swing ${index}`,
      toHit: 3,
      damage: "1d6",
      type: "slashing",
    })),
    traits: Array.from({ length: 20 }, (_, index) => `Trait ${index}`),
  });
  assert.equal(draft.stats.attacks.length, MAX_ATTACKS);
  assert.equal(draft.stats.traits.length, MAX_TRAITS);
});

test("empty traits are dropped rather than stored as blank lines", () => {
  const { draft } = checkMonsterDraft({ ...goblin, traits: ["Pack Tactics: ...", "", "   "] });
  assert.equal(draft.stats.traits.length, 1);
});

test("every save modifier is present, so saveModFor never guesses", () => {
  const { draft } = checkMonsterDraft({ ...goblin, saveMods: { dex: 4 } });
  for (const ability of SAVE_ABILITIES) {
    assert.equal(typeof draft.stats.saveMods[ability], "number");
  }
  assert.equal(draft.stats.saveMods.dex, 4);
  assert.equal(draft.stats.saveMods.str, 0);
});

test("an unknown size reads as Medium, the way the grapple rules assume", () => {
  assert.equal(checkMonsterDraft({ ...goblin, size: "Colossal" }).draft.stats.size, "Medium");
  assert.equal(checkMonsterDraft({ ...goblin, size: "Huge" }).draft.stats.size, "Huge");
  assert.ok(SIZES.includes("Gargantuan"));
});

// ---- where a draft starts ----

test("starting from a rating gives the DMG baseline for it", () => {
  const draft = draftFromCr("Something", 5);
  assert.equal(draft.stats.cr, 5);
  assert.equal(draft.stats.xp, xpForCr(5));
  assert.ok(draft.stats.attacks.length > 0);
});

test("starting from an existing block copies it verbatim", () => {
  const source = checkMonsterDraft({ ...goblin, cr: 2 }).draft.stats;
  const draft = draftFromStats("Reskinned", source);
  assert.equal(draft.name, "Reskinned");
  assert.equal(draft.stats.maxHp, source.maxHp);
  assert.deepEqual(draft.stats.attacks, source.attacks);
});

test("a blank draft is a legal draft", () => {
  const blank = blankDraft();
  const checked = checkMonsterDraft({ ...blank.stats, name: "Named" });
  assert.ok("draft" in checked);
});

// ---- storage round trip ----

test("a draft survives a trip through storage unchanged", () => {
  const { draft } = checkMonsterDraft({ ...goblin, cr: 3, extraDamagePerRound: 12 });
  const restored = draftFromData(draft.name, draftToData(draft, "A mean one."));
  assert.deepEqual(restored.stats, draft.stats);
  assert.equal(restored.extraDamagePerRound, 12);
});

test("an unreadable stored row opens as a baseline rather than throwing", () => {
  // A monster that cannot be opened cannot be fixed either.
  const restored = draftFromData("Corrupt", { stats: "not an object" });
  assert.equal(restored.name, "Corrupt");
  assert.ok(restored.stats.cr >= 0);
});

test("the description is bounded on the way in", () => {
  const { draft } = checkMonsterDraft(goblin);
  const data = draftToData(draft, "x".repeat(20_000));
  assert.equal(data.desc.length, 8_000);
});

// ---- the readout ----

test("the readout says whether the block agrees with its own rating", () => {
  const honest = readMonster(draftFromCr("Baseline", 5));
  assert.equal(honest.statedCr, 5);
  assert.equal(typeof honest.agrees, "boolean");

  // A CR 1 label on a monster with 300 hit points and a heavy swing.
  const { draft } = checkMonsterDraft({
    name: "Liar",
    cr: 1,
    ac: 18,
    maxHp: 300,
    attacks: [{ name: "Slam", toHit: 9, damage: "4d10+6", type: "bludgeoning" }],
    attacksPerTurn: 2,
  });
  const readout = readMonster(draft);
  assert.equal(readout.agrees, false);
  assert.ok(readout.derived.cr > 1);
});

test("each stat is compared to the DMG row for the rating it claims", () => {
  const { draft } = checkMonsterDraft({ ...goblin, cr: 5, maxHp: 20, ac: 10 });
  const readout = readMonster(draft);
  const hp = readout.against.find((row) => row.label === "Hit points");
  const ac = readout.against.find((row) => row.label === "Armour class");
  assert.equal(hp.verdict, "under");
  assert.equal(hp.expected, "131 to 145");
  assert.equal(ac.verdict, "under");
});

test("damage added by hand moves the derived rating", () => {
  const base = checkMonsterDraft({ ...goblin, cr: 5, maxHp: 140, ac: 15 }).draft;
  const withBreath = checkMonsterDraft({
    ...goblin,
    cr: 5,
    maxHp: 140,
    ac: 15,
    extraDamagePerRound: 40,
  }).draft;
  assert.ok(readMonster(withBreath).derived.cr > readMonster(base).derived.cr);
});

test("the one-line summary says when the numbers disagree with the label", () => {
  const honest = describeMonster(draftFromCr("Baseline", 1));
  const { draft } = checkMonsterDraft({ ...goblin, cr: 1, maxHp: 400, ac: 20 });
  assert.match(describeMonster(draft), /the numbers say CR/);
  assert.equal(honest.includes("the numbers say"), !readMonster(draftFromCr("B", 1)).agrees);
});

console.log(`monster draft: ${passed} assertions passed.`);
