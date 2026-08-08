// Scene-importance scoring: server-recorded signals decide what recall
// surfaces first among equally-similar candidates.
import assert from "node:assert/strict";
import {
  DEFAULT_IMPORTANCE,
  MAX_IMPORTANCE,
  MIN_IMPORTANCE,
  clampImportance,
  importanceRanking,
  scoreSceneImportance,
  shouldProtectFromCompaction,
} from "../src/lib/dm/importance-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("an uneventful span sits at the default", () => {
  // Ordinary play must be neither promoted nor buried; signals only push up.
  assert.equal(scoreSceneImportance({}), DEFAULT_IMPORTANCE);
  assert.equal(scoreSceneImportance({ deaths: 0, crits: 0 }), DEFAULT_IMPORTANCE);
});

test("a death outranks a shopping trip", () => {
  const shopping = scoreSceneImportance({ majorLoot: 1 });
  const death = scoreSceneImportance({ deaths: 1 });
  assert.ok(death > shopping, `death ${death} should beat shopping ${shopping}`);
  assert.equal(death, MAX_IMPORTANCE);
});

test("a closed beat and a level up both rate above routine play", () => {
  assert.ok(scoreSceneImportance({ beatCompleted: true }) > DEFAULT_IMPORTANCE);
  assert.ok(scoreSceneImportance({ levelUps: 1 }) > DEFAULT_IMPORTANCE);
  // A lone crit is barely a blip.
  assert.equal(scoreSceneImportance({ crits: 1 }), DEFAULT_IMPORTANCE);
});

test("repeated signals saturate rather than compound", () => {
  const one = scoreSceneImportance({ encounters: 1 });
  const eight = scoreSceneImportance({ encounters: 8 });
  assert.ok(eight >= one);
  // A single busy combat must not pin an otherwise ordinary span at the top.
  assert.ok(scoreSceneImportance({ crits: 12 }) < MAX_IMPORTANCE);
});

test("scores always land in range", () => {
  const everything = scoreSceneImportance({
    deaths: 5,
    storyEvents: 5,
    otherEvents: 5,
    beatCompleted: true,
    encounters: 5,
    relationshipShifts: 5,
    crits: 5,
    npcIntroductions: 5,
    levelUps: 5,
    majorLoot: 5,
  });
  assert.equal(everything, MAX_IMPORTANCE);
  assert.ok(everything >= MIN_IMPORTANCE && everything <= MAX_IMPORTANCE);
  assert.equal(clampImportance(Number.NaN), DEFAULT_IMPORTANCE);
  assert.equal(clampImportance(-40), MIN_IMPORTANCE);
  assert.equal(clampImportance(99), MAX_IMPORTANCE);
});

test("importanceRanking breaks ties by incoming relevance order", () => {
  // Incoming order is the fused relevance order, so equal importance must
  // preserve it: importance breaks ties, it does not override relevance.
  const ranked = importanceRanking([
    { id: "a", importance: 3 },
    { id: "b", importance: 5 },
    { id: "c", importance: 3 },
  ]);
  assert.deepEqual(ranked, ["b", "a", "c"]);
  assert.deepEqual(
    importanceRanking([
      { id: "x", importance: 3 },
      { id: "y", importance: 3 },
    ]),
    ["x", "y"],
  );
  assert.deepEqual(importanceRanking([]), []);
});

test("only the most memorable spans resist compaction", () => {
  assert.ok(shouldProtectFromCompaction(scoreSceneImportance({ deaths: 1 })));
  assert.ok(!shouldProtectFromCompaction(DEFAULT_IMPORTANCE));
  assert.ok(!shouldProtectFromCompaction(scoreSceneImportance({ encounters: 1 })));
});

console.log(`test-importance: ${passed} tests passed`);
