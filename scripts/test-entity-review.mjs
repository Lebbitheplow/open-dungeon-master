// The NPC review queue: merge and rename planning, and dismissal keys that
// survive the scan reporting a pair in either direction.
import assert from "node:assert/strict";
import {
  MAX_NPC_NAME,
  clampNpcName,
  filterDismissed,
  isReviewError,
  pairKey,
  planMerge,
  planRename,
} from "../src/lib/dm/entity-review-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

function ok(result) {
  assert.equal(isReviewError(result), false, `expected success, got ${result.error}`);
  return result;
}

check("names are collapsed and clamped", () => {
  assert.equal(clampNpcName("  Captain   Marla  "), "Captain Marla");
  assert.equal(clampNpcName("x".repeat(MAX_NPC_NAME + 20)).length, MAX_NPC_NAME);
  assert.equal(clampNpcName("   "), "");
});

check("a merge folds the absorbed name into the keeper's aliases", () => {
  const plan = ok(
    planMerge({ name: "Aldric", aliases: [] }, { name: "Alaric", aliases: [] }),
  );
  assert.equal(plan.keepName, "Aldric");
  assert.equal(plan.mergeName, "Alaric");
  assert.deepEqual(plan.aliases, ["Alaric"]);
});

check("both rows' aliases survive the merge", () => {
  // The point of merging is that nothing already written stops resolving.
  const plan = ok(
    planMerge(
      { name: "Marla", aliases: ["Captain Marla"] },
      { name: "Marla Venn", aliases: ["Venn"] },
    ),
  );
  assert.deepEqual(plan.aliases, ["Captain Marla", "Marla Venn", "Venn"]);
});

check("aliases dedupe on normalized form, not exact text", () => {
  const plan = ok(
    planMerge(
      { name: "Marla", aliases: ["The Harbourmaster"] },
      { name: "Venn", aliases: ["the  HARBOURMASTER", "Harbourmaster"] },
    ),
  );
  const harbour = plan.aliases.filter((alias) => /harbourmaster/i.test(alias));
  assert.equal(harbour.length, 1, "one spelling, however it was cased or spaced");
});

check("an incoming name equal to the keeper's is not re-added as an alias", () => {
  const plan = ok(
    planMerge({ name: "Marla", aliases: [] }, { name: "Marla Venn", aliases: ["Marla"] }),
  );
  assert.ok(!plan.aliases.some((alias) => alias.toLowerCase() === "marla"));
});

check("a merge never deletes a spelling the keeper already answered to", () => {
  // "Captain Marla" normalizes to "marla", the keeper's own name. Deduping
  // the keeper's existing aliases against its name would silently drop it.
  const plan = ok(
    planMerge({ name: "Marla", aliases: ["Captain Marla"] }, { name: "Venn", aliases: [] }),
  );
  assert.ok(plan.aliases.includes("Captain Marla"));
});

check("merging a name into itself is refused", () => {
  assert.ok(isReviewError(planMerge({ name: "Marla", aliases: [] }, { name: "Marla", aliases: [] })));
  // Titles normalize away, so these are the same person by ODM's own rule.
  assert.ok(
    isReviewError(
      planMerge({ name: "Marla", aliases: [] }, { name: "Captain Marla", aliases: [] }),
    ),
  );
});

check("a nameless side is refused rather than merged into nothing", () => {
  assert.ok(isReviewError(planMerge({ name: "  ", aliases: [] }, { name: "Marla", aliases: [] })));
  assert.ok(isReviewError(planMerge({ name: "Marla", aliases: [] }, { name: "", aliases: [] })));
});

check("aliases are capped", () => {
  const many = Array.from({ length: 30 }, (_, index) => `Alias${index}`);
  const plan = ok(planMerge({ name: "Marla", aliases: many }, { name: "Venn", aliases: many }));
  assert.ok(plan.aliases.length <= 12);
});

check("a rename keeps the old spelling as an alias", () => {
  // Everything already written says the old name; retrieval has to keep
  // matching it.
  const plan = ok(planRename({ name: "Marla", aliases: ["Captain Marla"] }, "Marla Venn"));
  assert.equal(plan.name, "Marla Venn");
  assert.equal(plan.aliases[0], "Marla", "the old canonical name comes first");
  assert.ok(plan.aliases.includes("Captain Marla"));
});

check("renaming to the same name is refused", () => {
  assert.ok(isReviewError(planRename({ name: "Marla", aliases: [] }, "Marla")));
  assert.ok(isReviewError(planRename({ name: "Marla", aliases: [] }, "   ")));
});

check("a rename does not leave the new name as its own alias", () => {
  const plan = ok(planRename({ name: "Marla", aliases: ["Marla Venn"] }, "Marla Venn"));
  assert.ok(!plan.aliases.some((alias) => alias === "Marla Venn"));
  assert.deepEqual(plan.aliases, ["Marla"]);
});

check("a pair key is the same in either direction", () => {
  // suggestNpcMerges walks the roster in order, so which name is reported
  // first depends on insertion order. A dismissal must outlive that.
  assert.equal(pairKey("Aldric", "Alaric"), pairKey("Alaric", "Aldric"));
});

check("a pair key ignores case and honorifics", () => {
  assert.equal(pairKey("Captain Marla", "Venn"), pairKey("marla", "VENN"));
});

check("different pairs get different keys", () => {
  assert.notEqual(pairKey("Aldric", "Alaric"), pairKey("Aldric", "Marla"));
});

check("dismissed pairs stop reappearing", () => {
  // Suggestions are recomputed from the roster on every read, so without
  // this a dismissed pair comes back forever.
  const suggestions = [
    { name: "Aldric", matches: "Alaric" },
    { name: "Marla", matches: "Marla Venn" },
  ];
  const left = filterDismissed(suggestions, [pairKey("Alaric", "Aldric")]);
  assert.deepEqual(
    left.map((entry) => entry.name),
    ["Marla"],
  );
});

check("no dismissals leaves the list untouched", () => {
  const suggestions = [{ name: "a", matches: "b" }];
  assert.deepEqual(filterDismissed(suggestions, []), suggestions);
});

console.log(`entity-review: ${passed} tests passed`);
