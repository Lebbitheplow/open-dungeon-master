// Entity resolution: keeping "marla", "MARLA" and "Église"/"église" one
// person without ever silently fusing two different ones. Only an exact
// match (case, spacing, punctuation and a leading function word aside)
// resolves on its own; one name inside another and a near-typo are
// suggestions for the lead, in every table language, English included.
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
import { stopWordsFor } from "../src/lib/language/language.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const en = stopWordsFor("english");
const it = stopWordsFor("italian");

test("normalizeName drops punctuation, case and a leading function word, never a title", () => {
  assert.equal(normalizeName("The Warden", en), "warden");
  assert.equal(normalizeName("  Marla   Venn,  ", en), "marla venn");
  assert.equal(normalizeName("Captain Marla", en), "captain marla");
  assert.equal(normalizeName("Il fabbro", it), "fabbro");
  assert.equal(normalizeName("L'oste Bruno", it), "oste bruno");
  assert.equal(normalizeName("Église Saint-Martin", stopWordsFor("french")), "église saint martin");
  assert.deepEqual(tokensOf("Marla O'Venn", en), ["marla", "o", "venn"]);
  assert.equal(normalizeName("!!!", en), "");
  // A name that is nothing but a function word keeps it rather than vanishing.
  assert.equal(normalizeName("The", en), "the");
});

test("exact tier matches through case, spacing and a leading function word", () => {
  const known = ["Marla Venn", "Aldric", "Il fabbro"];
  assert.deepEqual(matchEntity("marla venn", known, en), {
    name: "Marla Venn",
    tier: "exact",
    needsConfirmation: false,
  });
  assert.equal(matchEntity("ALDRIC", known, en).name, "Aldric");
  assert.equal(matchEntity("fabbro", known, it).tier, "exact");
  // A decomposed "ò" is the composed one.
  assert.equal(matchEntity("Niccolò", ["Niccolò"], it).tier, "exact");
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
    const stopWords = stopWordsFor(language);
    for (const [a, b] of [
      [name, known],
      [known, name],
    ]) {
      const match = matchEntity(a, [b], stopWords);
      assert.equal(match?.tier, "containment", `${language}: ${a} / ${b}`);
      assert.equal(match.needsConfirmation, true, `${language}: ${a} / ${b}`);
    }
  }
  // Two different roles share no name.
  assert.equal(matchEntity("temple guard", ["city guard"], en), null);
});

test("fuzzy tier catches a typo but always asks first", () => {
  const match = matchEntity("Marlla Venn", ["Marla Venn"], en);
  assert.equal(match.name, "Marla Venn");
  assert.equal(match.tier, "fuzzy");
  assert.equal(match.needsConfirmation, true, "a fuzzy match must never apply silently");
});

test("fuzzy does not fuse two genuinely different names", () => {
  // One edit apart, but plausibly two real people, so no auto-merge.
  const match = matchEntity("Aldric", ["Alaric"], en);
  if (match) {
    assert.equal(match.tier, "fuzzy");
    assert.equal(match.needsConfirmation, true);
  }
  // Short names are excluded: edit distance is meaningless there.
  assert.equal(matchEntity("Ana", ["Ane"], en), null);
  assert.equal(matchEntity("Bo", ["Jo"], en), null);
  assert.equal(matchEntity("Innkeeper", ["Shopkeeper"], en), null);
});

test("unknown names resolve to nothing", () => {
  assert.equal(matchEntity("Vhaeric", ["Marla Venn", "Aldric"], en), null);
  assert.equal(matchEntity("Marla", [], en), null);
  assert.equal(matchEntity("", ["Marla"], en), null);
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
  assert.deepEqual(mergeAliases([], "Marla", en), ["Marla"]);
  // The same name in another case or with a leading article: nothing new.
  assert.deepEqual(mergeAliases(["Warden"], "the warden", en), ["Warden"]);
  assert.deepEqual(mergeAliases(["Marla"], "Marla Venn", en), ["Marla", "Marla Venn"]);
  assert.deepEqual(mergeAliases(["Marla"], "  ", en), ["Marla"]);
  const many = Array.from({ length: 12 }, (_, index) => `Name${index}`);
  assert.equal(mergeAliases(many, "Overflow", en).length, 12);
});

console.log(`test-entity: ${passed} tests passed`);
