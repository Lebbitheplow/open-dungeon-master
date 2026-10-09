// Who is talking (docs/vtt-parity-implementation-plan.md section 8.1).
// A DM message may be spoken as one person outright (speaker_json), or
// its quoted lines may be attributed after the fact, the way a reader does
// it: by the line's own tag ("...," says Marla; "...?" she asks), else by
// whoever the sentence before it is about ("Marla looks up."), else, for a
// line that opens its paragraph, by the action after it ("Not tonight."
// Venn frowns.). A name that is merely nearby proves nothing: after "Sella
// turns to Liriel." the line is Sella's, and when Sella is nobody the
// table knows, it is nobody's. Conservative on purpose: an unattributed
// quote stays the narrator's, because a wrong face on a line is worse than
// none. Pure, so the tests, the transcript and the narration voices all
// read a passage the same way.

import {
  aboutSubject,
  genderOf,
  gendersIn,
  keyOf,
  LEAD,
  nameAt,
  PRONOUN,
  QUOTE,
  QUOTE_OPEN,
  runsOf,
  sentencesOf,
  SPEECH_VERB,
  speakerMatchers,
  subjectOf,
  wordCount,
  written,
  type Gender,
  type Matcher,
  type Named,
  type Pointer,
  type Subject,
} from "@/lib/dm/speech-prose";

export { speakerMatchers, subjectRuns } from "@/lib/dm/speech-prose";

// `pc` is a character at the table (a player's, or an AI companion): never
// stored on a message, only found in the prose. `aliases` are other names
// the same person answers to.
export type Speaker = { kind: "narrator" | "npc" | "monster" | "pc"; id: string; name: string; aliases?: string[] };

export type SpeechSegment =
  | { kind: "prose"; text: string }
  // `cue` is what the prose said about the speaker where it pointed at
  // them ("she says, smiling"), for casting a voice (src/lib/tts.ts).
  | { kind: "speech"; text: string; speaker: Speaker; cue?: string };

// How far a tag may run between the two halves of one split line.
export const SPEECH_WINDOW_WORDS = 8;

// The tag straight after a line, when the words there are one: "...,"
// says Marla; "...?" she asks; "Who's there?" Marla calls. Null when they
// are not a tag ("Not tonight." Venn frowns.).
function tagOf(line: string, after: string, matchers: Matcher[]): Subject | null {
  const text = (sentencesOf(after)[0]?.text ?? "").replace(LEAD, "").trimEnd();
  if (!text) {
    return null;
  }
  const continues = /[,—–-]$/.test(line.trimEnd()) || /^\s*[,—–]/.test(after) || /^\p{Ll}/u.test(text);
  let subject = subjectOf(text, matchers);
  let verbFirst = false;
  // "says Old Pike", "orders the Captain"
  const verb = /^(\p{Ll}+)\s+/u.exec(text);
  if (subject.kind === "other" && verb && SPEECH_VERB.test(verb[1])) {
    verbFirst = true;
    const rest = text.slice(verb[0].length);
    const named = nameAt(rest, matchers);
    const pronoun = PRONOUN.exec(rest);
    subject = named
      ? { kind: "name", speaker: named.speaker, text: rest, end: named.end }
      : pronoun
        ? { kind: "pronoun", text: rest, end: pronoun[0].length }
        : { kind: "other" };
  }
  if (continues || verbFirst) {
    return subject;
  }
  // A line that ends its own sentence is tagged only by somebody saying it.
  if (subject.kind === "name" || subject.kind === "pronoun") {
    const next = /^\s+(\p{L}+)/u.exec(subject.text.slice(subject.end));
    if (next && SPEECH_VERB.test(next[1])) {
      return subject;
    }
  }
  return null;
}

// A sentence that hands the floor straight to the line after it: "Pike
// watches as Marla says:", "Vorian shouts,".
function leadIn(sentence: string, matchers: Matcher[]): Named | null {
  if (!/[,:]\s*$/.test(sentence)) {
    return null;
  }
  let last: { speaker: Speaker; start: number; end: number } | null = null;
  for (const { speaker, pattern, short } of matchers) {
    pattern.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = pattern.exec(sentence))) {
      if (written(found, short) && (!last || found.index + found[0].length > last.end)) {
        last = { speaker, start: found.index, end: found.index + found[0].length };
      }
    }
  }
  if (!last) {
    return null;
  }
  const tail = /^\s+(\p{L}+)(?:\s+\p{L}+ly)?\s*[,:]\s*$/u.exec(sentence.slice(last.end));
  if (!tail || !SPEECH_VERB.test(tail[1])) {
    return null;
  }
  const text = sentence.slice(last.start);
  return { kind: "name", speaker: last.speaker, text, end: last.end - last.start };
}

