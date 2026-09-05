// The binder's links and secrets: [[Name]] resolved against what the
// workshop holds, and which entries a reader may see. See
// docs/workshop-parity-audit.md phase 14.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  loreLinkNames,
  loreVisibleTo,
  normalizeLoreInput,
  normalizeLoreVisibility,
  renderLoreForPrompt,
  splitLoreLinks,
} = await import("../src/lib/dm/world-lore-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const entry = (over) => ({
  id: over.id ?? "e",
  campaignId: "c",
  category: "history",
  title: over.title ?? "The mill",
  body: over.body ?? "It burned.",
  tags: [],
  pinned: false,
  visibility: over.visibility ?? "party",
  imagePath: "",
  createdAt: "",
  updatedAt: "",
});

test("links split a body into text and names, resolved case-insensitively", () => {
  const segments = splitLoreLinks("Ask [[Marla]] about [[the Mill]] and [[Nobody]].", [
    { kind: "npc", id: "n1", name: "marla" },
    { kind: "lore", id: "l1", name: "The Mill" },
  ]);
  assert.deepEqual(
    segments.map((segment) => (segment.kind === "text" ? segment.text : `${segment.name}->${segment.target?.kind ?? "none"}`)),
    ["Ask ", "Marla->npc", " about ", "the Mill->lore", " and ", "Nobody->none", "."],
  );
  assert.deepEqual(loreLinkNames("[[A]] then [[B]] then [[A]]"), ["A", "B"]);
  assert.deepEqual(splitLoreLinks("no links", []), [{ kind: "text", text: "no links" }]);
});

test("visibility defaults to the table and only 'dm' is a secret", () => {
  assert.equal(normalizeLoreVisibility(undefined), "party");
  assert.equal(normalizeLoreVisibility("secret"), "party");
  assert.equal(normalizeLoreVisibility("dm"), "dm");
  const input = normalizeLoreInput({ category: "factions", title: "The Reed Court", body: "A cult.", visibility: "dm" });
  assert.equal(input.visibility, "dm");
});

test("a player's list drops the secrets; the DM's keeps them", () => {
  const entries = [entry({ id: "a" }), entry({ id: "b", visibility: "dm" })];
  assert.deepEqual(loreVisibleTo(entries, false).map((e) => e.id), ["a"]);
  assert.deepEqual(loreVisibleTo(entries, true).map((e) => e.id), ["a", "b"]);
});

test("the prompt marks a secret so the model knows the party does not know it", () => {
  const block = renderLoreForPrompt([entry({ id: "s", title: "The truth", visibility: "dm" })], []);
  assert.ok(block.includes("The truth (SECRET"));
  const plain = renderLoreForPrompt([entry({ id: "p" })], []);
  assert.ok(!plain.includes("SECRET"));
});

console.log(`test-lore-links: ${passed} passed`);
