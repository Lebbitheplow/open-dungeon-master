// Entity resolution: keeping "Marla", "Marla Venn", and "Captain Marla" one
// person without ever silently fusing two different ones.
import assert from "node:assert/strict";
import {
  FUZZY_THRESHOLD,
  levenshtein,
  matchEntity,
  mergeAliases,
  nameSimilarity,
  normalizeName,
  tokensOf,
} from "../src/lib/dm/entity-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("normalizeName strips titles, punctuation, and case", () => {
  assert.equal(normalizeName("Captain Marla"), "marla");
  assert.equal(normalizeName("  LADY  Marla Venn  "), "marla venn");
  assert.equal(normalizeName("Ser Aldric,"), "aldric");
  assert.equal(normalizeName("The Warden"), "warden");
  assert.deepEqual(tokensOf("Sir Marla O'Venn"), ["marla", "o", "venn"]);
  assert.equal(normalizeName("!!!"), "");
});

test("exact tier matches through titles and spacing", () => {
  const known = ["Marla Venn", "Aldric"];
  assert.deepEqual(matchEntity("marla venn", known), {
    name: "Marla Venn",
    tier: "exact",
    needsConfirmation: false,
  });
  assert.equal(matchEntity("Lady Marla Venn", known).tier, "exact");
  assert.equal(matchEntity("ALDRIC", known).name, "Aldric");
});

test("containment tier links a short name to its full form", () => {
  const match = matchEntity("Marla", ["Marla Venn"]);
  assert.equal(match.name, "Marla Venn");
  assert.equal(match.tier, "containment");
  assert.equal(match.needsConfirmation, false);
  // And the other direction.
  assert.equal(matchEntity("Marla Venn", ["Marla"]).tier, "containment");
});

test("containment refuses to merge two role names", () => {
  // The guard that matters: these are roles, not identities, so neither
  // direction of containment may fuse them.
  assert.equal(matchEntity("guard captain", ["guard"]), null);
  assert.equal(matchEntity("guard", ["guard captain"]), null);
  assert.equal(matchEntity("temple guard", ["city guard"]), null);
  assert.equal(matchEntity("Innkeeper", ["Shopkeeper"]), null);
  // But a role word plus a real name still resolves.
  assert.equal(matchEntity("Captain Marla", ["Marla"]).name, "Marla");
  assert.equal(matchEntity("Marla", ["Captain Marla"]).name, "Captain Marla");
});

test("titles strip only in leading position", () => {
  // "captain" is an honorific in front of a name and a role word behind one.
  assert.equal(normalizeName("Captain Marla"), "marla");
  assert.equal(normalizeName("guard captain"), "guard captain");
  assert.equal(normalizeName("Master Aldric"), "aldric");
  assert.equal(normalizeName("guild master"), "guild master");
  // A name that is nothing but a title keeps it rather than vanishing.
  assert.equal(normalizeName("Lady"), "lady");
});

test("fuzzy tier catches a typo but always asks first", () => {
  const match = matchEntity("Marlla Venn", ["Marla Venn"]);
  assert.equal(match.name, "Marla Venn");
  assert.equal(match.tier, "fuzzy");
  assert.equal(match.needsConfirmation, true, "a fuzzy match must never apply silently");
});

test("fuzzy does not fuse two genuinely different names", () => {
  // One edit apart, but plausibly two real people, so no auto-merge.
  const match = matchEntity("Aldric", ["Alaric"]);
  if (match) {
    assert.equal(match.tier, "fuzzy");
    assert.equal(match.needsConfirmation, true);
  }
  // Short names are excluded: edit distance is meaningless there.
  assert.equal(matchEntity("Ana", ["Ane"]), null);
  assert.equal(matchEntity("Bo", ["Jo"]), null);
});

test("unknown names resolve to nothing", () => {
  assert.equal(matchEntity("Vhaeric", ["Marla Venn", "Aldric"]), null);
  assert.equal(matchEntity("Marla", []), null);
  assert.equal(matchEntity("", ["Marla"]), null);
  assert.equal(matchEntity("Lady", ["Marla"]), null);
});

test("similarity helpers behave", () => {
  assert.equal(levenshtein("marla", "marla"), 0);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("marla", "marlla"), 1);
  assert.equal(nameSimilarity("marla", "marla"), 1);
  assert.ok(nameSimilarity("marla venn", "marlla venn") >= FUZZY_THRESHOLD);
  assert.ok(nameSimilarity("marla", "vhaeric") < FUZZY_THRESHOLD);
});

test("mergeAliases dedupes on the normalized form and bounds growth", () => {
  assert.deepEqual(mergeAliases([], "Marla"), ["Marla"]);
  // Same person spelled with a title: nothing new to record.
  assert.deepEqual(mergeAliases(["Marla"], "Captain Marla"), ["Marla"]);
  assert.deepEqual(mergeAliases(["Marla"], "Marla Venn"), ["Marla", "Marla Venn"]);
  assert.deepEqual(mergeAliases(["Marla"], "  "), ["Marla"]);
  const many = Array.from({ length: 12 }, (_, index) => `Name${index}`);
  assert.equal(mergeAliases(many, "Overflow").length, 12);
});

console.log(`test-entity: ${passed} tests passed`);