type Attribution = { speaker: Speaker; cue: string };

type Context = {
  matchers: Matcher[];
  // What the whole passage calls each known person, by keyOf.
  genders: Map<string, Gender>;
};

// Who the prose before a line is about: the person its last sentence
// opens with, or, when that sentence says "she" or "he", the person the
// sentences before it were about, back to the previous line's speaker.
// `told` is the pronoun of the line's own tag ("...," she says). A
// pronoun is only followed back past a sentence that names somebody else
// as well when the passage shows it means the person followed, and never
// when "she" and "he" both stand for the speaker.
function lookBack(before: string, previous: Speaker | null, afterLine: boolean, context: Context, told: Pointer | null): Attribution | null {
  const { matchers, genders } = context;
  const sentences = sentencesOf(before);
  const last = sentences[sentences.length - 1];
  if (!told && last) {
    const lead = leadIn(last.text, matchers);
    if (lead) {
      return { speaker: lead.speaker, cue: aboutSubject(lead).text };
    }
  }
  const cue: string[] = told ? [aboutSubject(told).text] : [];
  // Every way the line's tag and the sentences followed back call the
  // speaker: two different ways is two people.
  const said = new Set<Gender>(told ? gendersIn(cue[0]) : []);
  const agrees = (speaker: Speaker) => {
    const known = genders.get(keyOf(speaker)) ?? "";
    return !known || !said.size || said.has(known);
  };
  let chained = told !== null;
  for (let index = sentences.length - 1; index >= Math.max(0, sentences.length - 4); index -= 1) {
    let subject = subjectOf(sentences[index].text, matchers);
    // The words straight after the previous line are its tag, about its
    // speaker, which a pronoun after them follows ("...," says Marla. She
    // sits.). With nothing between, the tag settles nothing: "...," said
    // Marla. "Fine." may be anyone's reply.
    if (index === 0 && afterLine && /^[\s,—–]*\p{Ll}/u.test(sentences[0].text)) {
      if (!chained) {
        return null;
      }
      subject = previous ? { kind: "name", speaker: previous, text: "", end: 0 } : { kind: "other" };
    }
    if (subject.kind === "none") {
      continue;
    }
    if (subject.kind === "other") {
      return null;
    }
    const about = aboutSubject(subject);
    cue.unshift(about.text);
    const gender = genderOf(about.text);
    for (const named of gendersIn(about.text)) {
      said.add(named);
    }
    if (said.size > 1) {
      return null;
    }
    if (subject.kind === "name") {
      if (chained) {
        // Somebody else is named here too, so "she" could be them. It is
        // settled when the passage calls this person "she" as well, or calls
        // the other one "he" ("Marla turns to Pike, his face grim.").
        const known = genders.get(keyOf(subject.speaker)) || gender;
        const others = gendersIn(about.rest);
        const ruledOut = said.size === 1 && others.length === 1 && !said.has(others[0]);
        if (!agrees(subject.speaker) || (!about.whole && !(known && said.has(known)) && !ruledOut)) {
          return null;
        }
      }
      return { speaker: subject.speaker, cue: cue.join(" ").trim() };
    }
    chained = true;
  }
  // Every sentence since the previous line went on about "her": the one
  // who spoke it.
  if (chained && afterLine && previous && sentences.length <= 4 && agrees(previous)) {
    return { speaker: previous, cue: cue.join(" ").trim() };
  }
  return null;
}

// Who said the line at [start, end), when the prose around it says.
function whoSaid(
  text: string,
  line: { start: number; end: number; words: string },
  boundary: number,
  previous: Speaker | null,
  context: Context,
): Attribution | null {
  const lineStart = text.lastIndexOf("\n", line.start - 1) + 1;
  const lineEnd = text.indexOf("\n", line.end);
  const nextQuote = text.slice(line.end).search(QUOTE_OPEN);
  const stop = Math.min(lineEnd === -1 ? text.length : lineEnd, nextQuote === -1 ? text.length : line.end + nextQuote);
  const after = text.slice(line.end, stop);
  const before = text.slice(boundary, line.start);
  const back = (told: Pointer | null) => lookBack(before, boundary > 0 ? previous : null, boundary > 0, context, told);
  const tag = tagOf(line.words, after, context.matchers);
  if (tag) {
    if (tag.kind === "name") {
      return { speaker: tag.speaker, cue: aboutSubject(tag).text };
    }
    return tag.kind === "pronoun" ? back(tag) : null;
  }
  // Prose before the line in its own paragraph: whoever that is about.
  if (text.slice(Math.max(boundary, lineStart), line.start).trim()) {
    return back(null);
  }
  // The line opens its paragraph. An action after it in the same paragraph
  // is the speaker's own ("Not tonight." Venn frowns.).
  const beat = subjectOf(sentencesOf(after)[0]?.text ?? "", context.matchers);
  if (beat.kind === "name") {
    return { speaker: beat.speaker, cue: aboutSubject(beat).text };
  }
  if (beat.kind === "other") {
    return null;
  }
  // Otherwise the paragraph before, unless that one had a line of its own:
  // a paragraph that opens on a line after dialogue is a reply, and the
  // one person it is surely not is whoever spoke last.
  const earlier = text.slice(0, lineStart).trimEnd();
  if (boundary > earlier.lastIndexOf("\n") + 1) {
    return null;
  }
  return back(beat.kind === "pronoun" ? beat : null);
}

