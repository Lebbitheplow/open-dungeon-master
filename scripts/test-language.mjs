// The language layer every lexical reader shares (src/lib/language): Unicode
// words, Snowball stop lists and stemmers per table language, and the name
// comparisons that SQLite's ASCII-only NOCASE and \b got wrong.
import assert from "node:assert/strict";

const { words, foldName, hasWord } = await import("../src/lib/language/text-logic.ts");
const { stems, stopWordsFor, stemWord } = await import("../src/lib/language/language.ts");
const { TABLE_LANGUAGES } = await import("../src/lib/schemas/game-settings-options.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

test("words are Unicode, and keep the apostrophes and hyphens inside them", () => {
  assert.deepEqual(words("Niccolò e José, nell'Église!"), ["Niccolò", "e", "José", "nell'Église"]);
  assert.deepEqual(words("Marla’s sword, t-uisce, don't"), ["Marla's", "sword", "t-uisce", "don't"]);
  assert.deepEqual(words("'quoted' -- dash"), ["quoted", "dash"]);
});

test("every table language has a stemmer and a stop list", () => {
  for (const language of TABLE_LANGUAGES) {
    assert.ok(stopWordsFor(language).size > 50, language);
    assert.equal(typeof stemWord("test", language), "string", language);
  }
});

test("singular and regular plural share a stem in each language", () => {
  const pairs = {
    english: ["spider", "spiders"],
    italian: ["ragno", "ragni"],
    french: ["araignée", "araignées"],
    spanish: ["ratón", "ratones"],
    german: ["Spinne", "Spinnen"],
  };
  for (const [language, [one, many]] of Object.entries(pairs)) {
    assert.deepEqual(stems(one, language), stems(many, language), language);
  }
});

test("elisions and possessives reach the same stem as the bare word", () => {
  assert.deepEqual(stems("dell'Oracolo", "italian"), stems("oracolo", "italian"));
  assert.deepEqual(stems("l’oracolo", "italian"), stems("oracolo", "italian"));
  assert.deepEqual(stems("l'araignée", "french"), stems("araignée", "french"));
  assert.deepEqual(stems("Marla's", "english"), stems("Marla", "english"));
  assert.deepEqual(stems("Marla’s", "english"), stems("Marla", "english"));
});

test("each language drops its own function words, and only those", () => {
  assert.deepEqual(stems("Porta della Gilda", "italian"), ["port", "gild"]);
  assert.deepEqual(stems("la Tour des Mages", "french").length, 2);
  assert.deepEqual(stems("the house of the guild", "english"), ["hous", "guild"]);
  // Whole-word stop entries: English lists its contractions whole.
  assert.deepEqual(stems("don't it's", "english"), []);
  // An Italian stop word is a scoring word at an English table.
  assert.deepEqual(stems("come", "english"), ["come"]);
  assert.deepEqual(stems("come", "italian"), []);
});

test("names fold by Unicode case and form, not by accent", () => {
  assert.equal(foldName("Église Saint-Martin"), foldName("église saint-martin"));
  assert.equal(foldName("Ölmühle"), "ölmühle");
  // A decomposed "ò" (o + combining grave) is the composed one.
  assert.equal(foldName("Niccolo\u0300"), foldName("Niccol\u00f2"));
  assert.notEqual(foldName("papà"), foldName("papa"));
});

test("a name is found as a whole word, never inside a longer one", () => {
  assert.ok(hasWord("Then José nods.", "José"));
  assert.ok(!hasWord("Joséphine nods.", "José"));
  assert.ok(hasWord("il cavallo d'Arturo", "Arturo"));
  assert.ok(hasWord("Jean-Luc waves", "jean-luc"));
  assert.ok(hasWord("O'Brien laughs", "O'Brien"));
  assert.ok(!hasWord("always", "Al"));
  assert.ok(hasWord("Niccolo\u0300 arrives", "niccolò"));
});

console.log(`\n${passed} language tests passed`);
