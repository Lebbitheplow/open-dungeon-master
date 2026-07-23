// World-lore-builder logic: entry normalization, keyword scoring, and the
// budgeted WORLD LORE prompt block.
import assert from "node:assert/strict";
import {
  normalizeLoreInput,
  renderLoreForPrompt,
  scoreLoreByKeywords,
} from "../src/lib/dm/world-lore-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function entry(overrides = {}) {
  return {
    id: "e1",
    campaignId: "c1",
    category: "factions",
    title: "The Ashen League",
    body: "A merchant cabal running the salt roads; they mark members with a grey ring tattoo.",
    tags: ["merchants", "salt"],
    pinned: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizeLoreInput validates and bounds", () => {
  assert.equal(normalizeLoreInput({ category: "nonsense", title: "x", body: "y" }), null);
  assert.equal(normalizeLoreInput({ category: "magic", title: "", body: "y" }), null);
  assert.equal(normalizeLoreInput({ category: "magic", title: "x", body: "  " }), null);
  const ok = normalizeLoreInput({
    category: "geography",
    title: `  ${"t".repeat(200)}`,
    body: "b".repeat(9000),
    tags: ["one", "", 5, "two", ...Array(20).fill("x")],
  });
  assert.equal(ok.title.length, 120);
  assert.equal(ok.body.length, 4000);
  assert.ok(ok.tags.includes("one") && ok.tags.includes("two"));
  assert.ok(ok.tags.length <= 8);
  assert.ok(!ok.tags.includes(""));
});

test("scoreLoreByKeywords matches title, tags, and body", () => {
  assert.ok(scoreLoreByKeywords("who runs the salt roads", entry()) > 0.3);
  assert.ok(scoreLoreByKeywords("grey ring tattoo", entry()) > 0.5);
  assert.equal(scoreLoreByKeywords("dragons atop frozen peaks", entry()), 0);
});

test("renderLoreForPrompt pins first, dedupes, and clips", () => {
  const pinned = entry({ id: "p1", title: "Pinned Truth", body: "z".repeat(600) });
  const also = entry({ id: "r1", title: "Retrieved" });
  const block = renderLoreForPrompt([pinned], [also, pinned], 1600);
  assert.ok(block.startsWith("WORLD LORE"));
  assert.equal(block.match(/Pinned Truth/g).length, 1);
  assert.ok(block.indexOf("Pinned Truth") < block.indexOf("Retrieved"));
  // Bodies clip to ~300 chars per entry.
  assert.ok(!block.includes("z".repeat(400)));
});

test("renderLoreForPrompt respects the budget and empty case", () => {
  const entries = Array.from({ length: 10 }, (_, index) =>
    entry({ id: `e${index}`, title: `Entry ${index}`, body: "b".repeat(300) }),
  );
  const block = renderLoreForPrompt([], entries, 800);
  assert.ok(block.length <= 800 + 80);
  assert.ok(!block.includes("Entry 9"));
  assert.equal(renderLoreForPrompt([], [], 1600), "");
});

console.log(`test-lore-builder: ${passed} tests passed`);
