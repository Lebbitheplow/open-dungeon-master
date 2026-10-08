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
import { stopWordsFor } from "../src/lib/language/language.ts";

const en = stopWordsFor("english");

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
    planMerge({ name: "Aldric", aliases: [] }, { name: "Alaric", aliases: [] }, en),
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
      en,
    ),
  );
  assert.deepEqual(plan.aliases, ["Captain Marla", "Marla Venn", "Venn"]);
});

check("aliases dedupe on normalized form, not exact text", () => {
  const plan = ok(
    planMerge(
      { name: "Marla", aliases: ["The Harbourmaster"] },
      { name: "Venn", aliases: ["the  HARBOURMASTER", "Harbourmaster"] },
      en,
    ),
  );
  const harbour = plan.aliases.filter((alias) => /harbourmaster/i.test(alias));
  assert.equal(harbour.length, 1, "one spelling, however it was cased or spaced");
});

check("an incoming name equal to the keeper's is not re-added as an alias", () => {
  const plan = ok(
    planMerge({ name: "Marla", aliases: [] }, { name: "Marla Venn", aliases: ["Marla"] }, en),
  );
  assert.ok(!plan.aliases.some((alias) => alias.toLowerCase() === "marla"));
});

check("a merge never deletes a spelling the keeper already answered to", () => {
  // "The Warden" normalizes to "warden", the keeper's own name. Deduping
  // the keeper's existing aliases against its name would silently drop it.
  const plan = ok(
    planMerge({ name: "Warden", aliases: ["The Warden"] }, { name: "Venn", aliases: [] }, en),
  );
  assert.ok(plan.aliases.includes("The Warden"));
});

check("merging a name into itself is refused", () => {
  assert.ok(isReviewError(planMerge({ name: "Marla", aliases: [] }, { name: "Marla", aliases: [] }, en)));
  // A leading function word normalizes away, so these are one name.
  assert.ok(isReviewError(planMerge({ name: "Warden", aliases: [] }, { name: "the warden", aliases: [] }, en)));
  // A title does not: "Captain Marla" may be a different person from "Marla".
  ok(planMerge({ name: "Marla", aliases: [] }, { name: "Captain Marla", aliases: [] }, en));
});

check("a nameless side is refused rather than merged into nothing", () => {
  assert.ok(isReviewError(planMerge({ name: "  ", aliases: [] }, { name: "Marla", aliases: [] }, en)));
  assert.ok(isReviewError(planMerge({ name: "Marla", aliases: [] }, { name: "", aliases: [] }, en)));
});

check("aliases are capped", () => {
  const many = Array.from({ length: 30 }, (_, index) => `Alias${index}`);
  const plan = ok(planMerge({ name: "Marla", aliases: many }, { name: "Venn", aliases: many }, en));
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
  assert.equal(pairKey("Aldric", "Alaric", en), pairKey("Alaric", "Aldric", en));
});

check("a pair key ignores case and a leading function word", () => {
  assert.equal(pairKey("The Warden", "Venn", en), pairKey("warden", "VENN", en));
  assert.equal(pairKey("Il fabbro", "Bruno", stopWordsFor("italian")), pairKey("fabbro", "BRUNO", stopWordsFor("italian")));
});

check("different pairs get different keys", () => {
  assert.notEqual(pairKey("Aldric", "Alaric", en), pairKey("Aldric", "Marla", en));
});

check("dismissed pairs stop reappearing", () => {
  // Suggestions are recomputed from the roster on every read, so without
  // this a dismissed pair comes back forever.
  const suggestions = [
    { name: "Aldric", matches: "Alaric" },
    { name: "Marla", matches: "Marla Venn" },
  ];
  const left = filterDismissed(suggestions, [pairKey("Alaric", "Aldric", en)], en);
  assert.deepEqual(
    left.map((entry) => entry.name),
    ["Marla"],
  );
});

check("no dismissals leaves the list untouched", () => {
  const suggestions = [{ name: "a", matches: "b" }];
  assert.deepEqual(filterDismissed(suggestions, [], en), suggestions);
});

console.log(`entity-review: ${passed} tests passed`);
