// Reading text in the table's language: Snowball's stemmer and stop list for
// it, English included, so every lexical reader (retrieval, waypoints, goal
// collisions, safety lines, the rulebook) compares words the same way at
// every table. No hand-written vocabulary: the stemmers are Snowball's own
// algorithms (multilingual-stemmer), the stop lists Snowball's own files
// (./stop-words). Pure apart from that package, so scripts load it directly.

import * as snowball from "multilingual-stemmer";
import type { TableLanguage } from "../schemas/game-settings-options.ts";
import { textKey, words } from "./text-logic.ts";
import { STOP_LIST as danish } from "./stop-words/danish.ts";
import { STOP_LIST as dutch } from "./stop-words/dutch.ts";
import { STOP_LIST as english } from "./stop-words/english.ts";
import { STOP_LIST as finnish } from "./stop-words/finnish.ts";
import { STOP_LIST as french } from "./stop-words/french.ts";
import { STOP_LIST as german } from "./stop-words/german.ts";
import { STOP_LIST as hungarian } from "./stop-words/hungarian.ts";
import { STOP_LIST as indonesian } from "./stop-words/indonesian.ts";
import { STOP_LIST as irish } from "./stop-words/irish.ts";
import { STOP_LIST as italian } from "./stop-words/italian.ts";
import { STOP_LIST as norwegian } from "./stop-words/norwegian.ts";
import { STOP_LIST as portuguese } from "./stop-words/portuguese.ts";
import { STOP_LIST as russian } from "./stop-words/russian.ts";
import { STOP_LIST as spanish } from "./stop-words/spanish.ts";
import { STOP_LIST as swedish } from "./stop-words/swedish.ts";

const STEMMERS: Record<TableLanguage, (word: string) => string> = {
  danish: snowball.danish,
  dutch: snowball.dutch,
  english: snowball.english,
  finnish: snowball.finnish,
  french: snowball.french,
  german: snowball.german,
  hungarian: snowball.hungarian,
  indonesian: snowball.indonesian,
  irish: snowball.irish,
  italian: snowball.italian,
  norwegian: snowball.norwegian,
  portuguese: snowball.portuguese,
  russian: snowball.russian,
  spanish: snowball.spanish,
  swedish: snowball.swedish,
};

const STOP_LISTS: Record<TableLanguage, string> = {
  danish,
  dutch,
  english,
  finnish,
  french,
  german,
  hungarian,
  indonesian,
  irish,
  italian,
  norwegian,
  portuguese,
  russian,
  spanish,
  swedish,
};

const stopSets = new Map<TableLanguage, ReadonlySet<string>>();

// Every word written before a line's "|" comment (Snowball's file format).
export function stopWordsFor(language: TableLanguage): ReadonlySet<string> {
  let set = stopSets.get(language);
  if (!set) {
    set = new Set(
      STOP_LISTS[language]
        .split("\n")
        .flatMap((line) => line.split("|")[0].trim().split(/\s+/))
        .filter(Boolean)
        // As written, not keyed: a few entries carry an elision's apostrophe
        // or a full stop ("d'", "ill."), which no word token ever equals, and
        // keying them would make "d" a stop word.
        .map((word) => word.normalize("NFKC").toLowerCase()),
    );
    stopSets.set(language, set);
  }
  return set;
}

export function stemWord(word: string, language: TableLanguage): string {
  return STEMMERS[language](word);
}

// The text as the stems it is compared by: its words, lower-cased, minus the
// language's stop words (checked on the whole word, which is how Snowball's
// lists are written: English lists "don't" whole, Italian lists the elided
// "dell" on its own), each stemmed.
//
// Stemming is most of the cost of reading a text this way, and the same few
// thousand words recur across a campaign's lore, notes and facts, so each
// word's stem is remembered per language (bounded: a table that writes a
// great many distinct words starts the memo over rather than growing it).
const STEM_MEMO_LIMIT = 50_000;
const stemMemos = new Map<TableLanguage, Map<string, string>>();

function memoStem(word: string, language: TableLanguage): string {
  let memo = stemMemos.get(language);
  if (!memo) {
    memo = new Map();
    stemMemos.set(language, memo);
  }
  let stem = memo.get(word);
  if (stem === undefined) {
    stem = STEMMERS[language](word);
    if (memo.size >= STEM_MEMO_LIMIT) memo.clear();
    memo.set(word, stem);
  }
  return stem;
}

// A text's words in lower case, each whole ("dell'oracolo", "don't"): what a
// stemmer and a stop list read.
export function stemmerWords(text: string): string[] {
  return words(text).map((word) => word.toLowerCase());
}

export function stems(text: string, language: TableLanguage): string[] {
  const stop = stopWordsFor(language);
  return stemmerWords(text)
    .filter((word) => !stop.has(word))
    .map((word) => memoStem(word, language));
}

// A name as someone writes it with an article or a possessive before it ("the
// wolf", "il lupo", "her claws", "l'arco"): the leading words of the table
// language's stop list taken off. Every Snowball list holds its language's
// articles and possessives, so the one rule reads every table; the last word
// always stays. Keys in, a key out (textKey).
export function withoutLeadingStopWords(key: string, language: TableLanguage): string {
  const stop = stopWordsFor(language);
  const parts = key.split(" ");
  let start = 0;
  while (start < parts.length - 1 && stop.has(parts[start])) {
    start += 1;
  }
  return parts.slice(start).join(" ");
}

// The ways to read a name someone wrote, in order: as written, then without
// its leading article or possessive (withoutLeadingStopWords). Empty for no
// name.
export function nameTerms(text: string | undefined, language: TableLanguage): string[] {
  const key = textKey(text ?? "");
  return key ? [...new Set([key, withoutLeadingStopWords(key, language)])] : [];
}
