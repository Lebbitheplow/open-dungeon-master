// The lines the table reads for a creature turn the server plays (issue
// #666): every creature gets its attack or a plain reason, never the tool
// text written for the model, and an attack with no swings says what
// happened instead of "()". Pure: no database, no server.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { attackLine, attackStopOf, standStillLine, stillFromStop, tableName } = await import("../src/lib/dm/turn-lines-logic.ts");

// Every reason reads as a sentence naming the creature, with no tool name in it.
const reasons = [
  [{ why: "incapacitated", by: "stunned" }, "Goblin 2 is stunned and cannot act this turn."],
  [{ why: "surprised" }, "Goblin 2 is caught by surprise and does nothing this round."],
  [{ why: "no_foe" }, "Goblin 2 has no one left to fight."],
  [{ why: "reach", target: "Kara", closedIn: true }, "Goblin 2 closes in on Kara but cannot reach them this turn."],
  [{ why: "reach", target: "Kara", closedIn: false }, "Goblin 2 cannot reach Kara this turn."],
  [{ why: "range", target: "Kara", closedIn: true }, "Goblin 2 moves for a shot at Kara but is still out of range."],
  [{ why: "range", target: "Kara", closedIn: false }, "Goblin 2 cannot get Kara within range this turn."],
  [{ why: "sight", target: "Kara", closedIn: false }, "Goblin 2 has no clear line to Kara this turn."],
  [{ why: "fear", target: "Kara", closedIn: false }, "Goblin 2 is too frightened to close in on Kara."],
  [{ why: "held", holder: "Bren" }, "Goblin 2 does not close in while Bren holds a readied action."],
  [{ why: "calmed", by: "calmed" }, "Goblin 2 is calmed and makes no attack."],
  [{ why: "said", line: "Goblin 2 obeys Command (halt) this turn." }, "Goblin 2 obeys Command (halt) this turn."],
  [{ why: "no_target" }, "Goblin 2 finds no one it can attack this turn."],
  [{ why: "waiting" }, "Goblin 2's turn has not come yet."],
  [{ why: "other" }, "Goblin 2 does not attack this turn."],
];
for (const [still, line] of reasons) {
  assert.equal(standStillLine("Goblin 2", still), line);
  assert.doesNotMatch(line, /enemy_attack|take_action|move_token|retry|\u2014/);
}

// A tag reads as its reason; anything else is no tag.
assert.equal(attackStopOf("reach"), "reach");
assert.equal(attackStopOf("nonsense"), null);
assert.equal(attackStopOf(undefined), null);
assert.deepEqual(stillFromStop("reach", { target: "Kara", closedIn: true }), { why: "reach", target: "Kara", closedIn: true });
assert.deepEqual(stillFromStop("held", { target: "Kara", closedIn: false, holder: "Bren" }), { why: "held", holder: "Bren" });
assert.deepEqual(stillFromStop("calmed", { target: "Kara", closedIn: false }), { why: "other" }, "no word for the hold, no claim about it");
assert.deepEqual(stillFromStop("target", { target: "Kara", closedIn: false }), { why: "no_target" });
assert.deepEqual(stillFromStop("turn", { target: "Kara", closedIn: false }), { why: "waiting" });

// An attack: each swing, and the fall.
assert.equal(
  attackLine({ name: "Goblin 1", target: "Kara", attack: "Scimitar", swings: [{ rolled: 17, hit: true, damage: 5 }, { rolled: 4, hit: false }], vsAc: 15, fell: false }),
  "Goblin 1 attacks Kara with Scimitar (17 vs AC 15: HIT for 5; 4 vs AC 15: miss).",
);
assert.equal(
  attackLine({ name: "Ogre", target: "Kara", attack: "Greatclub", swings: [{ rolled: 20, hit: true, damage: 19, crit: true }], vsAc: 15, fell: true }),
  "Ogre attacks Kara with Greatclub (20 vs AC 15: HIT for 19 (CRIT)). Kara falls!",
);
// A swing skipped or deflected is said, never "undefined vs AC".
const skipped = attackLine({ name: "Gnoll", target: "Kara", attack: "Bite, Spear", swings: [{ attack: "Bite", skipped: "Kara is out of this attack's reach" }, { attack: "Spear", rolled: 12, hit: false }], vsAc: 15, fell: false });
assert.ok(skipped.includes("Bite not made: Kara is out of this attack's reach"), skipped);
assert.doesNotMatch(skipped, /undefined/);
// No swings: the result's note, not "()".
assert.equal(
  attackLine({ name: "Goblin 1", target: "Kara", attack: "Scimitar", swings: [], vsAc: 15, fell: false, note: "Goblin 1 was struck down on its way to Kara and never made the attack." }),
  "Goblin 1 was struck down on its way to Kara and never made the attack.",
);
assert.equal(attackLine({ name: "Goblin 1", target: "Kara", attack: "Scimitar", swings: [], vsAc: 15, fell: false }), "Goblin 1 does not attack this turn.");

// One the GM keeps off the board is not named.
assert.equal(tableName("Goblin 3", true), "Someone unseen");
assert.equal(tableName("Goblin 3", false), "Goblin 3");

console.log("test-turn-lines-logic: ok");
