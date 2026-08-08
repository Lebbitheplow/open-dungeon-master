// Narration reroll: prompt assembly, guidance clamping, roll-marker-preserving
// content assembly, and the variant set's cap and index rules.
import assert from "node:assert/strict";
import {
  appendVariant,
  assembleVariantContent,
  buildRenarrateMessages,
  clampGuidance,
  extractFinalTake,
  replaceFinalNarration,
  resolveVariantIndex,
  seedVariants,
  stripTrailingNarration,
  EMPTY_NARRATION_FALLBACK,
  MAX_GUIDANCE_LENGTH,
  MAX_VARIANTS,
  RENARRATE_DIRECTIVE,
} from "../src/lib/dm/renarrate-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const ROLL_A = "11111111-1111-4111-8111-111111111111";
const ROLL_B = "22222222-2222-4222-8222-222222222222";

test("guidance is collapsed, trimmed, and clamped", () => {
  assert.equal(clampGuidance("  darker\n  and\tcolder  "), "darker and colder");
  assert.equal(clampGuidance(""), "");
  assert.equal(clampGuidance("x".repeat(500)).length, MAX_GUIDANCE_LENGTH);
});

test("only trailing assistant turns are stripped, never tool results", () => {
  const conversation = [
    { role: "system", content: "rules" },
    { role: "user", content: "I open the door." },
    { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
    { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
  ];
  assert.deepEqual(stripTrailingNarration(conversation), conversation);

  const withNarration = [...conversation, { role: "assistant", content: "The door groans." }];
  assert.equal(stripTrailingNarration(withNarration).length, 4);
  assert.equal(stripTrailingNarration(withNarration).at(-1).role, "tool");
});

test("the reroll prompt replays the current take, then the directive", () => {
  const conversation = [
    { role: "system", content: "rules" },
    { role: "user", content: "I open the door." },
  ];
  const plain = buildRenarrateMessages(conversation, "", "The door groans open.");
  assert.equal(plain.length, 4);
  assert.deepEqual(plain[2], { role: "assistant", content: "The door groans open." });
  assert.equal(plain[3].role, "user");
  assert.equal(plain[3].content, RENARRATE_DIRECTIVE);
  // The stored conversation itself is never mutated.
  assert.equal(conversation.length, 2);

  const guided = buildRenarrateMessages(conversation, "  make it   darker ", "Prose.");
  assert.ok(guided[3].content.startsWith(RENARRATE_DIRECTIVE));
  assert.ok(guided[3].content.endsWith("make it darker"));

  // Nothing to replay (an unknown take): the directive still stands alone.
  const bare = buildRenarrateMessages(conversation, "", "  ");
  assert.equal(bare.length, 3);
  assert.equal(bare[2].role, "user");
});

test("only the final narration segment is replaced", () => {
  assert.deepEqual(replaceFinalNarration(["one", "two"], "new"), ["one", "new"]);
  assert.deepEqual(replaceFinalNarration([], "new"), ["new"]);
  // An empty reply must not silently blank the narration.
  assert.deepEqual(replaceFinalNarration(["one"], "   "), ["one"]);
});

test("roll markers keep their exact position across variants", () => {
  const parts = ["The lock resists.", "It clicks open."];
  const rollIds = [ROLL_A, ROLL_B];
  const original = assembleVariantContent(parts, rollIds, "It clicks open.");
  assert.equal(
    original,
    `The lock resists.\n\n[roll:${ROLL_A}]\n[roll:${ROLL_B}]\n\nIt clicks open.`,
  );

  const variant = assembleVariantContent(parts, rollIds, "The tumblers fall.");
  assert.equal(
    variant,
    `The lock resists.\n\n[roll:${ROLL_A}]\n[roll:${ROLL_B}]\n\nThe tumblers fall.`,
  );
  // Same markers, same order, same count: only the prose differs.
  const markers = (text) => text.match(/\[roll:[0-9a-f-]{36}\]/g);
  assert.deepEqual(markers(original), markers(variant));
});

test("a single-segment turn puts its markers first, like finalize()", () => {
  const content = assembleVariantContent(["It clicks open."], [ROLL_A], "The tumblers fall.");
  assert.equal(content, `[roll:${ROLL_A}]\n\nThe tumblers fall.`);
});

test("a turn with no rolls is just the prose", () => {
  assert.equal(assembleVariantContent(["Old words."], [], "New words."), "New words.");
});

test("an all-empty assembly falls back to the waiting line", () => {
  assert.equal(assembleVariantContent([], [], "   "), EMPTY_NARRATION_FALLBACK);
});

test("the final take round-trips out of an assembled variant", () => {
  const cases = [
    { parts: ["Only part."], rolls: [] },
    { parts: ["Only part."], rolls: [ROLL_A] },
    { parts: ["First.", "Second."], rolls: [] },
    { parts: ["First.", "Second."], rolls: [ROLL_A, ROLL_B] },
  ];
  for (const { parts, rolls } of cases) {
    const content = assembleVariantContent(parts, rolls, "The tumblers fall.");
    assert.equal(extractFinalTake(parts, rolls, content), "The tumblers fall.");
  }
  // Content assembled some other way (a lore-check rewrite) falls back whole.
  assert.equal(extractFinalTake(["First.", "Second."], [], "Rewritten."), "Rewritten.");
});

test("variant 0 is always the prose the table already read", () => {
  assert.deepEqual(seedVariants([], "published"), ["published"]);
  assert.deepEqual(seedVariants(["a", "b"], "published"), ["a", "b"]);
});

test("variants cap and always select the newest take", () => {
  let variants = seedVariants([], "one");
  for (let taken = 1; taken < MAX_VARIANTS; taken += 1) {
    const result = appendVariant(variants, `take ${taken + 1}`);
    assert.equal(result.capped, false);
    assert.equal(result.index, taken);
    variants = result.variants;
  }
  assert.equal(variants.length, MAX_VARIANTS);
  const overflow = appendVariant(variants, "one too many");
  assert.equal(overflow.capped, true);
  assert.equal(overflow.variants.length, MAX_VARIANTS);
  assert.equal(overflow.variants.at(-1), `take ${MAX_VARIANTS}`);
});

test("out-of-range selections are rejected rather than clamped", () => {
  const variants = ["a", "b"];
  assert.equal(resolveVariantIndex(variants, 0), 0);
  assert.equal(resolveVariantIndex(variants, 1), 1);
  assert.equal(resolveVariantIndex(variants, 2), -1);
  assert.equal(resolveVariantIndex(variants, -1), -1);
  assert.equal(resolveVariantIndex(variants, 1.5), -1);
  assert.equal(resolveVariantIndex([], 0), -1);
});

console.log(`renarrate: ${passed} tests passed`);