// The message as prose and attributed speech, in order. `speakers` are the
// people the table knows; a quote the prose does not tie to one of them
// stays prose.
export function attributeSpeech(text: string, speakers: Speaker[]): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  if (!speakers.length) {
    return text ? [{ kind: "prose", text }] : [];
  }
  const matchers = speakerMatchers(speakers);
  const genders = new Map<string, Gender>();
  const counted = new Map<string, string>();
  for (const run of runsOf(text, matchers)) {
    counted.set(keyOf(run.speaker), `${counted.get(keyOf(run.speaker)) ?? ""} ${run.text}`);
  }
  for (const [key, about] of counted) {
    genders.set(key, genderOf(about));
  }
  const context: Context = { matchers, genders };
  // Where the prose before the next line starts: the end of the last line
  // put on someone, and the end of the last line at all.
  let last = 0;
  let boundary = 0;
  // Who spoke the line that ended at `boundary`, for a line the tag splits
  // in two: "We ride at dawn," said Marla, "and not a moment later."
  let previous: Speaker | null = null;
  for (const match of text.matchAll(QUOTE)) {
    const start = match.index;
    const end = start + match[0].length;
    // The tag between this line and the last one ends on a comma: the
    // sentence, and so the speaker, carries on, whoever is named next
    // ("...," says Marla, "..." Pike spits). A full stop there settles
    // nothing, as a reply may be anyone's.
    const between = text.slice(boundary, start);
    const carriesOn: boolean =
      previous !== null && /,\s*$/.test(between) && wordCount(between) <= SPEECH_WINDOW_WORDS && !between.includes("\n");
    const found: Attribution | null = carriesOn
      ? { speaker: previous as Speaker, cue: "" }
      : whoSaid(text, { start, end, words: match[1] }, boundary, previous, context);
    boundary = end;
    previous = found?.speaker ?? null;
    if (!found) {
      continue;
    }
    if (start > last) {
      out.push({ kind: "prose", text: text.slice(last, start) });
    }
    out.push(found.cue ? { kind: "speech", text: match[1], speaker: found.speaker, cue: found.cue } : { kind: "speech", text: match[1], speaker: found.speaker });
    last = end;
  }
  if (last < text.length) {
    out.push({ kind: "prose", text: text.slice(last) });
  }
  return out.filter((segment) => segment.text.trim().length > 0);
}

// A player's Say (the composer's Say mode) as one quoted line. Words that
// carry quotation marks of their own go as written: they are already a
// line, or action with the line inside it ("Liriel leaves the stone. "Then
// tell us.""), which wrapping again turned wholly into speech.
export function spokenLine(text: string): string {
  const trimmed = text.trim();
  return /[“”"]/.test(trimmed) ? trimmed : `"${trimmed}"`;
}

// Every speaker with a line, once, in the order they first speak.
export function speakersIn(segments: SpeechSegment[]): Speaker[] {
  const seen = new Set<string>();
  const out: Speaker[] = [];
  for (const segment of segments) {
    if (segment.kind === "speech" && !seen.has(segment.speaker.name.toLowerCase())) {
      seen.add(segment.speaker.name.toLowerCase());
      out.push(segment.speaker);
    }
  }
  return out;
}

export function normalizeSpeaker(raw: unknown): Speaker | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind === "npc" || record.kind === "monster" ? record.kind : record.kind === "narrator" ? "narrator" : null;
  const name = typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
  if (!kind || (kind !== "narrator" && !name)) {
    return null;
  }
  return { kind, id: typeof record.id === "string" ? record.id.slice(0, 64) : "", name };
}
