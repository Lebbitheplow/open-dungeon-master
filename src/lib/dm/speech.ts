// Who is talking (docs/vtt-parity-implementation-plan.md section 8.1).
// A DM message may be spoken as one person outright (speaker_json), or
// its quoted lines may be attributed after the fact. Who said each line is
// decided on the server when the message is written and stored with it
// (SpokenLine, campaign_messages.speech_json): attributeSpeech below reads
// person-written text, and model-written text gets the claims reader's
// speakers first (src/lib/dm/claims.ts), with attributeSpeech for the lines
// the reader leaves out. The transcript, the scene inserts and the
// narration voices all draw the stored lines (segmentsOf), so they can never
// disagree.
//
// attributeSpeech reads a passage the way a reader does it: by the line's
// own tag ("...," says Marla; "...", dice Marla), else by whoever the
// sentence before it is about ("Marla looks up."), else, for a line that
// opens its paragraph, by the action after it ("Not tonight." Venn
// frowns.). A name that is merely nearby proves nothing: after "Sella turns
// to Liriel." the line is Sella's, and when Sella is nobody the table
// knows, it is nobody's. Conservative on purpose: an unattributed quote
// stays the narrator's, because a wrong face on a line is worse than none.
// It reads structure, so it reads every table language alike, with English
// pronouns as the one exception (src/lib/dm/speech-prose.ts). Pure.

import { genderMark, type Gender, type GenderMark } from "@/lib/gender";
import { commonWords } from "@/lib/language/text-logic";
import {
  aboutSubject,
  genderOf,
  gendersIn,
  keyOf,
  LEAD,
  nameAt,
  opensSentence,
  pronounAt,
  QUOTE,
  QUOTE_OPEN,
  quotedText,
  sentencesOf,
  speakerMatchers,
  subjectOf,
  wordCount,
  written,
  type Named,
  type Pointer,
  type Reading,
  type Subject,
} from "@/lib/dm/speech-prose";

// `pc` is a character at the table (a player's, or an AI companion), and
// `monster` a creature of the fight. `aliases` are other names the same
// person answers to, and `gender` the field the English pronouns are
// matched against; neither is stored with a line.
export type Speaker = {
  kind: "narrator" | "npc" | "monster" | "pc";
  id: string;
  name: string;
  aliases?: string[];
  gender?: Gender;
};

export type SpeechSegment = { kind: "prose"; text: string } | { kind: "speech"; text: string; speaker: Speaker };

// One attributed line of a message, by its words: the key a variant or an
// edit keeps for every line it leaves unchanged.
export type SpokenLine = { line: string; speaker: Speaker };

// How far a tag may run between the two halves of one split line.
export const SPEECH_WINDOW_WORDS = 8;

// The tag straight after a line that runs on into it: "...," says Marla;
// "...", dice Marla; "...?" she asks. A line that ends its own sentence
// has none the words can tell from an action ("Not tonight." Venn frowns.),
// so the prose around it decides.
function tagOf(line: string, after: string, reading: Reading): Subject | null {
  const text = (sentencesOf(after)[0]?.text ?? "").replace(LEAD, "").trimEnd();
  if (!text) {
    return null;
  }
  const continues = /[,—–-]$/.test(line.trimEnd()) || /^\s*[,—–]/.test(after) || /^\p{Ll}/u.test(text);
  if (!continues) {
    return null;
  }
  const subject = subjectOf(text, reading, false);
  if (subject.kind !== "other") {
    return subject;
  }
  // One word, then the speaker: "says Old Pike", "dice Marla", "orders the
  // Captain".
  const verb = /^(\p{Ll}+)\s+/u.exec(text);
  if (!verb) {
    return subject;
  }
  const rest = text.slice(verb[0].length);
  const found = nameAt(rest, reading, false);
  const pronoun = pronounAt(rest, reading);
  return found
    ? { kind: "name", speaker: found.speaker, text: rest, end: found.end }
    : pronoun
      ? { kind: "pronoun", text: rest, end: pronoun[0].length }
      : { kind: "other" };
}

