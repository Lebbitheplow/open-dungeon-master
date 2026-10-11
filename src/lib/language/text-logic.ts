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

// The order names are listed in, the same on every server and at every
// table: Unicode's collation ("en" is CLDR's root order, which English does
// not tailor; a bare locale would follow the host's), case and accents set
// aside, numbers by value ("Room 9" before "Room 10"). SQLite's NOCASE puts
// every name that starts with a letter outside ASCII after Z.
const NAME_ORDER = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function compareNames(a: string, b: string): number {
  return NAME_ORDER.compare(a, b);
}

export const byName = (a: { name: string }, b: { name: string }) => compareNames(a.name, b.name);

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// Where `needle` stands in `haystack` as a whole word or phrase, by Unicode
// letters rather than \b, which only knows ASCII: "José" is found in "José
// nods" and not in "Joséphine". Offsets are into the folded haystack.
export function wordPositions(haystack: string, needle: string): number[] {
  const text = foldName(haystack);
  const target = foldName(needle);
  if (!target) {
    return [];
  }
  const found: number[] = [];
  for (let index = text.indexOf(target); index >= 0; index = text.indexOf(target, index + 1)) {
    const before = index === 0 ? "" : text[index - 1];
    const after = text[index + target.length] ?? "";
    if (!LETTER_OR_DIGIT.test(before) && !LETTER_OR_DIGIT.test(after)) {
      found.push(index);
    }
  }
  return found;
}

export function hasWord(haystack: string, needle: string): boolean {
  return wordPositions(haystack, needle).length > 0;
}

// The words a text writes in lower case somewhere: common words ("old",
// "captain", "the"), not names, wherever a capital only marks a sentence
// start. What replaces a hand-written list of titles in every language.
export function commonWords(texts: readonly string[]): Set<string> {
  const common = new Set<string>();
  for (const text of texts) {
    for (const word of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
      if (/^\p{Ll}/u.test(word)) {
        common.add(word);
      }
    }
  }
  return common;
}
