// What a foe brings from one fight into the next (issue #667): a raider
// knocked unconscious in one fight came into the next "Healthy" at full hit
// points. The rules, from SRD 5.1:
//   - Knocking a Creature Out: unconscious and stable; a stable creature
//     regains 1 hit point after 1d4 hours.
//   - Resting: a long rest is 8 hours, needs at least 1 hit point at its
//     start, gives back every hit point and one level of exhaustion, and a
//     creature has one in 24 hours.
//   - Durations count down (ten rounds to the minute) and end when they run
//     out; a condition that lasts until a long rest ends with it.
// Pure: no database.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { carriedState, carryConditions, foesAboutLine, longRestsIn, namesSurvivor, outcomeShare, owedXp, wakeHoursOf } = await import(
  "../src/lib/dm/foe-carry-logic.ts"
);
const { textKey } = await import("../src/lib/language/text-logic.ts");

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
}

const HOUR = 60;
const raider = (patch = {}) => ({
  displayName: "Raider 2",
  status: "alive",
  currentHp: 11,
  maxHp: 11,
  conditions: [],
  conditionMeta: {},
  stats: { traits: [] },
  ...patch,
});
const knockedOut = (hours) =>
  raider({ currentHp: 0, conditions: ["unconscious", "prone"], conditionMeta: { unconscious: { source: "knocked out", ...(hours ? { wakeAfterHours: hours } : {}) } } });

test("a foe who died in an earlier fight is refused, never brought back whole", () => {
  const out = carriedState(raider({ status: "dead", currentHp: 0 }), 0);
  assert.match(out.refused, /Raider 2 died in an earlier fight/);
});

test("a foe still knocked out comes in at 0 hit points, unconscious, prone and stable, its hours to waking counted down", () => {
  const out = carriedState(knockedOut(3), HOUR);
  assert.equal(out.currentHp, 0);
  assert.equal(out.knockedOut, true);
  assert.deepEqual(out.conditions, ["unconscious", "prone"]);
  assert.deepEqual(out.conditionMeta.unconscious, { source: "knocked out", wakeAfterHours: 2 });
  assert.match(out.line, /still knocked out.*about 2 hours/);
});

test("once its 1d4 hours have passed it has come to with 1 hit point, and is no longer unconscious", () => {
  const out = carriedState(knockedOut(2), 2 * HOUR);
  assert.equal(out.currentHp, 1);
  assert.equal(out.knockedOut, false);
  assert.equal(out.conditions.includes("unconscious"), false);
  assert.equal(out.rested, false);
});

test("a long rest after coming to gives back every hit point", () => {
  assert.equal(carriedState(knockedOut(2), 2 * HOUR + 8 * HOUR - 1).currentHp, 1, "the rest needs its 8 hours");
  const out = carriedState(knockedOut(2), 2 * HOUR + 8 * HOUR);
  assert.equal(out.currentHp, 11);
  assert.equal(out.rested, true);
});

test("a knock-out written before the hours were kept waits the longest the die allows", () => {
  assert.equal(wakeHoursOf({ unconscious: { source: "knocked out" } }), 4);
  assert.equal(carriedState(knockedOut(), 3 * HOUR).knockedOut, true);
  assert.equal(carriedState(knockedOut(), 4 * HOUR).currentHp, 1);
});

test("a fight whose end time was never kept reads as long ago: its creatures come back rested", () => {
  const out = carriedState({ ...knockedOut(2), conditions: ["unconscious", "prone", "exhaustion 3"] }, Number.POSITIVE_INFINITY);
  assert.equal(out.currentHp, 11);
  assert.deepEqual(out.conditions, []);
});

test("a row an old truce marked fled while it lay knocked out is still knocked out", () => {
  const out = carriedState({ ...knockedOut(2), status: "fled" }, 0);
  assert.equal(out.knockedOut, true);
  assert.equal(out.currentHp, 0);
});

test("a wounded foe keeps its wounds until a long rest, then is whole", () => {
  const hurt = raider({ currentHp: 4 });
  const soon = carriedState(hurt, 2 * HOUR);
  assert.equal(soon.currentHp, 4);
  assert.match(soon.line, /near death|bloodied/);
  assert.equal(carriedState(hurt, 8 * HOUR).currentHp, 11);
});

