// Reading the prose around a line of dialogue (src/lib/dm/speech.ts):
// where its sentences end, who each one is about, and what it calls them.
// Pure, like the attribution it serves.
//
// It reads structure, the same way in every table language: quote pairs,
// sentence ends, known names and where they stand. The one exception is
// English, whose pronouns ("she", "he", "her") are followed back to the
// person they mean (Reading.pronouns): languages that drop the subject
// pronoun (Italian, Spanish, Portuguese) or have no gendered one (Finnish,
// Hungarian, Indonesian) give that reading nothing to hold on to.

import type { Speaker } from "@/lib/dm/speech";
import type { GenderMark } from "@/lib/gender";

// A quoted line, in any pair prose uses: “…”, "…", «…», „…“, »…«. Only a
// matched pair is a line, so an apostrophe or a lone guillemet opens
// nothing; never across a line break, so one unclosed quote cannot swallow
// the paragraph after it.
export const QUOTE = /[“"]([^“”"\n]{2,600})[”"]|«([^«»\n]{2,600})»|„([^„“”\n]{2,600})[“”]|»([^»«\n]{2,600})«/g;
export const QUOTE_OPEN = /[“"«„»]/;

// The words inside a QUOTE match, without its marks or the spaces French
// sets inside them (« Tenez »).
export function quotedText(match: RegExpMatchArray): string {
  return (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function nameWords(name: string): string[] {
  return name
    .split(/[\s,]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

// `short` holds the single words of a longer name, lower-cased: they only
// count where the prose writes them as a name (`named`).
export type Matcher = { speaker: Speaker; pattern: RegExp; short: Set<string> };

// Every name a speaker may go by in the prose: their name, their aliases,
// and any one word of a longer name ("Marla" or "Venn" for "Marla Venn")
// that nobody else at the table shares. Built once per message, longest
// spelling first so "Marla Venn" is never read as "Marla" with a word left
// over.
export function speakerMatchers(speakers: Speaker[]): Matcher[] {
  const claimed = new Map<string, number>();
  const full = new Set<string>();
  for (const speaker of speakers) {
    for (const name of [speaker.name, ...(speaker.aliases ?? [])]) {
      full.add(name.trim().toLowerCase());
    }
    for (const word of new Set(nameWords(speaker.name).map((entry) => entry.toLowerCase()))) {
      claimed.set(word, (claimed.get(word) ?? 0) + 1);
    }
  }
  const matchers: Matcher[] = [];
  for (const speaker of speakers) {
    const names = new Set<string>();
    for (const name of [speaker.name, ...(speaker.aliases ?? [])]) {
      if (name.trim()) {
        names.add(name.trim());
      }
    }
    const short = new Set<string>();
    const words = nameWords(speaker.name);
    if (words.length > 1) {
      for (const word of words) {
        const key = word.toLowerCase();
        if (word.length >= 3 && /^\p{Lu}/u.test(word) && claimed.get(key) === 1 && !full.has(key)) {
          names.add(word);
          short.add(key);
        }
      }
    }
    if (!names.size) {
      continue;
    }
    const spellings = [...names].sort((a, b) => b.length - a.length).map(escapeRegExp);
    // Letter-aware edges, not \b, which takes "É" or "ø" for a gap and
    // so never found "Élodie" at all.
    matchers.push({ speaker, pattern: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${spellings.join("|")})(?![\\p{L}\\p{N}_])`, "giu"), short });
  }
  return matchers;
}

export type Reading = {
  matchers: Matcher[];
  // commonWords over the recent story and this passage.
  common: ReadonlySet<string>;
  // English only: follow "she" and "he" back to the person they mean.
  pronouns: boolean;
};

// Whether nothing but punctuation stands before a word in its sentence.
export function opensSentence(before: string): boolean {
  return /^[\s"“”'‘’«»„*_(\[—–,:;-]*$/u.test(before);
}

// "Hill" is Tom Hill; "the hill" is a hill. At a sentence start, where every
// word has a capital, a word of a longer name counts only if the story never
// writes it in lower case: "Marla frowns." is Marla, "Old habits die hard"
// is not Old Pike.
export function written(found: RegExpExecArray, short: Set<string>, reading: Reading, atStart: boolean): boolean {
  const key = found[0].toLowerCase();
  if (!short.has(key)) {
    return true;
  }
  return /^\p{Lu}/u.test(found[0]) && !(atStart && reading.common.has(key));
}

export type Found = { speaker: Speaker; end: number };

// The known person a stretch of prose opens with, past a common word or two:
// "Old Pike", "Captain Venn", "the Captain".
export function nameAt(text: string, reading: Reading, atStart: boolean): Found | null {
  let offset = 0;
  for (let skipped = 0; skipped <= 2; skipped += 1) {
    const rest = text.slice(offset);
    let best: Found | null = null;
    for (const { speaker, pattern, short } of reading.matchers) {
      pattern.lastIndex = 0;
      const found = pattern.exec(rest);
      if (found && found.index === 0 && written(found, short, reading, atStart && offset === 0) && (!best || offset + found[0].length > best.end)) {
        best = { speaker, end: offset + found[0].length };
      }
    }
    if (best) {
      return best;
    }
    const word = /^([\p{L}'’-]+)\s+/u.exec(rest);
    if (!word || !reading.common.has(word[1].toLowerCase())) {
      return null;
    }
    offset += word[0].length;
  }
  return null;
}

// Words that carry on about someone already named: "She smiles", "His
// voice drops". "It" is left out: "It is cold" is about nobody.
const PRONOUN = /^(she|he|they|her|his|their|hers|him|them)\b/i;
// What a stretch about one person calls them: "she" or "he" where a
// clause opens ("She sighs, and he shrugs" is two people), and the "her"
// and "his" that are theirs. "Him" after a verb is somebody else.
const OWN = /(?:^|[,;:]\s+|\b(?:and|but|then|while)\s+)(she|he)\b|\b(her|hers|herself|his|himself)\b/gi;

// The pronoun a stretch of prose opens with, when the table reads pronouns.
export function pronounAt(text: string, reading: Reading): RegExpExecArray | null {
  return reading.pronouns ? PRONOUN.exec(text) : null;
}

function pronounCounts(text: string, reading: Reading): { f: number; m: number } {
  let f = 0;
  let m = 0;
  if (!reading.pronouns) {
    return { f, m };
  }
  for (const match of text.matchAll(OWN)) {
    if (/^(?:she|her|hers|herself)$/i.test(match[1] ?? match[2])) {
      f += 1;
    } else {
      m += 1;
    }
  }
  return { f, m };
}

// What a stretch of prose about one person calls them, when it is clear.
export function genderOf(text: string, reading: Reading): GenderMark {
  const { f, m } = pronounCounts(text, reading);
  return f > 0 && f >= 2 * m ? "f" : m > 0 && m >= 2 * f ? "m" : "";
}

// Every way a stretch calls the people it is about.
export function gendersIn(text: string, reading: Reading): GenderMark[] {
  const { f, m } = pronounCounts(text, reading);
  return [...(f ? ["f" as const] : []), ...(m ? ["m" as const] : [])];
}

export type Sentence = { text: string; start: number };

// A sentence ends at . ! ? or … before a capital, a quote or the end of the
// text, and at every line break; "It's... consumption" stays one sentence.
const SENTENCE_END = /[.!?…]+["'”’»«)\]*_]*(?=\s+[\p{Lu}"“‘'«»„*_(\[]|\s*$)|\n+/gu;

export function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  const cut = (to: number) => {
    if (text.slice(from, to).trim()) {
      out.push({ text: text.slice(from, to), start: from });
    }
    from = to;
  };
  for (const match of text.matchAll(SENTENCE_END)) {
    cut(match.index + match[0].length);
  }
  cut(text.length);
  return out;
}

// What a sentence may open with before its first word: a stray quote,
// emphasis, a dash, the comma of a tag written outside its quote.
export const LEAD = /^[\s"“”'‘’«»„*_(\[—–,:;-]+/u;

export type Subject =
  | { kind: "name"; speaker: Speaker; text: string; end: number }
  | { kind: "pronoun"; text: string; end: number }
  | { kind: "other" }
  | { kind: "none" };

export type Pointer = Extract<Subject, { kind: "name" | "pronoun" }>;
export type Named = Extract<Subject, { kind: "name" }>;

// Who a sentence is about: the known person or the pronoun it opens with
// ("Marla looks up", "She smiles"), "other" when it opens with anybody or
// anything else ("Sella nods", "The fire pops", "says Marla"). A short
// phrase may come first ("With a sigh, Marla stands"): a few words before a
// comma, none of them written with a capital.
export function subjectOf(sentence: string, reading: Reading, atStart = true): Subject {
  const text = sentence.replace(LEAD, "").trimEnd();
  if (!text) {
    return { kind: "none" };
  }
  const at = (body: string, start: boolean): Pointer | null => {
    const found = nameAt(body, reading, start);
    if (found) {
      return { kind: "name", speaker: found.speaker, text: body, end: found.end };
    }
    const pronoun = pronounAt(body, reading);
    return pronoun ? { kind: "pronoun", text: body, end: pronoun[0].length } : null;
  };
  const direct = at(text, atStart);
  if (direct) {
    return direct;
  }
  const opening = /^([^,;:]{1,60}),\s+/u.exec(text);
  if (opening && wordCount(opening[1]) <= 4 && !/\s\p{Lu}/u.test(opening[1])) {
    const after = at(text.slice(opening[0].length), false);
    if (after) {
      return after;
    }
  }
  return { kind: "other" };
}

// What a sentence says about the person it opens with, up to where
// anybody else is named (`rest`, empty when nobody else is).
export function aboutSubject(subject: Pointer): { text: string; whole: boolean; rest: string } {
  const other = subject.text.slice(subject.end).search(/\s\p{Lu}/u);
  return other === -1
    ? { text: subject.text.trim(), whole: true, rest: "" }
    : { text: subject.text.slice(0, subject.end + other).trim(), whole: false, rest: subject.text.slice(subject.end + other) };
}

export function keyOf(speaker: Speaker): string {
  return speaker.id || speaker.name.toLowerCase();
}
