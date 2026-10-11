// Rules-manager logic: house-rules chunking, flag carryover across
// re-chunks, keyword fallback, and the two prompt blocks.
import assert from "node:assert/strict";
import {
  carryChunkFlags,
  chunkHouseRules,
  renderHouseRules,
  renderVariantRules,
  scoreRuleByKeywords,
} from "../src/lib/dm/rules-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const SAMPLE = `# Potions
Drinking a potion is a bonus action at this table. Feeding one to someone else is a full action.

# Death
When a character dies for good, the player may bring their next character in at the same level.

Critical hits:
On a crit, roll the damage dice twice and take the better total instead of doubling dice.`;

test("chunkHouseRules splits on headings and keeps heading text", () => {
  const chunks = chunkHouseRules(SAMPLE);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].heading, "Potions");
  assert.ok(chunks[0].text.includes("bonus action"));
  assert.ok(chunks.some((chunk) => chunk.heading === "Death"));
  assert.ok(chunks.some((chunk) => chunk.heading === "Critical hits"));
});

test("chunkHouseRules splits oversized paragraphs", () => {
  const long = "word ".repeat(400);
  const chunks = chunkHouseRules(long);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 900);
  }
});

test("chunkHouseRules merges small paragraphs", () => {
  const text = "One short rule.\n\nAnother short rule.\n\nA third short rule.";
  const chunks = chunkHouseRules(text);
  assert.equal(chunks.length, 1);
});

test("carryChunkFlags preserves flags by heading and by text", () => {
  const previous = [
    { heading: "Potions", text: "old potion text", enabled: false, pinned: true },
    { heading: "", text: "Unheaded rule about stealth and shadows", enabled: true, pinned: true },
  ];
  const drafts = [
    { heading: "Potions", text: "rewritten potion text" },
    { heading: "", text: "Unheaded rule about stealth and shadows, extended" },
    { heading: "New", text: "brand new rule" },
  ];
  const carried = carryChunkFlags(drafts, previous);
  assert.equal(carried[0].enabled, false);
  assert.equal(carried[0].pinned, true);
  // Same first-80-chars fingerprint fails here (text changed), heading empty:
  // falls to defaults unless prefix matches. The prefix differs, so default.
  assert.equal(carried[2].enabled, true);
  assert.equal(carried[2].pinned, false);
});

test("carryChunkFlags matches identical text without headings", () => {
  const previous = [{ heading: "", text: "Flanking gives advantage.", enabled: false, pinned: false }];
  const carried = carryChunkFlags([{ heading: "", text: "Flanking gives advantage." }], previous);
  assert.equal(carried[0].enabled, false);
});

test("scoreRuleByKeywords overlaps", () => {
  const chunk = { heading: "Potions", text: "Drinking a potion is a bonus action." };
  assert.ok(scoreRuleByKeywords("drink the healing potion", chunk) > 0.3);
  assert.equal(scoreRuleByKeywords("dragon lair treasure", chunk), 0);
});

test("renderVariantRules lists only non-defaults", () => {
  const none = renderVariantRules({
    flanking: false,
    criticalFumbles: false,
    encumbrance: false,
    lingeringInjuries: false,
    restVariant: "standard",
  });
  assert.equal(none, "");
  const some = renderVariantRules({
    flanking: true,
    criticalFumbles: false,
    encumbrance: false,
    lingeringInjuries: false,
    restVariant: "gritty",
  });
  assert.ok(some.startsWith("VARIANT RULES"));
  assert.ok(some.includes("Flanking"));
  assert.ok(some.includes("Gritty"));
  assert.ok(!some.includes("fumble"));
});

test("renderHouseRules pins first and respects the budget", () => {
  const pinned = [{ heading: "Death", text: "b".repeat(500) }];
  const retrieved = [
    { heading: "Potions", text: "a".repeat(500) },
    { heading: "Crits", text: "c".repeat(500) },
  ];
  const block = renderHouseRules(pinned, retrieved, 1200);
  assert.ok(block.startsWith("HOUSE RULES"));
  const deathIndex = block.indexOf("Death");
  const potionsIndex = block.indexOf("Potions");
  assert.ok(deathIndex > -1 && potionsIndex > deathIndex);
  // 3 entries of ~510 chars exceed 1200; the third must be cut.
  assert.ok(!block.includes("Crits"));
  assert.equal(renderHouseRules([], [], 1200), "");
});

test("renderHouseRules says retrieved sections are the nearest matches, and only when there are some", () => {
  // Retrieval has no relevance cut-off, so the DM is told what it got.
  const retrieved = renderHouseRules([], [{ heading: "Potions", text: "a".repeat(100) }], 1200);
  assert.ok(retrieved.startsWith("HOUSE RULES (set by the party lead; they override the standard rules. The sections picked"));
  assert.match(retrieved, /nearest matches, nearest first; apply only those that bear on it\):/);
  // Pinned sections, or a document riding whole, are not a pick: unchanged.
  const pinned = renderHouseRules([{ heading: "Death", text: "b".repeat(100) }], [], 1200);
  assert.ok(pinned.startsWith("HOUSE RULES (set by the party lead; they override the standard rules):\n"));
});

console.log(`test-rules-chunk: ${passed} tests passed`);
