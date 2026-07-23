// Lore-check verdict parsing: strict shape, fence salvage, citation
// bounding, rewrite rules, and rejection of unusable replies.
import assert from "node:assert/strict";
import {
  isLoreCheckCategory,
  parseLoreCheckJson,
  LORE_CHECK_CATEGORIES,
} from "../src/lib/dm/lore-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("category guard", () => {
  assert.equal(LORE_CHECK_CATEGORIES.length, 5);
  assert.ok(isLoreCheckCategory("wrong_fact"));
  assert.ok(!isLoreCheckCategory("vibes"));
});

test("a clean contradicts verdict parses fully", () => {
  const parsed = parseLoreCheckJson(
    JSON.stringify({
      verdict: "contradicts",
      explanation: "Marla died in chapter 3.",
      citations: [
        { kind: "chapter", ref: "3", quote: "Marla fell at the bridge." },
        { kind: "fact", ref: "abc123", quote: "Marla is dead." },
      ],
      rewrite: "The innkeeper, remembering Marla, raises a quiet toast.",
    }),
  );
  assert.equal(parsed.verdict, "contradicts");
  assert.equal(parsed.citations.length, 2);
  assert.equal(parsed.citations[0].kind, "chapter");
  assert.ok(parsed.rewrite.includes("quiet toast"));
});

test("code fences and surrounding prose are salvaged", () => {
  const parsed = parseLoreCheckJson(
    'Here is my answer:\n```json\n{"verdict": "unsupported", "explanation": "No record of a dragon.", "citations": [], "rewrite": "The cave lies silent."}\n```',
  );
  assert.equal(parsed.verdict, "unsupported");
  assert.equal(parsed.rewrite, "The cave lies silent.");
});

test("a consistent verdict never carries a rewrite", () => {
  const parsed = parseLoreCheckJson(
    JSON.stringify({
      verdict: "consistent",
      explanation: "Matches the record.",
      citations: [],
      rewrite: "should be dropped",
    }),
  );
  assert.equal(parsed.verdict, "consistent");
  assert.equal(parsed.rewrite, null);
});

test("bad citations are dropped, valid ones bounded", () => {
  const parsed = parseLoreCheckJson(
    JSON.stringify({
      verdict: "contradicts",
      explanation: "x",
      citations: [
        { kind: "bogus", ref: "1", quote: "dropped" },
        { kind: "scene", quote: "" },
        ...Array.from({ length: 10 }, (_, index) => ({
          kind: "fact",
          ref: `f${index}`,
          quote: `quote ${index}`,
        })),
      ],
      rewrite: null,
    }),
  );
  assert.equal(parsed.citations.length, 5);
  assert.ok(parsed.citations.every((citation) => citation.kind === "fact"));
});

test("unusable replies return null", () => {
  assert.equal(parseLoreCheckJson("no json here"), null);
  assert.equal(parseLoreCheckJson('{"verdict": "maybe", "citations": []}'), null);
  assert.equal(parseLoreCheckJson(""), null);
});

test("empty rewrite string becomes null", () => {
  const parsed = parseLoreCheckJson(
    JSON.stringify({ verdict: "unsupported", explanation: "x", citations: [], rewrite: "  " }),
  );
  assert.equal(parsed.rewrite, null);
});

console.log(`${passed} lore check tests passed`);
