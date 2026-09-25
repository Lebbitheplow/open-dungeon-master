// A DM turn that ends with no narration: the table is told why. A refused
// player action gives its reason, a loosely written spell gets told what it
// was missing, and nothing leaks from the DM's other tools.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { EMPTY_TURN_LINE, emptyTurnLine } = await import("../src/lib/dm/empty-turn.ts");
const { notReadyReason } = await import("../src/lib/srd/spell-prep.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const call = (id, name) => ({
  role: "assistant",
  content: "",
  tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
});
const result = (id, body) => ({ role: "tool", tool_call_id: id, content: JSON.stringify(body) });

const LEVELS = { ambush: 1, "fire bolt": 0, shield: 1 };
const mage = (text) => ({
  text,
  spells: ["Fire Bolt", "Ambush", "Shield"],
  levelOf: (spell) => LEVELS[spell.toLowerCase()] ?? null,
  notReady: () => null,
});

test("a refused spell says why, first sentence only", () => {
  const line = emptyTurnLine([
    call("a", "cast_buff"),
    result("a", {
      error: 'No content pack knows "Guardian Angel". If it grants an effect, apply it with set_condition.',
    }),
  ]);
  assert.match(line, /^The DM could not resolve that: No content pack knows "Guardian Angel"\. You can/);
  assert.ok(!line.includes("set_condition"));
});

test("the last refusal wins, and beats reading the message", () => {
  const line = emptyTurnLine(
    [
      call("a", "use_spell_slot"),
      result("a", { error: "No level 3 slot left." }),
      call("b", "cast_buff"),
      result("b", { error: "Bless is not on Ada's spell list; they cannot cast it." }),
    ],
    mage("use the ambush spell"),
  );
  assert.match(line, /Bless is not on Ada's spell list/);
});

test("'use the ambush spell' is told to give the slot level and the target", () => {
  const line = emptyTurnLine([], mage("use the ambush spell"));
  assert.match(line, /could not resolve Ambush: say the slot level \(level 1 or higher\) and who or what you cast it on/);
  assert.match(line, /"I cast Ambush using a level 1 slot on myself\."/);
});

test("a cantrip is never asked for a slot", () => {
  const line = emptyTurnLine([], mage("cast fire bolt"));
  assert.ok(!line.includes("slot level"));
  assert.match(line, /who or what you cast it on/);
});

test("a spell cast with slot and target asks only for a retry", () => {
  const line = emptyTurnLine([], mage("I cast Shield using a level 1 slot on myself"));
  assert.match(line, /could not resolve Shield\. Try again/);
});

test("an unknown spell asks for the name on the sheet", () => {
  const line = emptyTurnLine([], mage("cast guardian angel"));
  assert.match(line, /could not tell which spell you meant/);
});

test("a spell waiting for the long rest says so", () => {
  const player = { ...mage("cast ambush"), notReady: (spell) => `${spell} is chosen but not prepared yet.` };
  assert.equal(emptyTurnLine([], player), "The DM could not resolve that: Ambush is chosen but not prepared yet.");
});

test("anything else gets a plain hint, and no player keeps the old line", () => {
  assert.match(emptyTurnLine([], mage("I open the door")), /Try again saying plainly what your character does/);
  assert.equal(emptyTurnLine([call("a", "reveal_item"), result("a", { error: "The ring is a mimic." })]), EMPTY_TURN_LINE);
  assert.equal(emptyTurnLine([]), EMPTY_TURN_LINE);
});

test("a spell waiting for the rest or only in the book is named as such", () => {
  const casting = {
    ability: "int",
    slots: {},
    known: [],
    prepared: ["Shield"],
    cantrips: [],
    pending: ["Sleep"],
    spellbook: ["Shield", "Sleep", "Identify"],
  };
  assert.match(notReadyReason(casting, "sleep"), /after the next long rest/);
  assert.match(notReadyReason(casting, "Identify"), /in the spellbook but not prepared/);
  assert.equal(notReadyReason(casting, "Fireball"), null);
  // Shield is written in the book AND prepared: it is ready, not blocked.
  assert.equal(notReadyReason(casting, "shield"), null);
});

console.log(`test-empty-turn: ${passed} tests passed.`);
