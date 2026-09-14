// After the fight (docs/vtt-parity-implementation-plan.md 4.2): damage
// dealt and taken per fighter, healing, kills, the crits, rounds and time.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { computeEncounterSummary, describeEncounterSummary } = await import("../src/lib/dm/encounter-summary.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const summary = computeEncounterSummary({
  outcome: "victory",
  rounds: 4,
  startedAt: "2026-09-13T10:00:00.000Z",
  endedAt: "2026-09-13T10:12:30.000Z",
  enemies: [{ status: "dead" }, { status: "dead" }, { status: "fled" }],
  sheets: [
    { id: "a", name: "Vex" },
    { id: "b", name: "Orla" },
  ],
  rolls: [
    { characterId: "a", kind: "damage", total: 12, applied: true, crit: null },
    { characterId: "a", kind: "damage", total: 9, applied: false, crit: null },
    { characterId: "a", kind: "attack", total: 25, crit: "nat20" },
    { characterId: "b", kind: "damage", total: 6, applied: true, crit: null },
    { characterId: "b", kind: "attack", total: 3, crit: "nat1" },
    { characterId: null, kind: "damage", total: 40, applied: true, crit: null },
  ],
  audits: [
    { characterId: "a", kind: "apply_damage", delta: { amount: 7 } },
    { characterId: "b", kind: "heal", delta: { amount: 5 } },
    { characterId: "b", kind: "apply_damage", delta: { amount: 3 } },
    { characterId: "zzz", kind: "apply_damage", delta: { amount: 99 } },
  ],
});

test("dealt counts only damage that landed, taken and healed come from the sheets", () => {
  const vex = summary.fighters.find((line) => line.name === "Vex");
  const orla = summary.fighters.find((line) => line.name === "Orla");
  assert.deepEqual([vex.dealt, vex.taken, vex.healed, vex.nat20s, vex.nat1s], [12, 7, 0, 1, 0]);
  assert.deepEqual([orla.dealt, orla.taken, orla.healed, orla.nat20s, orla.nat1s], [6, 3, 5, 0, 1]);
  assert.deepEqual(summary.totals, { dealt: 18, taken: 10, healed: 5, nat20s: 1, nat1s: 1 });
});

test("kills, fled, rounds and seconds are counted, and the line reads", () => {
  assert.equal(summary.kills, 2);
  assert.equal(summary.fled, 1);
  assert.equal(summary.rounds, 4);
  assert.equal(summary.seconds, 750);
  const line = describeEncounterSummary(summary);
  assert.match(line, /victory after 4 rounds/);
  assert.match(line, /18 damage dealt, 10 taken, 5 healed/);
  assert.match(line, /2 slain/);
  assert.match(line, /Vex struck hardest/);
});

console.log(`test-encounter-summary: ${passed} passed`);
