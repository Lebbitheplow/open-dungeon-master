// The DM's assist rail: what a player said turned into a shortlist of
// adjudications ranked by meaning, and what the model proposed read back.
// The ranking reads only vector order, so here it is fed hand-made vectors;
// the embedder and the model are exercised against fakes in
// test-table-language-calls.mjs.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { availableEntries, catalogEntryText, parseSuggestionJson, rankBySimilarity } = await import(
  "../src/lib/dm/assist-logic.ts"
);
const { ADJUDICATIONS } = await import("../src/lib/dm/invoke-catalog.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const unit = (...values) => {
  const length = Math.hypot(...values);
  return Float32Array.from(values.map((value) => value / length));
};

test("an entry is embedded as its name in words, its label and its summary", () => {
  const attack = ADJUDICATIONS.find((entry) => entry.name === "pc_attack");
  const text = catalogEntryText(attack);
  assert.ok(text.startsWith("pc attack: "));
  assert.ok(text.includes(attack.label) && text.includes(attack.summary));
});

test("fight tools are not offered when there is no fight", () => {
  const combatOnly = ADJUDICATIONS.filter((entry) => entry.needsEncounter);
  assert.ok(combatOnly.length > 0, "the catalog has no encounter-gated entries");
  const calm = availableEntries(ADJUDICATIONS, false);
  assert.ok(calm.every((entry) => !entry.needsEncounter));
  assert.equal(availableEntries(ADJUDICATIONS, true).length, ADJUDICATIONS.length);
});

test("the nearest entries come first, the list stays short, and ties keep catalog order", () => {
  const [a, b, c, d] = ADJUDICATIONS;
  const vectors = new Map([
    [a.name, unit(0, 1)],
    [b.name, unit(1, 0.1)],
    [c.name, unit(1, 0.1)],
    [d.name, unit(1, 0)],
  ]);
  const ranked = rankBySimilarity(unit(1, 0), [a, b, c, d], vectors, 3).map((entry) => entry.name);
  assert.deepEqual(ranked, [d.name, b.name, c.name]);
  // An entry with no vector is never ranked.
  assert.deepEqual(rankBySimilarity(unit(1, 0), [a, b], new Map([[a.name, unit(0, 1)]]), 5).map((entry) => entry.name), [a.name]);
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
