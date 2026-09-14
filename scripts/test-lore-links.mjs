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

// ---- docs/vtt-parity-implementation-plan.md sections 5.1 and 5.4 ----
const { hasSecretBlocks, loreBacklinks, loreReadableBy, markSecretBlocks, normalizeLoreAudience, stripSecretBlocks } =
  await import("../src/lib/dm/world-lore-logic.ts");

test("a secret block is dropped for the table and marked for the prompt", () => {
  const body = "The mill burned.\n\n:::secret\nThe miller lit it.\n:::\n\nNobody was hurt.";
  assert.ok(hasSecretBlocks(body));
  assert.equal(stripSecretBlocks(body), "The mill burned.\n\nNobody was hurt.");
  assert.ok(markSecretBlocks(body).includes("(SECRET, the party does not know: The miller lit it.)"));
  assert.equal(stripSecretBlocks("no secrets\r\nhere"), "no secrets\nhere");
  assert.ok(!hasSecretBlocks("no secrets"));
  const block = renderLoreForPrompt([entry({ id: "s", body })], []);
  assert.ok(block.includes("SECRET, the party does not know"));
});

test("an entry written for some players opens only for them", () => {
  const forTwo = { ...entry({ id: "a" }), audience: ["u1", "u2"], attachmentPath: "", style: "plain" };
  const forAll = { ...entry({ id: "b" }), audience: null, attachmentPath: "", style: "plain" };
  assert.ok(loreReadableBy(forTwo, false, "u1"));
  assert.ok(!loreReadableBy(forTwo, false, "u3"));
  assert.ok(loreReadableBy(forTwo, true, "u3"), "the DM reads everything");
  assert.ok(loreReadableBy(forAll, false, "u3"));
  assert.deepEqual(loreVisibleTo([forTwo, forAll], false, "u3").map((e) => e.id), ["b"]);
  assert.deepEqual(loreVisibleTo([forTwo, forAll], false, "u2").map((e) => e.id), ["a", "b"]);
  assert.equal(normalizeLoreAudience("nope"), null);
  assert.equal(normalizeLoreAudience([]), null);
  assert.deepEqual(normalizeLoreAudience(["u1", "u1", 3, "u2"]), ["u1", "u2"]);
});

test("backlinks name every source that links the title, case-insensitively", () => {
  const mentions = loreBacklinks("The Mill", [
    { kind: "lore", id: "l2", name: "Marla", text: "She owns [[the mill]]." },
    { kind: "beat", id: "b1", name: "beat", text: "Nothing here." },
    { kind: "note", id: "n1", name: "Party note", text: "Go to [[The Mill]] at dusk." },
  ]);
  assert.deepEqual(mentions.map((m) => m.id), ["l2", "n1"]);
  assert.deepEqual(loreBacklinks("", [{ kind: "lore", id: "x", name: "x", text: "[[]]" }]), []);
});

console.log(`test-lore-links (binder): ${passed} passed`);
