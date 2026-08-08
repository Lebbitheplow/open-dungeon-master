// Ask: scope inference, the archive-retrieval gate, reply parsing, and a
// source-level guard that the evidence builder cannot leak DM secrets.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUESTION_MAX_CHARS,
  clampQuestion,
  inferScope,
  isAskScope,
  parseAskJson,
  shouldSearchArchive,
} from "../src/lib/dm/ask-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("clampQuestion collapses whitespace and bounds length", () => {
  assert.equal(clampQuestion("  who   is\n\nMarla?  "), "who is Marla?");
  assert.equal(clampQuestion("x".repeat(900)).length, QUESTION_MAX_CHARS);
  assert.equal(clampQuestion("   "), "");
});

test("isAskScope rejects anything unexpected", () => {
  assert.ok(isAskScope("story") && isAskScope("rules") && isAskScope("sheet"));
  assert.ok(!isAskScope("auto"));
  assert.ok(!isAskScope(""));
  assert.ok(!isAskScope(undefined));
});

test("inferScope routes the three kinds of question", () => {
  assert.equal(inferScope("who was the woman at the shrine three chapters back?"), "story");
  assert.equal(inferScope("what happened to the vault?"), "story");
  assert.equal(inferScope("how does grappling work?"), "rules");
  assert.equal(inferScope("does my ranger read Draconic?"), "sheet");
  assert.equal(inferScope("what is my AC?"), "sheet");
  // Sheet beats rules: answer from the character who actually has the feature.
  assert.equal(inferScope("how does my Bardic Inspiration work?"), "sheet");
});

test("shouldSearchArchive spends retrieval only when there is something to find", () => {
  assert.ok(shouldSearchArchive("what did Marla promise us?"));
  assert.ok(shouldSearchArchive("what happened earlier with the vault?"));
  assert.ok(shouldSearchArchive("who owns the mill?"));
  // Pure rules lookups must not cost an embedding pass.
  assert.ok(!shouldSearchArchive("how does grappling work"));
  assert.ok(!shouldSearchArchive("what is my armor class"));
  // Forced by the caller.
  assert.ok(shouldSearchArchive("how does grappling work", true));
});

test("parseAskJson reads a clean reply", () => {
  const parsed = parseAskJson(
    '{"answer":"Marla is the steward.","citations":[{"kind":"fact","ref":"fact:ab12","quote":"Marla holds the vault key."}]}',
  );
  assert.equal(parsed.answer, "Marla is the steward.");
  assert.equal(parsed.citations.length, 1);
  assert.equal(parsed.citations[0].kind, "fact");
});

test("parseAskJson survives code fences and surrounding prose", () => {
  // A small utility model wraps its JSON more often than a large one.
  const fenced = parseAskJson('```json\n{"answer":"Yes.","citations":[]}\n```');
  assert.equal(fenced.answer, "Yes.");
  const chatty = parseAskJson('Sure! {"answer":"Yes.","citations":[]} Hope that helps.');
  assert.equal(chatty.answer, "Yes.");
});

test("parseAskJson rejects unusable replies", () => {
  assert.equal(parseAskJson(""), null);
  assert.equal(parseAskJson("no json at all"), null);
  assert.equal(parseAskJson("{not valid json}"), null);
  assert.equal(parseAskJson('{"citations":[]}'), null, "an answerless reply is unusable");
  assert.equal(parseAskJson('{"answer":"   "}'), null);
});

test("parseAskJson drops malformed citations but keeps the answer", () => {
  const parsed = parseAskJson(
    '{"answer":"Yes.","citations":[{"kind":"fact"},{"quote":"kept"},"junk",null]}',
  );
  assert.equal(parsed.answer, "Yes.");
  assert.equal(parsed.citations.length, 1);
  assert.equal(parsed.citations[0].quote, "kept");
  // A citation with no kind still gets a usable label.
  assert.equal(parsed.citations[0].kind, "record");
});

// A real end-to-end redaction test would need a seeded encrypted database,
// which nothing else in scripts/ does. This checks the same property at the
// source level instead, and it guards the exact edit that would leak: the
// difference between listFactsVisibleTo (scoped) and listActiveFacts (all
// facts, DM-only included) is one identifier.
test("the evidence builder cannot reach DM-only material", () => {
  const source = readFileSync(new URL("../src/lib/dm/ask.ts", import.meta.url), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  assert.ok(
    code.includes("listFactsVisibleTo"),
    "facts must be read through the visibility-scoped helper",
  );
  assert.ok(
    !code.includes("listActiveFacts"),
    "listActiveFacts returns DM-only secrets and must never be used here",
  );
  assert.ok(
    /listFactsVisibleTo\([^)]*false\s*\)/s.test(code),
    "includeDmSecrets must be passed false",
  );
  for (const forbidden of ["dmOutline", "storyArc", "worldArcs", "enemies", "agency"]) {
    assert.ok(
      !code.includes(forbidden),
      `${forbidden} is DM-side material and must not reach an Ask answer`,
    );
  }
});

console.log(`test-ask: ${passed} tests passed`);
