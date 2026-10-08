// Reading text in the table's language: Snowball's stemmer and stop list for
// it, English included, so every lexical reader (retrieval, waypoints, goal
// collisions, safety lines, the rulebook) compares words the same way at
// every table. No hand-written vocabulary: the stemmers are Snowball's own
// algorithms (multilingual-stemmer), the stop lists Snowball's own files
// (./stop-words). Pure apart from that package, so scripts load it directly.

import * as snowball from "multilingual-stemmer";
import type { TableLanguage } from "../schemas/game-settings-options.ts";
import { words } from "./text-logic.ts";
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
        .map((word) => word.normalize("NFC").toLowerCase()),
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
export function stems(text: string, language: TableLanguage): string[] {
  const stop = stopWordsFor(language);
  return words(text.normalize("NFC"))
    .map((word) => word.toLowerCase())
    .filter((word) => !stop.has(word))
    .map((word) => STEMMERS[language](word));
}
