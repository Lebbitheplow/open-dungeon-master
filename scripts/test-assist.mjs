// The DM's assist rail: turning what a player said into a shortlist of
// adjudications, and reading back what the model proposed.
//
// The catalog is imported for real, so this also fails if an entry the
// ranking leans on is renamed out from under it.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { intentTokens, parseSuggestionJson, rankAdjudications, synonymKeys } = await import(
  "../src/lib/dm/assist-logic.ts"
);
const { ADJUDICATIONS } = await import("../src/lib/dm/invoke-catalog.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const names = (intent, options = {}) =>
  rankAdjudications(intent, ADJUDICATIONS, options).map(({ entry }) => entry.name);

test("common words are not evidence of anything", () => {
  assert.deepEqual(intentTokens("I want to go into the room"), ["room"]);
  assert.deepEqual(intentTokens(""), []);
});

test("what a player says reaches the tool, not the tool's own vocabulary", () => {
  // Nobody types "resolve a player attack"; they type this.
  assert.ok(names("I stab the goblin with my shortsword").includes("pc_attack"));
  assert.ok(names("Can I sneak past the guard?").includes("request_roll"));
  assert.ok(names("I cast a spell at the ogre").includes("cast_at_enemy"));
  assert.ok(names("We make camp for the night").includes("take_rest"));
});

test("every synonym key is a real adjudication", () => {
  // A renamed tool would drop out of the shortlist silently, which is worse
  // than a missing button because nothing looks wrong.
  const known = new Set(ADJUDICATIONS.map((entry) => entry.name));
  for (const key of synonymKeys()) {
    assert.ok(known.has(key), `${key} has synonyms but is not in the catalog`);
  }
});

test("an empty intent proposes nothing rather than guessing", () => {
  assert.deepEqual(names(""), []);
  assert.deepEqual(names("the a of"), []);
});

test("fight tools are not proposed when there is no fight", () => {
  const combatOnly = ADJUDICATIONS.filter((entry) => entry.needsEncounter).map(
    (entry) => entry.name,
  );
  assert.ok(combatOnly.length > 0, "the catalog has no encounter-gated entries");
  const suggested = names("I attack the bandit", { inEncounter: false });
  for (const name of suggested) {
    assert.ok(!combatOnly.includes(name), `${name} needs an encounter and was still proposed`);
  }
});

test("the shortlist stays short", () => {
  assert.ok(names("I attack and roll and cast and move and heal").length <= 5);
  assert.equal(names("I attack the goblin", { limit: 2 }).length <= 2, true);
});

test("a model's JSON pick is read, fences and all", () => {
  const parsed = parseSuggestionJson(
    'Sure!\n```json\n{"name": "request_roll", "args": {"kind": "skill_check"}, "why": "to spot the trap"}\n```',
  );
  assert.equal(parsed.name, "request_roll");
  assert.deepEqual(parsed.args, { kind: "skill_check" });
  assert.equal(parsed.why, "to spot the trap");
});

test("unusable JSON is null, because the shortlist is already on screen", () => {
  assert.equal(parseSuggestionJson("no json here"), null);
  assert.equal(parseSuggestionJson('{"args": {}}'), null);
  assert.equal(parseSuggestionJson('{"name": "x", "args": [1,2]}').args !== null, true);
  assert.deepEqual(parseSuggestionJson('{"name": "x", "args": [1,2]}').args, {});
});

console.log(`assist: ${passed} tests passed`);
