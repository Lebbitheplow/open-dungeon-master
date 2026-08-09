// Pinned memories: the token cap, refusal rather than eviction, text
// normalization, and the prompt block format.
import assert from "node:assert/strict";
import {
  MAX_PIN_LENGTH,
  PIN_TOKEN_CAP,
  buildPinnedMemoriesBlock,
  checkPin,
  normalizePinText,
  pinTokens,
  stripMarkdown,
  totalPinTokens,
} from "../src/lib/dm/pin-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

// One pin of roughly `tokens` tokens, at 4 characters per token.
const filler = (tokens, seed = "x") => ({ text: seed.repeat(tokens * 4) });

check("markdown emphasis is stripped from selections", () => {
  assert.equal(stripMarkdown("**bold** and *italic*"), "bold and italic");
  assert.equal(stripMarkdown("  padded  "), "padded");
});

check("normalization collapses whitespace so duplicates are detectable", () => {
  assert.equal(normalizePinText("the   sigil\n\nwas  burned"), "the sigil was burned");
});

check("an empty or whitespace selection is refused", () => {
  assert.equal(checkPin([], "").ok, false);
  assert.equal(checkPin([], "   \n ").ok, false);
  assert.match(checkPin([], "").reason, /select some text/i);
});

check("a pin longer than the per-pin limit is refused with the limit named", () => {
  const result = checkPin([], "y".repeat(MAX_PIN_LENGTH + 1));
  assert.equal(result.ok, false);
  assert.match(result.reason, new RegExp(String(MAX_PIN_LENGTH)));
});

check("an exact duplicate is refused rather than stored twice", () => {
  const existing = [{ text: "The sigil was burned into the door." }];
  const result = checkPin(existing, "The   sigil was burned into the door.  ");
  assert.equal(result.ok, false);
  assert.match(result.reason, /already pinned/i);
});

check("a good pin comes back normalized, ready to store", () => {
  const result = checkPin([], "  **Marla** knows   the way.  ");
  assert.equal(result.ok, true);
  assert.equal(result.text, "Marla knows the way.");
});

check("the cap refuses rather than evicting", () => {
  // NE-P's rule: a pin that silently vanished to make room would be worse
  // than no pinning, because the table would believe the DM had been told
  // something it had not.
  const existing = [filler(PIN_TOKEN_CAP - 10)];
  const result = checkPin(existing, "z".repeat(40 * 4));
  assert.equal(result.ok, false);
  assert.match(result.reason, /full/i);
  assert.match(result.reason, /unpin/i);
  assert.equal(existing.length, 1, "nothing was removed to make room");
});

check("a pin that exactly fits the remaining budget is accepted", () => {
  const existing = [filler(PIN_TOKEN_CAP - 10)];
  const result = checkPin(existing, "z".repeat(10 * 4));
  assert.equal(result.ok, true);
});

check("token accounting sums across pins", () => {
  assert.equal(pinTokens("abcd"), 1);
  assert.equal(totalPinTokens([filler(10), filler(5, "y")]), 15);
  assert.equal(totalPinTokens([]), 0);
});

check("no pins produces no block at all", () => {
  assert.equal(buildPinnedMemoriesBlock([]), "");
});

check("the block quotes each pin on its own line", () => {
  const block = buildPinnedMemoriesBlock([{ text: "One." }, { text: "Two." }]);
  assert.match(block, /^\[PINNED MEMORIES\]/);
  assert.ok(block.includes('- "One."'));
  assert.ok(block.includes('- "Two."'));
});

check("the block frames pins as record, not instruction", () => {
  // Quoting plus the framing line is what stops a pinned line of narration
  // being read as a command to carry out this turn.
  const block = buildPinnedMemoriesBlock([{ text: "Kill the duke." }]);
  assert.match(block, /not instructions/i);
  assert.ok(block.includes('"Kill the duke."'), "quoted, not bare");
});

console.log(`pins: ${passed} tests passed`);
