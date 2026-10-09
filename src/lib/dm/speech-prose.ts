// Reading the prose around a line of dialogue (src/lib/dm/speech.ts):
// where its sentences end, who each one is about, and what it calls them.
// Pure, like the attribution it serves.

import type { Speaker } from "@/lib/dm/speech";

// A quoted line. Never across a line break, so one unclosed quote cannot
// swallow the paragraph after it.
export const QUOTE = /[“"]([^“”"\n]{2,600})[”"]/g;
export const QUOTE_OPEN = /[“"]/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// Words of a name that are not the person: "Old Pike" is Pike, "Captain
// Marla Venn" is Marla or Venn, never "Old" or "Captain".
const NAME_NOISE = new Set([
  "the", "old", "young", "big", "little", "mad", "red", "black", "white", "grey", "gray",
  "captain", "sir", "lady", "lord", "dame", "king", "queen", "prince", "princess", "duke", "duchess",
  "baron", "baroness", "count", "countess", "brother", "sister", "father", "mother", "master", "mistress",
  "elder", "doctor", "professor", "sergeant", "commander", "general", "chief", "mayor", "guard", "priest",
  "priestess", "uncle", "aunt", "miss", "madam", "von", "van", "del", "and", "for",
]);

function nameWords(name: string): string[] {
  return name
    .split(/[\s,]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

// `short` holds the single words of a longer name, lower-cased: they only
// count where the prose writes them as a name, with a capital.
export type Matcher = { speaker: Speaker; pattern: RegExp; short: Set<string> };

// Every name a speaker may go by in the prose: their name, their aliases,
// and any one word of a longer name ("Marla" or "Venn" for "Captain Marla
// Venn") when it is a real name and nobody else at the table shares it.
// Built once per message, longest spelling first so "Marla Venn" is never
// read as "Marla" with a word left over.
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
        if (word.length >= 3 && /^\p{Lu}/u.test(word) && !NAME_NOISE.has(key) && claimed.get(key) === 1 && !full.has(key)) {
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

// "Hill" is Tom Hill; "the hill" is a hill.
export function written(found: RegExpExecArray, short: Set<string>): boolean {
  return !short.has(found[0].toLowerCase()) || /^\p{Lu}/u.test(found[0]);
}

export type Found = { speaker: Speaker; end: number };

// The known person a stretch of prose opens with, past a title or two:
// "Old Pike", "Captain Venn", "the Captain".
export function nameAt(text: string, matchers: Matcher[]): Found | null {
  let offset = 0;
  for (let skipped = 0; skipped <= 2; skipped += 1) {
    const rest = text.slice(offset);
    let best: Found | null = null;
    for (const { speaker, pattern, short } of matchers) {
      pattern.lastIndex = 0;
      const found = pattern.exec(rest);
      if (found && found.index === 0 && written(found, short) && (!best || offset + found[0].length > best.end)) {
        best = { speaker, end: offset + found[0].length };
      }
    }
    if (best) {
      return best;
    }
    const word = /^([\p{L}'’-]+)\s+/u.exec(rest);
    if (!word || !NAME_NOISE.has(word[1].toLowerCase())) {
      return null;
    }
    offset += word[0].length;
  }
  return null;
}

// Words that carry on about someone already named: "She smiles", "His
// voice drops". "It" is left out: "It is cold" is about nobody.
export const PRONOUN = /^(she|he|they|her|his|their|hers|him|them)\b/i;
// What a stretch about one person calls them: "she" or "he" where a
// clause opens ("She sighs, and he shrugs" is two people), and the "her"
// and "his" that are theirs. "Him" after a verb is somebody else.
const OWN = /(?:^|[,;:]\s+|\b(?:and|but|then|while)\s+)(she|he)\b|\b(her|hers|herself|his|himself)\b/gi;

export type Gender = "f" | "m" | "";

function pronounCounts(text: string): { f: number; m: number } {
  let f = 0;
  let m = 0;
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
export function genderOf(text: string): Gender {
  const { f, m } = pronounCounts(text);
  return f > 0 && f >= 2 * m ? "f" : m > 0 && m >= 2 * f ? "m" : "";
}

// Every way a stretch calls the people it is about.
export function gendersIn(text: string): Gender[] {
  const { f, m } = pronounCounts(text);
  return [...(f ? ["f" as const] : []), ...(m ? ["m" as const] : [])];
}

// Verbs of speech, for telling a tag ("Marla calls out") from an action
// ("Marla frowns") and for a sentence that hands the floor to a line
// ("Pike watches as Marla says:").
export const SPEECH_VERB =
  /^(?:(?:say|ask|call|shout|whisper|mutter|murmur|mumble|snarl|growl|hiss|demand|add|answer|yell|bark|insist|boom|warn|exclaim|declare|announce|command|order|plead|sigh|laugh|grunt|rasp|croak|intone|drawl|scoff|sneer|retort|interject|admit|agree|observe|explain|promise|tell|speak|offer|counter|protest|groan|gasp|stammer|stutter|whimper|purr|roar|bellow|howl|scream|repeat|remind|confirm|concede|greet|recite|chant|rumble|squeak|shriek|wheeze|quip|urge|assure|muse|wonder|continue|breathe|note|chuckle|venture|whine|hum|sing)(?:s|es|ed|d)?|said|told|spoke|sang|began|begins?|cr(?:y|ies|ied)|repl(?:y|ies|ied)|snap(?:s|ped)?|beg(?:s|ged)?)$/i;

export type Sentence = { text: string; start: number };

// A sentence ends at . ! ? or … before a capital, a quote or the end of the
// text, and at every line break; "It's... consumption" stays one sentence.
const SENTENCE_END = /[.!?…]+["'”’)\]*_]*(?=\s+[\p{Lu}"“‘'*_(\[]|\s*$)|\n+/gu;

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
export const LEAD = /^[\s"“”'‘’*_(\[—–,:;-]+/u;

// A short phrase before the subject: "With a sigh, Marla stands",
// "Without looking up, he says".
const OPENER =
  /^(?:\p{L}{3,}(?:ing|ly|ed)|with|without|after|before|at|for|in|on|then|now|still|once|as|despite|behind|beside|across|from|under|over|again)\b/iu;

export type Subject =
  | { kind: "name"; speaker: Speaker; text: string; end: number }
  | { kind: "pronoun"; text: string; end: number }
  | { kind: "other" }
  | { kind: "none" };

export type Pointer = Extract<Subject, { kind: "name" | "pronoun" }>;
export type Named = Extract<Subject, { kind: "name" }>;

// Who a sentence is about: the known person or the pronoun it opens with
// ("Marla looks up", "She smiles"), "other" when it opens with anybody or
// anything else ("Sella nods", "The fire pops", "says Marla").
export function subjectOf(sentence: string, matchers: Matcher[]): Subject {
  const text = sentence.replace(LEAD, "").trimEnd();
  if (!text) {
    return { kind: "none" };
  }
  const at = (body: string): Pointer | null => {
    const named = nameAt(body, matchers);
    if (named) {
      return { kind: "name", speaker: named.speaker, text: body, end: named.end };
    }
    const pronoun = PRONOUN.exec(body);
    return pronoun ? { kind: "pronoun", text: body, end: pronoun[0].length } : null;
  };
  const direct = at(text);
  if (direct) {
    return direct;
  }
  const opening = /^([^,;:]{1,60}),\s+/u.exec(text);
  if (opening && OPENER.test(opening[1]) && !/\s\p{Lu}/u.test(opening[1])) {
    const after = at(text.slice(opening[0].length));
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

export type Run = { speaker: Speaker; text: string; open: boolean };

export function runsOf(text: string, matchers: Matcher[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const sentence of sentencesOf(text.replace(QUOTE, " "))) {
    const subject = subjectOf(sentence.text, matchers);
    if (subject.kind === "name") {
      const about = aboutSubject(subject);
      current = { speaker: subject.speaker, text: about.text, open: about.whole };
      runs.push(current);
    } else if (subject.kind === "pronoun" && current?.open) {
      const about = aboutSubject(subject);
      current.text = `${current.text} ${about.text}`;
      current.open = about.whole;
    } else if (subject.kind !== "none") {
      current = null;
    }
  }
  return runs;
}

// Every stretch of prose about one known person, quotes left out: a
// sentence they open, cut where somebody else is named, and the sentences
// after it that carry on about "her" or "him" while nobody else has been
// named whom the pronoun could mean. What src/lib/tts-cast.ts reads a
// speaker's pronouns from.
export function subjectRuns(text: string, speakers: Speaker[]): Array<{ speaker: Speaker; text: string }> {
  return runsOf(text, speakerMatchers(speakers)).map(({ speaker, text: about }) => ({ speaker, text: about }));
}

export function keyOf(speaker: Speaker): string {
  return speaker.id || speaker.name.toLowerCase();
}
