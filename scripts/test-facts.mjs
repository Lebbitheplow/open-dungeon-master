// World-fact logic: candidate normalization, dedup/supersede classification,
// prompt rendering bounds, known_by scoping, and the extended chapter JSON.
import assert from "node:assert/strict";
import {
  classifyCandidate,
  factSimilarity,
  factVisibleTo,
  normalizeCandidate,
  normalizeSubject,
  parseKnownBy,
  renderFactsForPrompt,
  serializeKnownBy,
} from "../src/lib/dm/fact-logic.ts";
import { parseChapterJson } from "../src/lib/dm/chapter-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("normalizeCandidate bounds and validates", () => {
  assert.equal(normalizeCandidate({ category: "nonsense", fact: "x" }), null);
  assert.equal(normalizeCandidate({ category: "npc", fact: "" }), null);
  const ok = normalizeCandidate({
    category: "NPC",
    subject: "  Marla the Fence!  ",
    fact: ` ${"y".repeat(400)}`,
  });
  assert.equal(ok.category, "npc");
  assert.equal(ok.subject, "marla the fence");
  assert.equal(ok.fact.length, 300);
});

test("normalizeSubject strips punctuation and case", () => {
  assert.equal(normalizeSubject("The Duke's Keep, north wing"), "the duke s keep north wing");
});

test("similarity finds rewordings and misses different facts", () => {
  assert.ok(
    factSimilarity(
      "Marla holds the vault key",
      "Marla still holds the vault key she took",
    ) >= 0.7,
  );
  assert.ok(factSimilarity("Marla holds the vault key", "The bridge at Dunfall collapsed") < 0.3);
});

const onFile = [
  { category: "npc", subject: "marla", fact: "Marla holds the vault key." },
  { category: "world", subject: "", fact: "The bridge at Dunfall collapsed." },
];

test("same subject, same statement dedups", () => {
  assert.equal(
    classifyCandidate(
      { category: "npc", subject: "Marla", fact: "Marla still holds the vault key." },
      onFile,
    ),
    "duplicate",
  );
});

test("same subject, new statement supersedes", () => {
  assert.equal(
    classifyCandidate(
      { category: "npc", subject: "Marla", fact: "Marla fled the city after the heist." },
      onFile,
    ),
    "supersedes",
  );
});

test("unknown subject is new", () => {
  assert.equal(
    classifyCandidate(
      { category: "npc", subject: "Brother Aldous", fact: "Brother Aldous owes the party 50 gold." },
      onFile,
    ),
    "new",
  );
});

test("subjectless near-identical wording dedups; different wording does not", () => {
  assert.equal(
    classifyCandidate(
      { category: "world", subject: "", fact: "The Dunfall bridge has collapsed." },
      onFile,
    ),
    "duplicate",
  );
  assert.equal(
    classifyCandidate(
      { category: "world", subject: "", fact: "A plague spreads through the lowlands." },
      onFile,
    ),
    "new",
  );
});

test("category mismatch never dedups", () => {
  assert.equal(
    classifyCandidate(
      { category: "lore", subject: "marla", fact: "Marla holds the vault key." },
      onFile,
    ),
    "new",
  );
});

function fakeFact(overrides) {
  return {
    category: "world",
    subject: "",
    fact: "Something happened.",
    pinned: false,
    knownBy: "party",
    ...overrides,
  };
}

test("render splits dm-only facts from party facts", () => {
  const { party, dmOnly } = renderFactsForPrompt([
    fakeFact({ fact: "The gate fell." }),
    fakeFact({ knownBy: "dm", fact: "The baron ordered the gate sabotaged." }),
  ]);
  assert.ok(party.includes("The gate fell."));
  assert.ok(!party.includes("baron"));
  assert.ok(dmOnly.includes("baron"));
});

test("render caps unpinned facts per category", () => {
  const many = Array.from({ length: 12 }, (_, index) =>
    fakeFact({ fact: `Distinct happening number ${index} occurred in the realm.` }),
  );
  const { party } = renderFactsForPrompt(many);
  assert.equal(party.split("\n").length, 6);
});

test("pinned facts always render, beyond caps and budget", () => {
  const filler = Array.from({ length: 30 }, (_, index) =>
    fakeFact({ fact: `${"padding ".repeat(30)}entry ${index}` }),
  );
  const pinnedLast = fakeFact({ pinned: true, fact: "This pinned truth must survive." });
  const { party } = renderFactsForPrompt([...filler, pinnedLast]);
  assert.ok(party.includes("This pinned truth must survive."));
});

test("render stays within a bounded size for unpinned facts", () => {
  const many = Array.from({ length: 100 }, (_, index) =>
    fakeFact({
      category: ["location", "npc", "promise", "world", "party", "lore"][index % 6],
      subject: `subject ${index}`,
      fact: `${"long detail ".repeat(20)}${index}`,
    }),
  );
  const { party, dmOnly } = renderFactsForPrompt(many);
  assert.ok(party.length + dmOnly.length < 2600);
});

test("knownBy round-trips", () => {
  assert.equal(parseKnownBy("party"), "party");
  assert.equal(parseKnownBy("dm"), "dm");
  assert.deepEqual(parseKnownBy('["c1","c2"]'), ["c1", "c2"]);
  assert.equal(parseKnownBy("garbage"), "party");
  assert.equal(serializeKnownBy("dm"), "dm");
  assert.equal(serializeKnownBy(["c1"]), '["c1"]');
});

test("visibility matrix", () => {
  assert.equal(factVisibleTo("party", [], false), true);
  assert.equal(factVisibleTo("dm", ["c1"], false), false);
  assert.equal(factVisibleTo("dm", [], true), true);
  assert.equal(factVisibleTo(["c1"], ["c1"], false), true);
  assert.equal(factVisibleTo(["c1"], ["c2"], false), false);
  assert.equal(factVisibleTo([], ["c1"], false), false);
});

test("chapter JSON with facts parses and bounds", () => {
  const parsed = parseChapterJson(
    JSON.stringify({
      title: "The Fall of Dunfall",
      summary: "It fell.",
      highlights: ["The bridge broke."],
      facts: [
        { category: "world", subject: "Dunfall bridge", fact: "The bridge collapsed." },
        { category: "bogus", subject: "x", fact: "dropped" },
        ...Array.from({ length: 10 }, (_, index) => ({
          category: "npc",
          subject: `person ${index}`,
          fact: `Person ${index} did a thing.`,
        })),
      ],
    }),
    3,
  );
  assert.equal(parsed.facts.length, 8);
  assert.equal(parsed.facts[0].subject, "dunfall bridge");
  assert.ok(parsed.facts.every((fact) => fact.category !== "bogus"));
});

test("legacy chapter JSON without facts still parses", () => {
  const parsed = parseChapterJson(
    JSON.stringify({ title: "Old", summary: "s", highlights: ["h"] }),
    2,
  );
  assert.equal(parsed.title, "Old");
  assert.deepEqual(parsed.facts, []);
});

test("garbage chapter output falls back with empty facts", () => {
  const parsed = parseChapterJson("no json here", 5);
  assert.equal(parsed.title, "Chapter 5");
  assert.deepEqual(parsed.facts, []);
});

console.log(`${passed} fact tests passed`);
