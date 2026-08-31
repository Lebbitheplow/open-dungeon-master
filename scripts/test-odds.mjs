// Consequence preview: the two different d20 rules 5e has, and what an attack
// is actually worth against a given AC.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  asPercent,
  attackOdds,
  averageDetail,
  averageOf,
  checkChance,
  forecastAttack,
  roundsToDrop,
} = await import("../src/lib/srd/odds.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );

test("a check needing an 11 is a coin flip", () => {
  close(checkChance(0, 11), 0.5);
  close(checkChance(5, 16), 0.5);
});

test("advantage on a coin flip is three quarters", () => {
  close(checkChance(0, 11, "advantage"), 0.75);
  close(checkChance(0, 11, "disadvantage"), 0.25);
});

test("a check has no natural 20, so out of reach means impossible", () => {
  // DC 30 with a +5: even a 20 lands on 25. Attacks would still crit; checks
  // do not, and the preview has to say so rather than quietly showing 5%.
  close(checkChance(5, 30), 0);
  close(checkChance(5, 5), 1);
});

test("an attack always has a natural 20 and a natural 1", () => {
  // AC 30 against +0: only a 20 hits.
  close(attackOdds({ attackBonus: 0, ac: 30 }).hit, 0.05);
  // AC 2 against +10: only a 1 misses.
  close(attackOdds({ attackBonus: 10, ac: 2 }).hit, 0.95);
});

test("hit chance is the roll needed, and crits ride inside it", () => {
  const odds = attackOdds({ attackBonus: 5, ac: 15 });
  // Needs a 10 or better: 11 faces out of 20.
  close(odds.hit, 0.55);
  close(odds.crit, 0.05);
  close(odds.miss, 0.45);
});

test("an expanded crit range widens crits without moving hits", () => {
  const normal = attackOdds({ attackBonus: 5, ac: 15 });
  const champion = attackOdds({ attackBonus: 5, ac: 15, critRange: 19 });
  close(champion.hit, normal.hit);
  close(champion.crit, 0.1);
});

test("advantage compounds the crit chance too", () => {
  close(attackOdds({ attackBonus: 0, ac: 10, advantage: "advantage" }).crit, 1 - 0.95 ** 2);
});

test("a linear expression averages by its dice and its modifier", () => {
  assert.deepEqual(averageDetail("2d6+3"), { average: 10, exact: true });
  assert.deepEqual(averageDetail("1d8"), { average: 4.5, exact: true });
  assert.deepEqual(averageDetail("1d4-1"), { average: 1.5, exact: true });
  assert.deepEqual(averageDetail("7"), { average: 7, exact: true });
});

test("keep-highest is NOT averaged as if every die counted", () => {
  // The linear shortcut would say 21 here. Advantage on a d20 is 13.825, and
  // a preview that reported 21 would make every number beside it a lie.
  const kept = averageDetail("2d20kh1");
  assert.equal(kept.exact, true);
  close(kept.average, 13.825, 1e-9);
  close(averageDetail("2d20kl1").average, 7.175, 1e-9);
  // The two halves of the same 400 outcomes.
  close(averageDetail("2d20kh1").average + averageDetail("2d20kl1").average, 21, 1e-9);
});

test("keep-highest with a modifier keeps the modifier", () => {
  close(averageDetail("2d20kh1+5").average, 18.825, 1e-9);
});

test("the classic 4d6 drop lowest comes out right", () => {
  // The well-known ability-score average.
  close(averageDetail("4d6kh3").average, 12.244598765432098, 1e-9);
});

test("nonsense in the damage box reports itself as unknown", () => {
  assert.deepEqual(averageDetail("not dice"), { average: 0, exact: false });
  assert.deepEqual(averageDetail(""), { average: 0, exact: false });
  assert.equal(averageOf(""), 0);
});

test("a pool too large to enumerate says so instead of guessing", () => {
  const huge = averageDetail("6d20kh3");
  assert.equal(huge.exact, false);
});

test("a reroll is not enumerated, because the dice count moves", () => {
  // "1d20r1" rerolls a 1, so a fixed list of die values cannot reproduce it.
  assert.equal(averageDetail("1d20r1").exact, false);
});

test("a crit doubles the dice and not the modifier", () => {
  const forecast = forecastAttack({ attackBonus: 5, ac: 15, damage: "1d8+3" });
  assert.equal(forecast.onHit, 7.5);
  assert.equal(forecast.onCrit, 12);
  assert.equal(forecast.exact, true);
});

test("the table's crit variants move the forecast, because the engine moves", () => {
  const base = { attackBonus: 5, ac: 15, damage: "1d8+3" };
  // Powerful Critical: the extra die is dealt as its maximum, not rolled.
  assert.equal(forecastAttack({ ...base, variantRules: { powerfulCritical: true } }).onCrit, 15.5);
  // Critical Damage Mods: the flat modifier doubles along with the dice.
  assert.equal(forecastAttack({ ...base, variantRules: { multiplyNumeric: true } }).onCrit, 15);
  // Both together.
  assert.equal(
    forecastAttack({
      ...base,
      variantRules: { powerfulCritical: true, multiplyNumeric: true },
    }).onCrit,
    18.5,
  );
});

test("brutal critical adds its extra dice to the forecast", () => {
  const forecast = forecastAttack({
    attackBonus: 5,
    ac: 15,
    damage: "2d6+4",
    extraCritDice: 1,
  });
  // 2d6+4 doubled is 4d6+4 (18), plus one more d6 for Brutal Critical.
  assert.equal(forecast.onCrit, 21.5);
});

test("expected damage counts the crit's extra dice on top of the hit", () => {
  const forecast = forecastAttack({ attackBonus: 5, ac: 15, damage: "1d8+3" });
  // 55% of 7.5, plus 5% of the 4.5 a crit adds over a hit.
  close(forecast.perAttack, 0.55 * 7.5 + 0.05 * 4.5, 1e-9);
});

test("a damage expression it cannot average forecasts nothing", () => {
  const forecast = forecastAttack({ attackBonus: 5, ac: 15, damage: "a sword" });
  assert.equal(forecast.exact, false);
  assert.equal(forecast.perAttack, 0);
  // The odds themselves are still real: they never depended on the damage.
  close(forecast.odds.hit, 0.55);
});

test("rounds to drop rounds up, and never divides by nothing", () => {
  assert.equal(roundsToDrop(30, 10), 3);
  assert.equal(roundsToDrop(31, 10), 4);
  assert.equal(roundsToDrop(5, 10), 1);
  assert.equal(roundsToDrop(30, 0), null);
});

test("percentages are whole numbers", () => {
  assert.equal(asPercent(0.55), "55%");
  assert.equal(asPercent(0.05), "5%");
  assert.equal(asPercent(1), "100%");
});

console.log(`odds: ${passed} tests passed`);