test("a creature that regenerates heals as the rounds pass, and a troll left down rises", () => {
  const troll = raider({ displayName: "Troll", maxHp: 84, currentHp: 0, stats: { regeneration: { amount: 10, stoppedBy: ["acid", "fire"] } } });
  assert.equal(carriedState({ ...troll, currentHp: 30 }, 0).currentHp, 30, "no time, no healing");
  assert.equal(carriedState({ ...troll, currentHp: 30 }, 1).currentHp, 84, "a minute is ten rounds of 10");
  assert.equal(carriedState(troll, 1).currentHp, 84);
});

test("a timed condition keeps what is left of it, ten rounds to the minute, and ends when it runs out", () => {
  const meta = { poisoned: { rounds: 100, source: "Poisoner" } };
  assert.deepEqual(carryConditions(["poisoned"], meta, 5, 0), { conditions: ["poisoned"], conditionMeta: { poisoned: { rounds: 50, source: "Poisoner" } } });
  assert.deepEqual(carryConditions(["poisoned"], meta, 10, 0), { conditions: [], conditionMeta: {} });
});

test("a condition with no lifetime of its own outside the fight, or one a spell laid, is dropped", () => {
  const out = carryConditions(
    ["prone", "grappled", "frightened", "restrained"],
    { grappled: { source: "e1" }, frightened: { untilTurnOf: "pc1" }, restrained: { rounds: 100, spell: "Web" } },
    0,
    0,
  );
  assert.deepEqual(out.conditions, []);
});

test("exhaustion is kept, one level less for each long rest; what lasts until a long rest ends with it", () => {
  const meta = { "max hp reduced (-7)": { untilLongRest: true } };
  assert.deepEqual(carryConditions(["exhaustion 2", "max hp reduced (-7)"], meta, 60, 0).conditions, ["exhaustion 2", "max hp reduced (-7)"]);
  assert.deepEqual(carryConditions(["exhaustion 2", "max hp reduced (-7)"], meta, 8 * HOUR, 1).conditions, ["exhaustion 1"]);
  assert.equal(longRestsIn(8 * HOUR - 1), 0);
  assert.equal(longRestsIn(8 * HOUR), 1);
  assert.equal(longRestsIn(8 * HOUR + 24 * HOUR), 2, "one long rest in 24 hours");
});

test("a fourth level of exhaustion halves the hit points a rest gives back", () => {
  const worn = raider({ currentHp: 2, maxHp: 20, conditions: ["exhaustion 5"] });
  assert.equal(carriedState(worn, 8 * HOUR).currentHp, 10, "exhaustion 4 after one rest: maximum halved");
});

test("XP: a fight won paid in full, a truce or a rout half, a party that fled nothing; a foe who comes back owes the rest", () => {
  assert.equal(outcomeShare("victory"), 1);
  assert.equal(outcomeShare("truce"), 0.5);
  assert.equal(outcomeShare("enemies_fled"), 0.5);
  assert.equal(outcomeShare("party_fled"), 0);
  assert.equal(owedXp(100, "victory"), 0);
  assert.equal(owedXp(100, "truce"), 50);
  assert.equal(owedXp(100, "party_fled"), 100);
});

test("a name brings back a survivor only when it is theirs alone and not the monster's own name", () => {
  const survivor = { displayName: "Raider 2", monsterName: "Bandit" };
  assert.equal(namesSurvivor({ monster: "bandit", name: "Raider 2" }, survivor, textKey), true);
  assert.equal(namesSurvivor({ monster: "Raider 2" }, survivor, textKey), true);
  assert.equal(namesSurvivor({ monster: "Raider 2", count: 2 }, survivor, textKey), false, "a count is fresh creatures");
  assert.equal(namesSurvivor({ monster: "Goblin" }, { displayName: "Goblin", monsterName: "Goblin" }, textKey), false, "a Goblin asked for is a fresh goblin");
});

test("GAME STATE names who is still about with the id that brings them back", () => {
  const line = foesAboutLine(
    [
      { enemyId: "e1", displayName: "Raider 2", status: "alive", currentHp: 0, maxHp: 11, conditions: ["unconscious"], conditionMeta: { unconscious: { source: "knocked out" } } },
      { enemyId: "e2", displayName: "Raider 3", status: "fled", currentHp: 3, maxHp: 11, conditions: [] },
    ],
    false,
  );
  assert.match(line, /Raider 2 \[enemyId=e1\] knocked out/);
  assert.match(line, /Raider 3 \[enemyId=e2\] fled, bloodied/);
  assert.match(line, /returning=<enemyId>/);
  assert.equal(foesAboutLine([], false), "");
});

console.log(`test-foe-carry: ${passed} passed`);
