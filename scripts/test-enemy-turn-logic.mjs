// An enemy's turn record (issue #621, src/lib/dm/enemy-turn-logic.ts) and
// the flight a turned or fleeing creature makes (src/lib/dm/flee-logic.ts).
// Pure: no database.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const turns = await import("../src/lib/dm/enemy-turn-logic.ts");
const flee = await import("../src/lib/dm/flee-logic.ts");
const { normalizeLegendaryState } = await import("../src/lib/dm/legendary-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const fight = (round = 2) => ({ round, legendary: {} });

test("a Dash adds the speed once more, each Dash again, and walking spends it", () => {
  assert.equal(turns.enemyTilesLeft(6, {}, 0), 6);
  assert.equal(turns.enemyTilesLeft(6, { dashes: 1 }, 0), 12);
  assert.equal(turns.enemyTilesLeft(6, { dashes: 2 }, 4), 14);
  assert.equal(turns.enemyTilesLeft(6, { dashes: 1 }, 20), 0, "never below nothing");
});

test("a speed of 0 is 0 however many Dashes it took", () => {
  assert.equal(turns.enemyTilesLeft(0, { dashes: 3, carried: 4 }, 0), 0);
});

test("the record belongs to the round it was written in; another round reads empty", () => {
  const encounter = fight(2);
  turns.recordEnemyTurn(encounter, "g1", { dashes: 1, spentOn: "dash" });
  assert.deepEqual(turns.enemyTurnEntry(encounter, "g1"), { dashes: 1, spentOn: "dash" });
  assert.deepEqual(turns.enemyTurnEntry(encounter, "g2"), {});
  encounter.round = 3;
  assert.deepEqual(turns.enemyTurnEntry(encounter, "g1"), {});
  // Writing in the new round drops the old round's entries.
  turns.recordEnemyTurn(encounter, "g2", { disengaged: true });
  assert.deepEqual(encounter.legendary.turns, { round: 3, byId: { g2: { disengaged: true } } });
});

test("a later write adds to the entry; a turn starting forgets it", () => {
  const encounter = fight();
  turns.recordEnemyTurn(encounter, "g1", { disengaged: true });
  turns.recordEnemyTurn(encounter, "g1", { dashes: 1 });
  assert.deepEqual(turns.enemyTurnEntry(encounter, "g1"), { dashes: 1, disengaged: true });
  turns.recordEnemyTurn(encounter, "g2", { dashes: 1 });
  turns.forgetEnemyTurns(encounter, ["g1", "pc-1"]);
  assert.deepEqual(turns.enemyTurnEntry(encounter, "g1"), {});
  assert.deepEqual(turns.enemyTurnEntry(encounter, "g2"), { dashes: 1 });
  turns.forgetEnemyTurns(encounter, ["g2"]);
  assert.equal(encounter.legendary.turns, undefined, "nothing left, nothing stored");
});

test("a stored record survives the legendary state's save, and junk in it does not", () => {
  const stored = normalizeLegendaryState({
    pools: {},
    turns: { round: 4, byId: { g1: { dashes: 2, disengaged: true, spentOn: "dash", carried: 3, hasteUsed: true }, g2: { dashes: -1, spentOn: "fireball", disengaged: "yes" }, g3: "nonsense" } },
  });
  assert.deepEqual(stored.turns, { round: 4, byId: { g1: { dashes: 2, disengaged: true, spentOn: "dash", carried: 3, hasteUsed: true } } });
  assert.equal(normalizeLegendaryState({ pools: {} }).turns, undefined, "an encounter saved before the record reads as none");
  assert.equal(normalizeLegendaryState({ turns: "x" }).turns, undefined);
});

test("an attack refused after a Dash says the Dash spent the action", () => {
  assert.equal(
    turns.spentOnSentence("Goblin 1", "dash"),
    "Goblin 1 took the Dash action this turn: its action is spent, so it makes no attack with it. It can still move, or use a bonus action or reaction.",
  );
  assert.match(turns.spentOnSentence("Zombie", "escape"), /^Zombie spent its action trying to escape this turn/);
});

test("the reply's movement line and the out-of-movement words name the board's count and the Dashes", () => {
  assert.equal(turns.movementLeftLine(12), "Movement left this turn: 60 ft, counted by the board.");
  assert.equal(turns.speedWords(6, {}), "speed 30 ft");
  assert.equal(turns.speedWords(6, { dashes: 1 }), "speed 30 ft, 60 ft with its Dash");
  assert.equal(turns.speedWords(6, { dashes: 2 }), "speed 30 ft, 90 ft with its 2 Dashes");
});

test("a Dash closing an owed turn carries what that turn left, so the two turns walk three speeds", () => {
  // Walked 2 of its 6 squares on the owed turn, then Dashed: 4 left of the
  // owed turn, the Dash's 6, the own turn's 6.
  const carried = turns.owedTurnCarry(6, {}, 2, true);
  assert.deepEqual(carried, { dashes: 1, carried: 4 });
  assert.equal(turns.enemyTilesLeft(6, carried, 0), 16);
  // A Disengage closing it carries the same, without the Dash's speed, and
  // keeps the Disengage for the walk after it.
  const disengaged = turns.owedTurnCarry(6, { disengaged: true }, 0, false);
  assert.deepEqual(disengaged, { carried: 6, disengaged: true });
  assert.equal(turns.enemyTilesLeft(6, disengaged, 0), 12);
});

test("Aggressive's speed takes only steps that do not end farther from the nearest hostile", () => {
  const foe = { x: 10, y: 0 };
  const nearest = (at) => Math.max(Math.abs(at.x - foe.x), Math.abs(at.y - foe.y));
  const west = [{ x: 4, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 0 }];
  // Its own movement pays for the first two steps; the third is Aggressive's and leads away.
  assert.deepEqual(turns.towardSteps({ x: 5, y: 0 }, west, 2, nearest), west.slice(0, 2));
  assert.deepEqual(turns.towardSteps({ x: 5, y: 0 }, west, 0, nearest), []);
  const east = [{ x: 6, y: 0 }, { x: 7, y: 1 }, { x: 8, y: 1 }];
  assert.deepEqual(turns.towardSteps({ x: 5, y: 0 }, east, 0, nearest), east, "sideways at the same distance is still toward");
});

test("only Dash, Disengage, Dodge and Escape are an enemy's take_action", () => {
  assert.deepEqual([...turns.ENEMY_TAKE_ACTIONS], ["dash", "disengage", "dodge", "escape"]);
  assert.equal(turns.isEnemyTakeAction("dash"), true);
  assert.equal(turns.isEnemyTakeAction("help"), false);
  assert.equal(turns.isEnemyTakeAction("hide"), false);
});

test("turned and fleeing creatures run; a calmed one holds unless it also runs", () => {
  assert.equal(flee.fleeHold(["turned"]), "turned");
  assert.equal(flee.fleeHold(["frightened", "fleeing"]), "fleeing");
  assert.equal(flee.fleeHold(["frightened"]), null, "frightened alone only keeps it from coming closer");
  assert.equal(flee.fleeHold(["turned by sanctuary"]), null, "Sanctuary's turning is another condition");
  assert.equal(flee.holdsCalm(["calmed"]), true);
  assert.equal(flee.holdsCalm(["calmed", "fleeing"]), false);
  assert.equal(flee.holdsCalm([]), false);
});

test("a fleeing creature runs to the reachable square farthest from what it flees, never nearer", () => {
  const from = { x: 5, y: 5 };
  const source = { x: 4, y: 5 };
  const squares = [
    { x: 6, y: 5, cost: 1 },
    { x: 9, y: 5, cost: 4 },
    { x: 9, y: 6, cost: 5 },
    { x: 3, y: 5, cost: 2 },
  ];
  assert.deepEqual(flee.farthestFrom(from, source, squares), { x: 9, y: 5, cost: 4 }, "the cheaper of two equally far");
  assert.equal(flee.farthestFrom(from, source, [{ x: 4, y: 4, cost: 1 }, { x: 5, y: 6, cost: 1 }]), null, "cornered: nowhere farther");
});

console.log(`test-enemy-turn-logic: ${passed} passed`);
