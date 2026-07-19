// Prose roll-ask salvage: sentences like "Avery, make an Investigation
// check, DC 15" become synthetic request_roll calls with the meta-text
// stripped from narration.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { salvageProseRollAsks } = await import("../src/lib/dm/rolls.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const avery = { id: "c-avery", name: "Avery" };
const brom = { id: "c-brom", name: "Brom" };

function args(result, index = 0) {
  return JSON.parse(result.calls[index].rawArguments);
}

test("the exact live failure: bold skill check with DC", () => {
  const text =
    "Avery approaches, wiping dust off the casing. It's going to take some work.\n\n**Avery, make an Intelligence (Investigation) check, DC 15.**";
  const result = salvageProseRollAsks(text, [avery, brom]);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(args(result), {
    kind: "skill_check",
    characterId: "c-avery",
    skill: "investigation",
    dc: 15,
  });
  assert.ok(!result.text.includes("check"), result.text);
  assert.ok(!result.text.includes("**"), result.text);
  assert.ok(result.text.includes("wiping dust"), result.text);
});

test("saving throw with leading DC", () => {
  const result = salvageProseRollAsks(
    "The gas floods the corridor. Brom, make a DC 12 Constitution saving throw!",
    [avery, brom],
  );
  assert.equal(result.calls.length, 1);
  assert.deepEqual(args(result), {
    kind: "saving_throw",
    characterId: "c-brom",
    ability: "con",
    dc: 12,
  });
  assert.ok(result.text.includes("gas floods"));
});

test("bare ability check without skill", () => {
  const result = salvageProseRollAsks("Avery, make a Strength check, DC 10.", [avery, brom]);
  assert.deepEqual(args(result), {
    kind: "ability_check",
    characterId: "c-avery",
    ability: "str",
    dc: 10,
  });
});

test("solo campaign needs no name", () => {
  const result = salvageProseRollAsks("Roll a Stealth check, DC 13.", [avery]);
  assert.deepEqual(args(result), {
    kind: "skill_check",
    characterId: "c-avery",
    skill: "stealth",
    dc: 13,
  });
});

test("ambiguous target in multiplayer is skipped", () => {
  const result = salvageProseRollAsks("Make a Perception check, DC 12.", [avery, brom]);
  assert.equal(result.calls.length, 0);
  assert.ok(result.text.includes("Perception"));
});

test("initiative ask", () => {
  const result = salvageProseRollAsks("Weapons out! Roll initiative, Avery!", [avery, brom]);
  assert.deepEqual(args(result), { kind: "initiative", characterId: "c-avery" });
});

test("plain narration containing 'checks' is untouched", () => {
  const text = "The guard checks his list and waves you through. He makes a note of your name.";
  const result = salvageProseRollAsks(text, [avery]);
  assert.equal(result.calls.length, 0);
  assert.equal(result.text, text);
});

test("missing DC still salvages the check", () => {
  const result = salvageProseRollAsks("Avery, give me a Sleight of Hand check.", [avery, brom]);
  assert.deepEqual(args(result), {
    kind: "skill_check",
    characterId: "c-avery",
    skill: "sleight_of_hand",
  });
});

test("two asks in one reply both salvage", () => {
  const result = salvageProseRollAsks(
    "Avery, make a Dexterity saving throw, DC 14. Brom, make an Athletics check, DC 10.",
    [avery, brom],
  );
  assert.equal(result.calls.length, 2);
  assert.equal(args(result, 0).characterId, "c-avery");
  assert.equal(args(result, 1).characterId, "c-brom");
  assert.equal(result.text, "");
});

test("group check hits every named character", () => {
  const result = salvageProseRollAsks(
    "Avery and Brom, both of you make Stealth checks, DC 12.",
    [avery, brom],
  );
  assert.equal(result.calls.length, 2);
  assert.equal(args(result, 0).skill, "stealth");
  assert.equal(args(result, 1).characterId, "c-brom");
});

test("'everyone' targets the whole party", () => {
  const result = salvageProseRollAsks("Everyone make a Perception check, DC 13.", [avery, brom]);
  assert.equal(result.calls.length, 2);
  assert.deepEqual(
    result.calls.map((call) => JSON.parse(call.rawArguments).characterId).sort(),
    ["c-avery", "c-brom"],
  );
});

test("other skills and phrasings: nature, 'needs to'", () => {
  const result = salvageProseRollAsks("Brom needs to make a Nature check, DC 11.", [avery, brom]);
  assert.deepEqual(args(result), {
    kind: "skill_check",
    characterId: "c-brom",
    skill: "nature",
    dc: 11,
  });
});

test("empty and no-sheet inputs are inert", () => {
  assert.deepEqual(salvageProseRollAsks("", [avery]), { text: "", calls: [] });
  const text = "Make a Stealth check, DC 10.";
  assert.deepEqual(salvageProseRollAsks(text, []), { text, calls: [] });
});

console.log(`test-prose-rolls: ${passed} passed`);
