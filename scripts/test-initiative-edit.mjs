// Editing the initiative order by hand. The interesting part is not the
// splicing, it is that the pointer follows the combatant it was on rather
// than the slot number, and that it only ever rests on a player character.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { applyInitiativeEdit, orderEntryId } = await import("../src/lib/dm/initiative-edit.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const pc = (name, initiative) => ({
  kind: "pc",
  characterId: `pc-${name}`,
  userId: `user-${name}`,
  name,
  initiative,
});
const enemy = (name, initiative) => ({ kind: "enemy", enemyId: `enemy-${name}`, name, initiative });

// Bree 18, Goblin 14, Ash 11, Wolf 7. The pointer starts on Bree.
function fight(turnIndex = 0, round = 1) {
  return {
    order: [pc("Bree", 18), enemy("Goblin", 14), pc("Ash", 11), enemy("Wolf", 7)],
    turnIndex,
    round,
  };
}
const names = (state) => state.order.map((entry) => entry.name);

test("a nudge moves one slot and the pointer stays with its combatant", () => {
  const outcome = applyInitiativeEdit(fight(2), { op: "move", id: "pc-Ash", direction: "up" });
  assert.deepEqual(names(outcome.state), ["Bree", "Ash", "Goblin", "Wolf"]);
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Ash");
});

test("moving somebody else past the current turn does not steal it", () => {
  const outcome = applyInitiativeEdit(fight(2), { op: "move", id: "enemy-Goblin", direction: "down" });
  assert.deepEqual(names(outcome.state), ["Bree", "Ash", "Goblin", "Wolf"]);
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Ash");
});

test("the top of the order cannot be nudged higher", () => {
  const outcome = applyInitiativeEdit(fight(), { op: "move", id: "pc-Bree", direction: "up" });
  assert.ok("error" in outcome);
  assert.match(outcome.error, /already at the top/i);
});

test("removing a combatant leaves the pointer somewhere legal", () => {
  const outcome = applyInitiativeEdit(fight(0), { op: "remove", id: "pc-Bree" });
  assert.deepEqual(names(outcome.state), ["Goblin", "Ash", "Wolf"]);
  // The pointer cannot rest on the goblin, so it walks on to Ash.
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Ash");
});

test("a combatant who is not in the order cannot be edited", () => {
  const outcome = applyInitiativeEdit(fight(), { op: "remove", id: "pc-Nobody" });
  assert.ok("error" in outcome);
  assert.match(outcome.error, /not in the initiative order/i);
});

test("an inserted NPC slots by its count and carries no stat block", () => {
  const outcome = applyInitiativeEdit(fight(), {
    op: "insert",
    id: "npc:captain",
    name: "Captain Vell",
    initiative: 13,
  });
  assert.deepEqual(names(outcome.state), ["Bree", "Goblin", "Captain Vell", "Ash", "Wolf"]);
  const inserted = outcome.state.order[2];
  assert.equal(inserted.kind, "npc");
  assert.equal(orderEntryId(inserted), "npc:captain");
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Bree");
});

test("an unnamed insert is refused", () => {
  const outcome = applyInitiativeEdit(fight(), {
    op: "insert",
    id: "npc:blank",
    name: "   ",
    initiative: 12,
  });
  assert.ok("error" in outcome);
  assert.match(outcome.error, /needs a name/i);
});

test("delaying drops a combatant to the bottom and passes the turn on", () => {
  const outcome = applyInitiativeEdit(fight(0), { op: "delay", id: "pc-Bree" });
  assert.deepEqual(names(outcome.state), ["Goblin", "Ash", "Wolf", "Bree"]);
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Ash");
  assert.equal(outcome.state.order[3].initiative, 6);
});

test("delaying somebody who is not acting leaves the turn where it is", () => {
  const outcome = applyInitiativeEdit(fight(2), { op: "delay", id: "enemy-Goblin" });
  assert.deepEqual(names(outcome.state), ["Bree", "Ash", "Wolf", "Goblin"]);
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Ash");
});

test("stepping forward walks past everything that is not a player", () => {
  const outcome = applyInitiativeEdit(fight(0), { op: "step", direction: "forward" });
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Ash");
  assert.equal(outcome.state.round, 1);
});

test("stepping forward off the end starts the next round", () => {
  const outcome = applyInitiativeEdit(fight(2), { op: "step", direction: "forward" });
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Bree");
  assert.equal(outcome.state.round, 2);
});

test("stepping back off the top returns to the previous round", () => {
  const outcome = applyInitiativeEdit(fight(0, 3), { op: "step", direction: "back" });
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Ash");
  assert.equal(outcome.state.round, 2);
});

test("the round counter never falls below one", () => {
  const outcome = applyInitiativeEdit(fight(0, 1), { op: "step", direction: "back" });
  assert.equal(outcome.state.round, 1);
});

test("a fight with nobody but monsters left cannot be stepped through", () => {
  const outcome = applyInitiativeEdit(
    { order: [enemy("Goblin", 14), enemy("Wolf", 7)], turnIndex: 0, round: 1 },
    { op: "step", direction: "forward" },
  );
  assert.ok("error" in outcome);
});

test("the turn can be handed to a player, but only to a player", () => {
  const handed = applyInitiativeEdit(fight(0), { op: "goto", id: "pc-Ash" });
  assert.equal(handed.state.order[handed.state.turnIndex].name, "Ash");
  assert.equal(handed.state.round, 1);

  const refused = applyInitiativeEdit(fight(0), { op: "goto", id: "enemy-Goblin" });
  assert.ok("error" in refused);
  assert.match(refused.error, /yours to run/i);
});

test("handing the turn to whoever already has it says so", () => {
  const outcome = applyInitiativeEdit(fight(0), { op: "goto", id: "pc-Bree" });
  assert.ok("error" in outcome);
  assert.match(outcome.error, /already/i);
});

test("a corrected initiative re-sorts and is clamped to something sane", () => {
  const outcome = applyInitiativeEdit(fight(0), {
    op: "set-initiative",
    id: "pc-Ash",
    initiative: 20,
  });
  assert.deepEqual(names(outcome.state), ["Ash", "Bree", "Goblin", "Wolf"]);
  assert.equal(outcome.state.order[outcome.state.turnIndex].name, "Bree");

  const clamped = applyInitiativeEdit(fight(0), {
    op: "set-initiative",
    id: "pc-Ash",
    initiative: 9999,
  });
  assert.equal(clamped.state.order[0].initiative, 50);
});

test("the last combatant standing cannot be removed", () => {
  const outcome = applyInitiativeEdit(
    { order: [pc("Bree", 18)], turnIndex: 0, round: 1 },
    { op: "remove", id: "pc-Bree" },
  );
  assert.ok("error" in outcome);
});

test("every edit hands back a sentence the table can read", () => {
  const outcome = applyInitiativeEdit(fight(0), { op: "delay", id: "pc-Bree" });
  assert.match(outcome.note, /Bree delays/);
});

console.log(`initiative-edit: ${passed} tests passed`);
