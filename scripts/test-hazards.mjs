// 5e hazard math: falling dice, the DMG trap severity-by-level table, and the
// suffocation / extreme-temperature helpers.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  fallingDamageDice,
  tierForLevel,
  trapSaveDc,
  trapDamageDice,
  trapProfile,
  breathHoldMinutes,
  suffocationRounds,
  extremeColdSave,
  extremeHeatSave,
} = await import("../src/lib/srd/hazards.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("falling is 1d6 per 10 feet, capped at 20d6", () => {
  assert.equal(fallingDamageDice(0), "0");
  assert.equal(fallingDamageDice(5), "0");
  assert.equal(fallingDamageDice(10), "1d6");
  assert.equal(fallingDamageDice(45), "4d6");
  assert.equal(fallingDamageDice(200), "20d6");
  assert.equal(fallingDamageDice(1000), "20d6");
});

test("character level maps to the four DMG tiers", () => {
  assert.equal(tierForLevel(1), 1);
  assert.equal(tierForLevel(4), 1);
  assert.equal(tierForLevel(5), 2);
  assert.equal(tierForLevel(10), 2);
  assert.equal(tierForLevel(11), 3);
  assert.equal(tierForLevel(16), 3);
  assert.equal(tierForLevel(17), 4);
  assert.equal(tierForLevel(20), 4);
});

test("trap save DCs sit in the severity bands", () => {
  assert.equal(trapSaveDc("setback"), 11);
  assert.equal(trapSaveDc("dangerous"), 13);
  assert.equal(trapSaveDc("deadly"), 18);
});

test("trap damage matches the severity-by-level table", () => {
  assert.equal(trapDamageDice("setback", 1), "1d10");
  assert.equal(trapDamageDice("dangerous", 3), "2d10");
  assert.equal(trapDamageDice("deadly", 1), "4d10");
  assert.equal(trapDamageDice("deadly", 8), "10d10");
  assert.equal(trapDamageDice("deadly", 20), "24d10");
});

test("a trap profile carries a dex save, DC, and scaled damage", () => {
  const profile = trapProfile("dangerous", 7);
  assert.equal(profile.saveAbility, "dex");
  assert.equal(profile.saveDc, 13);
  assert.equal(profile.tier, 2);
  assert.equal(profile.damageDice, "4d10");
});

test("suffocation follows 1 + CON mod minutes then CON-mod rounds", () => {
  assert.equal(breathHoldMinutes(3), 4);
  assert.equal(breathHoldMinutes(-2), 0.5); // floor at 30 seconds
  assert.equal(suffocationRounds(3), 3);
  assert.equal(suffocationRounds(0), 1); // at least one round
});

test("extreme temperature forces a CON save, heat DC rising by the hour", () => {
  assert.equal(extremeColdSave().dc, 10);
  assert.equal(extremeColdSave().ability, "con");
  assert.equal(extremeHeatSave(1).dc, 5);
  assert.equal(extremeHeatSave(3).dc, 7);
});

console.log(`test-hazards: ${passed} suites passed.`);
