// 5e death-save rules: massive damage, damage while dying, and the
// nat20/nat1/10+ death-save outcomes.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  freshDeathTrack,
  isMassiveDamage,
  onDamageAtZero,
  applyDeathSaveRoll,
  deathSavesInMinutes,
  dyingLeftAlone,
  isDying,
  MOST_SAVES_TO_SETTLE,
} = await import("../src/lib/dm/death-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("massive damage compares overkill to max HP", () => {
  assert.equal(isMassiveDamage(12, 12), true);
  assert.equal(isMassiveDamage(11, 12), false);
  assert.equal(isMassiveDamage(0, 12), false);
});

test("damage at zero adds one failure, two on a crit", () => {
  assert.equal(onDamageAtZero(freshDeathTrack(), false).failures, 1);
  assert.equal(onDamageAtZero(freshDeathTrack(), true).failures, 2);
});

test("damage at zero breaks stabilization", () => {
  const stable = { ...freshDeathTrack(), successes: 3, stable: true };
  const next = onDamageAtZero(stable, false);
  assert.equal(next.stable, false);
  assert.equal(next.failures, 1);
});

test("third failure from damage kills", () => {
  const track = { ...freshDeathTrack(), failures: 2 };
  assert.equal(onDamageAtZero(track, false).dead, true);
});

test("dead track is inert", () => {
  const dead = { ...freshDeathTrack(), failures: 3, dead: true };
  assert.equal(onDamageAtZero(dead, true), dead);
  assert.equal(applyDeathSaveRoll(dead, 20).outcome, "dead");
});

test("nat 20 revives with a cleared track", () => {
  const result = applyDeathSaveRoll({ ...freshDeathTrack(), failures: 2 }, 20);
  assert.equal(result.outcome, "revive");
  assert.equal(result.track.failures, 0);
});

test("nat 1 counts two failures and can kill", () => {
  const one = applyDeathSaveRoll(freshDeathTrack(), 1);
  assert.equal(one.track.failures, 2);
  assert.equal(one.outcome, "failure");
  const fatal = applyDeathSaveRoll({ ...freshDeathTrack(), failures: 2 }, 1);
  assert.equal(fatal.outcome, "dead");
});

test("10+ succeeds; three successes stabilize", () => {
  const success = applyDeathSaveRoll(freshDeathTrack(), 10);
  assert.equal(success.outcome, "success");
  assert.equal(success.track.successes, 1);
  const stable = applyDeathSaveRoll({ ...freshDeathTrack(), successes: 2 }, 15);
  assert.equal(stable.outcome, "stable");
  assert.equal(stable.track.stable, true);
});

test("9 or lower fails; three failures kill", () => {
  const failure = applyDeathSaveRoll(freshDeathTrack(), 9);
  assert.equal(failure.outcome, "failure");
  const fatal = applyDeathSaveRoll({ ...freshDeathTrack(), failures: 2 }, 5);
  assert.equal(fatal.outcome, "dead");
  assert.equal(fatal.track.dead, true);
});

test("no fall outlasts five saves, so a minute settles any of them", () => {
  // Every order of results ends by the fifth roll.
  for (let mask = 0; mask < 32; mask += 1) {
    let track = freshDeathTrack();
    let rolls = 0;
    while (!track.stable && !track.dead && rolls < 10) {
      track = applyDeathSaveRoll(track, (mask >> rolls) & 1 ? 15 : 5).track;
      rolls += 1;
    }
    assert.ok(rolls <= MOST_SAVES_TO_SETTLE, `mask ${mask} took ${rolls} saves`);
  }
  assert.equal(deathSavesInMinutes(0), 0);
  assert.equal(deathSavesInMinutes(0.25), 2);
  assert.equal(deathSavesInMinutes(1), MOST_SAVES_TO_SETTLE);
  assert.equal(deathSavesInMinutes(600), MOST_SAVES_TO_SETTLE);
});

test("the fallen are left alone only when nobody on the party's side is conscious", () => {
  const dying = { currentHp: 0, deathSaves: freshDeathTrack(), conditions: ["unconscious", "prone"] };
  const stable = { currentHp: 0, deathSaves: { ...freshDeathTrack(), stable: true }, conditions: ["unconscious"] };
  const standing = { currentHp: 9, deathSaves: null, conditions: [] };
  const asleep = { currentHp: 9, deathSaves: null, conditions: ["Unconscious"] };
  assert.equal(isDying(dying), true);
  assert.equal(isDying(stable), false);
  assert.deepEqual(dyingLeftAlone([dying, stable]), [dying]);
  assert.deepEqual(dyingLeftAlone([dying, asleep]), [dying]);
  assert.deepEqual(dyingLeftAlone([dying, standing]), []);
});

console.log(`test-death-logic: ${passed} tests passed.`);
