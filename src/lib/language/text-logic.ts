// Splitting and comparing text the same way in every language: Unicode
// letters, marks and digits, never an ASCII range, so "Niccolò", "José" and
// "Église" are whole words. Pure and dependency-free so scripts can load it
// directly; the language-specific half (stop words, stemming) is
// ./language.ts.

// What a word is made of, in every script and wherever a word's edge is
// read: letters, digits and the combining marks that belong to a letter, so
// a decomposed "é" (e + U+0301) never splits one. A regex source fragment,
// for the character classes of the patterns that read text people write.
export const WORD_CHAR = "\\p{L}\\p{M}\\p{N}";

// A sign before a number at a word's start is the number's ("+1", "-2"): an
// item's bonus is part of its name, while "2d6+3" stays dice.
const SIGN = `(?:(?<![${WORD_CHAR}])[+-](?=\\p{N}))?`;
// A word keeps the apostrophes, hyphens and underscores inside it
// ("dell'oracolo", "marla's", "don't", "t-uisce"): each Snowball stemmer and
// stop list already handles its own language's elisions, possessives and
// contractions when it sees the word whole, and splitting first would break
// them (English "don't" would leave "don" behind as a word). At a word's
// edge they are punctuation, so "_Marla_" is Marla.
const WORD = new RegExp(`${SIGN}[${WORD_CHAR}]+(?:['’_-][${WORD_CHAR}]+)*`, "gu");
// What a key is made of: the runs of letters, marks and digits, with a
// number's sign.
const KEY_PART = new RegExp(`${SIGN}[${WORD_CHAR}]+`, "gu");
const SPLIT = new RegExp(`(${WORD.source})`, "u");
const WORD_CHARACTER = new RegExp(`[${WORD_CHAR}]`, "u");

// One Unicode form, compatibility forms included (the ligature "ﬁ" is "fi", a
// fullwidth "Ａ" is "A"), every apostrophe straight (the typographic ones, the
// modifier letter "ʼ", which Unicode counts as a letter, and the acute accent
// "´", whose compatibility form is a space and a combining accent), and the
// minus sign a hyphen-minus, so "−1" is "-1".
function straight(text: string): string {
  return text.replace(/[‘’ʼ´]/g, "'").replace(/−/g, "-").normalize("NFKC");
}


// The words of a text, in one Unicode form, every apostrophe straight, case as
// written.
export function words(text: string): string[] {
  return straight(text).match(WORD) ?? [];
}

// The text as written, cut at its words: the gaps at even indexes, the words
// at odd ones, so a view can mark words without moving a character.
export function splitWords(text: string): string[] {
  return text.split(SPLIT);
}

// What two texts are compared by, as names, searches or map keys: their runs
// of letters and digits in lower case, one space apart, every other mark a
// gap. "Hunter's Mark", "Hunter`s Mark", "hunter_s_mark" and "HUNTER-S-MARK"
// are one name, a decomposed "Niccolò" is the composed one, and case folds in
// full by Unicode ("Straße" is "STRASSE"), which SQLite's NOCASE, LOWER() and
// LIKE do only for ASCII. Accents stay ("papà" is not "papa"), and so does a
// number's sign ("+1"). A key is only ever compared with another key: what is
// shown, stored or sent keeps the text as written. Upper case before lower,
// so a letter whose upper case is two ("ß" is "SS") folds too.
export function textKey(text: string): string {
  return (straight(text).match(KEY_PART) ?? []).join(" ").toUpperCase().toLowerCase();
}

// Where `phrase` stands in `text` as whole words, offsets into textKey(text):
// "Marla" is in "Marla's sword" and "Oracolo" in "dell'Oracolo", but "José"
// is not in "Joséphine".
export function phraseOffsets(text: string, phrase: string): number[] {
  const key = textKey(text);
  const wanted = textKey(phrase);
  if (!wanted) {
    return [];
  }
  const found: number[] = [];
  for (let at = key.indexOf(wanted); at >= 0; at = key.indexOf(wanted, at + 1)) {
    const before = at === 0 ? "" : key[at - 1];
    const after = key[at + wanted.length] ?? "";
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) {
      found.push(at);
    }
  }
  return found;
}

export function containsPhrase(text: string, phrase: string): boolean {
  return phraseOffsets(text, phrase).length > 0;
}

// A pattern that finds any of these names as whole words in text as
// written, either Unicode form, longest name first so "Marla Venn" is never
// read as "Marla" with a word left over. The match's offsets are offsets
// into that text, which a view or a reader slices.
export function namesPattern(names: Iterable<string>, flags: string): RegExp {
  const spellings = [...new Set([...names].flatMap((name) => [name.normalize("NFC"), name.normalize("NFD")]))]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![${WORD_CHAR}])(?:${spellings.join("|")})(?![${WORD_CHAR}])`, flags);
}

// The words a text writes in lower case somewhere: common words ("old",
// "captain", "the"), not names, wherever a capital only marks a sentence
// start. What replaces a hand-written list of titles in every language.
export function commonWords(texts: readonly string[]): Set<string> {
  const common = new Set<string>();
  for (const text of texts) {
    for (const word of words(text)) {
      if (/^\p{Ll}/u.test(word)) {
        common.add(textKey(word));
      }
    }
  }
  return common;
}

// The words a search looks for in a text: its keyed words of three letters
// or more, less the stop words given (src/lib/language/language.ts
// stopWordsFor, passed in so a browser module never loads the stemmers). In
// order, repeats kept.
export function searchWords(text: string, stopWords: ReadonlySet<string>): string[] {
  return textKey(text)
    .split(" ")
    .filter((word) => word.length >= 3 && !stopWords.has(word));
}

// A name made into an id or a file name: its key's words joined by "_", a
// number's sign dropped, in any script, so two names never share one only
// because neither has an ASCII letter. Empty when the name has no letter or
// digit at all, for the caller to refuse or replace.
export function slugOf(name: string): string {
  return textKey(name).replace(/[+-]/g, "").replaceAll(" ", "_");
}

// A name made into an id whose format is pinned to ASCII (a world pack id,
// a generated image's path, a username): accents dropped ("Épée" is "epee",
// "Straße" is "strasse").
// Empty for a name in another script, which has nothing left, for the caller
// to replace.
export function asciiSlugOf(name: string): string {
  const ascii = slugOf(name).normalize("NFKD").replace(/\p{M}/gu, "");
  return ascii.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// A record by the name a caller gives: one of the record's spellings, or a
// part of one record's name only ("rex"). Anything else is none, never the
// record whose name sits inside it: a giant elk is no Elk, a werewolf no
// Wolf. `terms` are the ways to read what was written (the name as written,
// then without its article); a record's first spelling is its name, the only
// one a part is looked for in. Compared by textKey, so "giant_spider" and
// "Giant-Spider" are the Giant Spider and an accented name matches.
export function findNamed<T>(list: readonly T[], terms: readonly string[], spellingsOf: (entry: T) => readonly [string, ...string[]]): T | null {
  const wanted = [...new Set(terms.map(textKey).filter(Boolean))];
  if (!wanted.length) {
    return null;
  }
  const exact = list.find((entry) => spellingsOf(entry).some((spelling) => wanted.includes(textKey(spelling))));
  if (exact) {
    return exact;
  }
  const parts = list.filter((entry) => {
    const name = ` ${textKey(spellingsOf(entry)[0])} `;
    return wanted.some((term) => name.includes(` ${term} `));
  });
  return parts.length === 1 ? parts[0] : null;
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
