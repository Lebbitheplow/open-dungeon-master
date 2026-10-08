// Entity resolution: keeping "marla", "MARLA" and "Église"/"église" one
// person without ever silently fusing two different ones. Only an exact
// match (case, spacing and punctuation aside) resolves on its own; one name
// inside another and a near-typo are suggestions for the lead, in every
// table language, English included.
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

test("normalizeName drops punctuation, case and spacing, never a word", () => {
  assert.equal(normalizeName("The Warden"), "the warden");
  assert.equal(normalizeName("  Marla   Venn,  "), "marla venn");
  assert.equal(normalizeName("Captain Marla"), "captain marla");
  assert.equal(normalizeName("Il fabbro"), "il fabbro");
  assert.equal(normalizeName("L'oste Bruno"), "l oste bruno");
  assert.equal(normalizeName("Église Saint-Martin"), "église saint martin");
  assert.deepEqual(tokensOf("Marla O'Venn"), ["marla", "o", "venn"]);
  assert.equal(normalizeName("!!!"), "");
});

test("exact tier matches through case, spacing and Unicode form", () => {
  const known = ["Marla Venn", "Aldric", "Il fabbro"];
  assert.deepEqual(matchEntity("marla venn", known), {
    name: "Marla Venn",
    tier: "exact",
    needsConfirmation: false,
  });
  assert.equal(matchEntity("ALDRIC", known).name, "Aldric");
  assert.equal(matchEntity("il FABBRO", known).tier, "exact");
  // A decomposed "ò" is the composed one.
  assert.equal(matchEntity("Niccolò", ["Niccolò"]).tier, "exact");
});

test("one name inside another is a suggestion for the lead, never a silent merge, in every language", () => {
  const pairs = [
    ["english", "Bruno the smith", "the smith"],
    ["english", "Marla", "Marla Venn"],
    ["english", "Captain Marla", "Marla"],
    ["english", "guard captain", "guard"],
    ["italian", "Il fabbro Bruno", "Il fabbro"],
    ["italian", "La guardia del porto", "La guardia"],
    ["french", "Le forgeron Bruno", "Le forgeron"],
    ["spanish", "El herrero Bruno", "El herrero"],
    ["german", "Der Schmied Bruno", "Der Schmied"],
  ];
  for (const [language, name, known] of pairs) {
    for (const [a, b] of [
      [name, known],
      [known, name],
    ]) {
      const match = matchEntity(a, [b]);
      assert.equal(match?.tier, "containment", `${language}: ${a} / ${b}`);
      assert.equal(match.needsConfirmation, true, `${language}: ${a} / ${b}`);
    }
  }
  // Two different roles share no name.
  assert.equal(matchEntity("temple guard", ["city guard"]), null);
});

// A word that is an article, a pronoun or a number in one language is a
// name in another ("Hans" is Danish for "his"), so no word is dropped to
// make two names equal.
test("a name whose first word is a common word is never merged on its own", () => {
  for (const [a, b] of [
    ["Hans Gruber", "Gruber"],
    ["Sei Dita", "Dita"],
    ["Sin Nombre", "Nombre"],
    ["Over the Hill", "Hill"],
    ["The Warden", "Warden"],
    ["Il fabbro", "fabbro"],
  ]) {
    const match = matchEntity(a, [b]);
    assert.equal(match?.tier, "containment", `${a} / ${b}`);
    assert.equal(match.needsConfirmation, true, `${a} / ${b}`);
  }
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
  assert.equal(matchEntity("Innkeeper", ["Shopkeeper"]), null);
});

test("unknown names resolve to nothing", () => {
  assert.equal(matchEntity("Vhaeric", ["Marla Venn", "Aldric"]), null);
  assert.equal(matchEntity("Marla", []), null);
  assert.equal(matchEntity("", ["Marla"]), null);
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
  // The same name in another case: nothing new. With an article it is a
  // spelling of its own.
  assert.deepEqual(mergeAliases(["Warden"], "WARDEN"), ["Warden"]);
  assert.deepEqual(mergeAliases(["Warden"], "the warden"), ["Warden", "the warden"]);
  assert.deepEqual(mergeAliases(["Marla"], "Marla Venn"), ["Marla", "Marla Venn"]);
  assert.deepEqual(mergeAliases(["Marla"], "  "), ["Marla"]);
  const many = Array.from({ length: 12 }, (_, index) => `Name${index}`);
  assert.equal(mergeAliases(many, "Overflow").length, 12);
});

console.log(`test-entity: ${passed} tests passed`);
