// The dice grid's arithmetic and timing (docs/visual-overhaul-plan.md 7.2) and
// the health explainer's working, which must agree with the number the
// builder actually suggests for Max HP.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  FLICKER_FACES,
  ROW_SETTLE_MS,
  TOTAL_POP_MS,
  assignStandard,
  hpBreakdown,
  pipsFor,
  restOffsets,
  rollFourDice,
  rollTier,
  summaryLine,
  tossMs,
} = await import("../src/app/characters/builder/abilityDice.ts");
const { suggestedStartingHp, SRD_CLASSES } = await import("../src/lib/srd/index.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A random source that deals the given faces in order.
const deal = (...faces) => {
  let index = 0;
  return () => (faces[index++ % faces.length] - 1) / 6 + 0.01;
};

test("four dice, the lowest set aside, the rest summed", () => {
  const roll = rollFourDice(deal(4, 2, 6, 5));
  assert.deepEqual(roll.dice, [4, 2, 6, 5]);
  assert.equal(roll.dropIndex, 1);
  assert.equal(roll.total, 15);
});

test("a tie for lowest marks one die only, the first", () => {
  const roll = rollFourDice(deal(3, 1, 1, 6));
  assert.equal(roll.dropIndex, 1);
  assert.equal(roll.total, 10);
  const same = rollFourDice(deal(6, 6, 6, 6));
  assert.equal(same.dropIndex, 0);
  assert.equal(same.total, 18);
});

test("ten thousand rolls stay in 3 to 18 and match drop-lowest", () => {
  for (let index = 0; index < 10000; index += 1) {
    const roll = rollFourDice();
    const sorted = [...roll.dice].sort((a, b) => b - a);
    assert.equal(roll.total, sorted[0] + sorted[1] + sorted[2]);
    assert.ok(roll.total >= 3 && roll.total <= 18);
    assert.ok(roll.dice.every((face) => face >= 1 && face <= 6));
    assert.equal(roll.dice[roll.dropIndex], Math.min(...roll.dice));
  }
});

test("the toss: 820 ms plus 90 per die, the row lands after the last", () => {
  assert.deepEqual([0, 1, 2, 3].map(tossMs), [820, 910, 1000, 1090]);
  assert.equal(TOTAL_POP_MS, 1240);
  assert.ok(ROW_SETTLE_MS > tossMs(3));
  assert.ok(ROW_SETTLE_MS <= 1600, "inside the motion scale's linger");
});

test("settled dice rest a few pixels and degrees off the grid", () => {
  const rest = restOffsets();
  assert.equal(rest.length, 4);
  for (const die of rest) {
    assert.ok(Math.abs(Number.parseFloat(die.dx)) <= 3.5 && die.dx.endsWith("px"));
    assert.ok(Math.abs(Number.parseFloat(die.dy)) <= 3.5 && die.dy.endsWith("px"));
    assert.ok(Math.abs(Number.parseFloat(die.dr)) <= 13 && die.dr.endsWith("deg"));
  }
});

test("pips: each face has its count, inside the die", () => {
  for (let face = 1; face <= 6; face += 1) {
    const pips = pipsFor(face);
    assert.equal(pips.length, face);
    assert.ok(pips.every((pip) => pip.cx >= 12 && pip.cx <= 30 && pip.cy >= 12 && pip.cy <= 30));
  }
  assert.deepEqual(pipsFor(0), []);
  assert.deepEqual([...FLICKER_FACES].sort(), [1, 2, 3, 4, 5, 6]);
});

test("tiers", () => {
  assert.deepEqual([3, 5, 6, 8, 9, 12, 13, 16, 17, 18].map(rollTier), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});

test("standard array: taking a value clears its holder, taking your own hands it back", () => {
  const empty = { str: null, dex: null, con: null, int: null, wis: null, cha: null };
  const first = assignStandard(empty, "str", 15);
  assert.equal(first.str, 15);
  const moved = assignStandard(first, "dex", 15);
  assert.equal(moved.str, null);
  assert.equal(moved.dex, 15);
  const back = assignStandard(moved, "dex", 15);
  assert.equal(back.dex, null);
  assert.equal(empty.str, null, "the input is not mutated");
});

test("the summary sentence names the standout score and never uses a long dash", () => {
  const line = summaryLine({ method: "roll", best: { label: "Strength", final: 17 }, who: "half-orc paladin" });
  assert.match(line, /Your highest is Strength at 17\./);
  assert.match(line, /As a half-orc paladin/);
  for (const method of ["roll", "pointbuy", "standard"]) {
    assert.ok(!summaryLine({ method, best: null, who: "" }).includes(String.fromCharCode(0x2014)));
  }
});

test("the health explainer's working equals the builder's suggestion", () => {
  for (const klass of SRD_CLASSES) {
    for (const con of [6, 9, 10, 14, 17, 20]) {
      for (const level of [1, 2, 5, 20]) {
        for (const raceId of ["human", "hill_dwarf"]) {
          const parts = hpBreakdown({
            hitDie: klass.hitDie,
            con,
            level,
            bonusPerLevel: raceId === "hill_dwarf" ? 1 : 0,
          });
          assert.equal(
            parts.total,
            suggestedStartingHp(klass.id, raceId, con, level),
            `${klass.id} con ${con} level ${level} ${raceId}`,
          );
          assert.equal(parts.firstLevel + parts.laterLevels >= 1 ? parts.firstLevel + parts.laterLevels : 1, parts.total);
        }
      }
    }
  }
});

console.log(`test-ability-dice: ${passed} passed`);
