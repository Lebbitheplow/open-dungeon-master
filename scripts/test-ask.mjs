// Ask: reply parsing (with the scope an "auto" answer names), and a
// source-level guard that the evidence builder cannot leak DM secrets.
// Nothing routes a question by its words any more: the evidence an "auto"
// question gets, and the archive search the model may ask for, are pinned
// against a fake model in test-table-language-calls.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUESTION_MAX_CHARS,
  clampQuestion,
  isAskScope,
  parseAskJson,
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

test("parseAskJson reads a clean reply", () => {
  const parsed = parseAskJson(
    '{"answer":"Marla is the steward.","citations":[{"kind":"fact","ref":"fact:ab12","quote":"Marla holds the vault key."}]}',
    "story",
  );
  assert.equal(parsed.answer, "Marla is the steward.");
  assert.equal(parsed.citations.length, 1);
  assert.equal(parsed.citations[0].kind, "fact");
});

test("parseAskJson survives code fences and surrounding prose", () => {
  // A small utility model wraps its JSON more often than a large one.
  const fenced = parseAskJson('```json\n{"answer":"Yes.","citations":[]}\n```', "rules");
  assert.equal(fenced.answer, "Yes.");
  const chatty = parseAskJson('Sure! {"answer":"Yes.","citations":[]} Hope that helps.', "rules");
  assert.equal(chatty.answer, "Yes.");
});

test("parseAskJson rejects unusable replies", () => {
  assert.equal(parseAskJson("", "story"), null);
  assert.equal(parseAskJson("no json at all", "story"), null);
  assert.equal(parseAskJson("{not valid json}", "story"), null);
  assert.equal(parseAskJson('{"citations":[]}', "story"), null, "an answerless reply is unusable");
  assert.equal(parseAskJson('{"answer":"   "}', "story"), null);
});

test("parseAskJson drops malformed citations but keeps the answer", () => {
  const parsed = parseAskJson(
    '{"answer":"Yes.","citations":[{"kind":"fact"},{"quote":"kept"},"junk",null]}',
    "story",
  );
  assert.equal(parsed.answer, "Yes.");
  assert.equal(parsed.citations.length, 1);
  assert.equal(parsed.citations[0].quote, "kept");
  // A citation with no kind still gets a usable label.
  assert.equal(parsed.citations[0].kind, "record");
});

test("an answer keeps the scope asked for; an auto answer takes the one it names, and is unusable without one", () => {
  assert.equal(parseAskJson('{"answer":"Yes.","scope":"rules"}', "sheet").scope, "sheet");
  assert.equal(parseAskJson('{"answer":"Sì.","scope":"rules","citations":[]}', "auto").scope, "rules");
  assert.equal(parseAskJson('{"answer":"Sì.","citations":[]}', "auto"), null);
  assert.equal(parseAskJson('{"answer":"Sì.","scope":"weather"}', "auto"), null);
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