// A sentence that hands the floor straight to the line after it: a known
// name, a word or two, and the comma or colon before the line ("Pike
// watches as Marla says,", "Vorian grida:").
function leadIn(sentence: string, reading: Reading): Named | null {
  if (!/[,:]\s*$/.test(sentence)) {
    return null;
  }
  let last: { speaker: Named["speaker"]; start: number; end: number } | null = null;
  for (const { speaker, pattern, short } of reading.matchers) {
    pattern.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = pattern.exec(sentence))) {
      const atStart = opensSentence(sentence.slice(0, found.index));
      if (written(found, short, reading, atStart) && (!last || found.index + found[0].length > last.end)) {
        last = { speaker, start: found.index, end: found.index + found[0].length };
      }
    }
  }
  if (!last || !/^(?:\s+\p{Ll}+){1,2}\s*[,:]\s*$/u.test(sentence.slice(last.end))) {
    return null;
  }
  const text = sentence.slice(last.start);
  return { kind: "name", speaker: last.speaker, text, end: last.end - last.start };
}

type Context = {
  reading: Reading;
  // Each known person's gender field, by keyOf, for the English pronouns.
  genders: Map<string, GenderMark>;
};

// Who the prose before a line is about: the person its last sentence
// opens with, or, at an English table, when that sentence says "she" or
// "he", the person the sentences before it were about, back to the
// previous line's speaker. `told` is the pronoun of the line's own tag
// ("...," she says). A pronoun is only followed back past a sentence that
// names somebody else as well when the passage shows it means the person
// followed, and never when "she" and "he" both stand for the speaker.
function lookBack(before: string, previous: Speaker | null, afterLine: boolean, context: Context, told: Pointer | null): Speaker | null {
  const { reading, genders } = context;
  const sentences = sentencesOf(before);
  const last = sentences[sentences.length - 1];
  if (!told && last) {
    const lead = leadIn(last.text, reading);
    if (lead) {
      return lead.speaker;
    }
  }
  // Every way the line's tag and the sentences followed back call the
  // speaker: two different ways is two people.
  const said = new Set<GenderMark>(told ? gendersIn(aboutSubject(told).text, reading) : []);
  const agrees = (speaker: Speaker) => {
    const known = genders.get(keyOf(speaker)) ?? "";
    return !known || !said.size || said.has(known);
  };
  let chained = told !== null;
  for (let index = sentences.length - 1; index >= Math.max(0, sentences.length - 4); index -= 1) {
    let subject = subjectOf(sentences[index].text, reading);
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
    const gender = genderOf(about.text, reading);
    for (const named of gendersIn(about.text, reading)) {
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
        const others = gendersIn(about.rest, reading);
        const ruledOut = said.size === 1 && others.length === 1 && !said.has(others[0]);
        if (!agrees(subject.speaker) || (!about.whole && !(known && said.has(known)) && !ruledOut)) {
          return null;
        }
      }
      return subject.speaker;
    }
    chained = true;
  }
  // Every sentence since the previous line went on about "her": the one
  // who spoke it.
  if (chained && afterLine && previous && sentences.length <= 4 && agrees(previous)) {
    return previous;
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
): Speaker | null {
  const lineStart = text.lastIndexOf("\n", line.start - 1) + 1;
  const lineEnd = text.indexOf("\n", line.end);
  const nextQuote = text.slice(line.end).search(QUOTE_OPEN);
  const stop = Math.min(lineEnd === -1 ? text.length : lineEnd, nextQuote === -1 ? text.length : line.end + nextQuote);
  const after = text.slice(line.end, stop);
  const before = text.slice(boundary, line.start);
  const back = (told: Pointer | null) => lookBack(before, boundary > 0 ? previous : null, boundary > 0, context, told);
  const tag = tagOf(line.words, after, context.reading);
  if (tag) {
    if (tag.kind === "name") {
      return tag.speaker;
    }
    return tag.kind === "pronoun" ? back(tag) : null;
  }
  // Prose before the line in its own paragraph: whoever that is about.
  if (text.slice(Math.max(boundary, lineStart), line.start).trim()) {
    return back(null);
  }
  // The line opens its paragraph. An action after it in the same paragraph
  // is the speaker's own ("Not tonight." Venn frowns.).
  const beat = subjectOf(sentencesOf(after)[0]?.text ?? "", context.reading, false);
  if (beat.kind === "name") {
    return beat.speaker;
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

// The message as prose and attributed speech, in order, read from its
// words. `speakers` are the people the table knows; a quote the prose does
// not tie to one of them stays prose. `common` is commonWords over the
// recent story (the passage's own words count too); `pronouns` is true at
// an English table only.
export function attributeSpeech(
  text: string,
  speakers: Speaker[],
  options: { common?: ReadonlySet<string>; pronouns: boolean },
): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  if (!speakers.length) {
    return text ? [{ kind: "prose", text }] : [];
  }
  const reading: Reading = {
    matchers: speakerMatchers(speakers),
    common: new Set([...(options.common ?? []), ...commonWords([text])]),
    pronouns: options.pronouns,
  };
  const genders = new Map<string, GenderMark>(
    speakers.map((speaker) => [keyOf(speaker), genderMark(speaker.gender)]),
  );
  const context: Context = { reading, genders };
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
    const words = quotedText(match);
    // The tag between this line and the last one ends on a comma: the
    // sentence, and so the speaker, carries on, whoever is named next
    // ("...," says Marla, "..." Pike spits). A full stop there settles
    // nothing, as a reply may be anyone's.
    const between = text.slice(boundary, start);
    const carriesOn: boolean =
      previous !== null && /,\s*$/.test(between) && wordCount(between) <= SPEECH_WINDOW_WORDS && !between.includes("\n");
    const found: Speaker | null = carriesOn ? previous : whoSaid(text, { start, end, words }, boundary, previous, context);
    boundary = end;
    previous = found;
    if (!found) {
      continue;
    }
    if (start > last) {
      out.push({ kind: "prose", text: text.slice(last, start) });
    }
    out.push({ kind: "speech", text: words, speaker: found });
    last = end;
  }
  if (last < text.length) {
    out.push({ kind: "prose", text: text.slice(last) });
  }
  return out.filter((segment) => segment.text.trim().length > 0);
}

