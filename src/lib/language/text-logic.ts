// Splitting and comparing text the same way in every language: Unicode
// letters and digits, never an ASCII range, so "Niccolò", "José" and
// "Église" are whole words. Pure and dependency-free so scripts can load it
// directly; the language-specific half (stop words, stemming) is
// ./language.ts.

// A word keeps the apostrophes and hyphens inside it ("dell'oracolo",
// "marla's", "don't", "t-uisce"): each Snowball stemmer and stop list already
// handles its own language's elisions, possessives and contractions when it
// sees the word whole, and splitting first would break them (English
// "don't" would leave "don" behind as a word).
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function words(text: string): string[] {
  return (text.match(WORD) ?? []).map((word) => word.replace(/’/g, "'"));
}

// How two names are compared: one Unicode form (a decomposed "Niccolò"
// equals the composed one) and Unicode lower case, which SQLite's NOCASE
// does only for ASCII. Accents stay: "papà" is not "papa".
export function foldName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// Whether `needle` stands in `haystack` as a whole word or phrase, by
// Unicode letters rather than \b, which only knows ASCII: "José" is found in
// "José nods" and not in "Joséphine".
export function hasWord(haystack: string, needle: string): boolean {
  const text = foldName(haystack);
  const target = foldName(needle);
  if (!target) {
    return false;
  }
  let index = text.indexOf(target);
  while (index >= 0) {
    const before = index === 0 ? "" : text[index - 1];
    const after = text[index + target.length] ?? "";
    if (!LETTER_OR_DIGIT.test(before) && !LETTER_OR_DIGIT.test(after)) {
      return true;
    }
    index = text.indexOf(target, index + 1);
  }
  return false;
}