// Who is stored as a line's speaker: who they are, never what they were
// matched by.
export function storedSpeaker(speaker: Speaker): Speaker {
  return { kind: speaker.kind, id: speaker.id, name: speaker.name };
}

// The attributed lines of a set of segments, for storing with the message.
export function linesOf(segments: SpeechSegment[]): SpokenLine[] {
  return segments.flatMap((segment) => (segment.kind === "speech" ? [{ line: segment.text, speaker: storedSpeaker(segment.speaker) }] : []));
}

// Whether a passage holds a quoted line at all: nothing to attribute
// otherwise.
export function hasQuotedLine(text: string): boolean {
  return [...text.matchAll(QUOTE)].length > 0;
}

// The message as prose and speech, from the lines stored with it: a quote
// whose words a stored line holds is that speaker's, every other quote
// stays prose.
export function segmentsOf(text: string, lines: readonly SpokenLine[]): SpeechSegment[] {
  const byWords = new Map(lines.map((entry) => [entry.line, entry.speaker]));
  const out: SpeechSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(QUOTE)) {
    const words = quotedText(match);
    const speaker = byWords.get(words);
    if (!speaker) {
      continue;
    }
    if (match.index > last) {
      out.push({ kind: "prose", text: text.slice(last, match.index) });
    }
    out.push({ kind: "speech", text: words, speaker });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "prose", text: text.slice(last) });
  }
  return out.filter((segment) => segment.text.trim().length > 0);
}

// The lines a message keeps after a rewrite: every earlier line, so an
// edit or a take switched back to keeps the speakers of the lines it did not
// change, and the new text's lines that are new.
export function mergeLines(earlier: readonly SpokenLine[], fresh: readonly SpokenLine[]): SpokenLine[] {
  const known = new Set(earlier.map((entry) => entry.line));
  return [...earlier, ...fresh.filter((entry) => !known.has(entry.line))];
}

// A player's Say (the composer's Say mode) as one quoted line. Words that
// carry quotation marks of their own go as written: they are already a
// line, or action with the line inside it ("Liriel leaves the stone. "Then
// tell us.""), which wrapping again turned wholly into speech.
export function spokenLine(text: string): string {
  const trimmed = text.trim();
  return /[“”"«»„]/.test(trimmed) ? trimmed : `"${trimmed}"`;
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

// The lines stored with a message (campaign_messages.speech_json), read
// back: a line or speaker that is not shaped as one is dropped.
export function normalizeSpokenLines(raw: unknown): SpokenLine[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry: unknown) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const speaker = record.speaker && typeof record.speaker === "object" ? (record.speaker as Record<string, unknown>) : {};
    const kind = speaker.kind === "npc" || speaker.kind === "pc" || speaker.kind === "monster" ? speaker.kind : null;
    const name = typeof speaker.name === "string" ? speaker.name.trim().slice(0, 80) : "";
    if (typeof record.line !== "string" || !record.line || !kind || !name) {
      return [];
    }
    return [{ line: record.line.slice(0, 600), speaker: { kind, id: typeof speaker.id === "string" ? speaker.id.slice(0, 64) : "", name } }];
  });
}
