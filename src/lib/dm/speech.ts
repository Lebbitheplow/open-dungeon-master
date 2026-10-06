// Who is talking (docs/vtt-parity-implementation-plan.md section 8.1).
// A DM message may be spoken as one person outright (speaker_json), or
// its quoted lines may be attributed after the fact by finding a known
// name within a few words of each quote. Conservative on purpose: an
// unattributed quote stays the narrator's, because a wrong face on a line
// is worse than none. Pure, so the tests and the client both use it.

// `pc` is a character at the table (a player's, or an AI companion): never
// stored on a message, only found in the prose. `aliases` are other names
// the same person answers to.
export type Speaker = { kind: "narrator" | "npc" | "monster" | "pc"; id: string; name: string; aliases?: string[] };

export type SpeechSegment =
  | { kind: "prose"; text: string }
  | { kind: "speech"; text: string; speaker: Speaker };

export const SPEECH_WINDOW_WORDS = 8;

const QUOTE = /[“"]([^“”"]{2,600})[”"]/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Nearest = { speaker: Speaker; distance: number; consumedTo: number };

function wordCount(text: string): number {
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
type Matcher = { speaker: Speaker; pattern: RegExp; short: Set<string> };

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
    matchers.push({ speaker, pattern: new RegExp(`\\b(?:${spellings.join("|")})\\b`, "gi"), short });
  }
  return matchers;
}

// The known speaker named nearest a quote: looking back over the words
// before it, or forward over the words after it, at most
// SPEECH_WINDOW_WORDS away. A name found after the quote is consumed, so
// the next quote cannot claim it as the name before itself.
function nearestSpeaker(before: string, after: string, matchers: Matcher[]): Nearest | null {
  let best: Nearest | null = null;
  for (const { speaker, pattern, short } of matchers) {
    // "Hill" is Tom Hill; "the hill" is a hill.
    const named = (found: RegExpExecArray) => !short.has(found[0].toLowerCase()) || /^\p{Lu}/u.test(found[0]);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastBack: RegExpExecArray | null = null;
    while ((match = pattern.exec(before))) {
      if (named(match)) {
        lastBack = match;
      }
    }
    if (lastBack) {
      const distance = wordCount(before.slice(lastBack.index + lastBack[0].length));
      if (distance <= SPEECH_WINDOW_WORDS && (!best || distance < best.distance)) {
        best = { speaker, distance, consumedTo: 0 };
      }
    }
    pattern.lastIndex = 0;
    let forward = pattern.exec(after);
    while (forward && !named(forward)) {
      forward = pattern.exec(after);
    }
    if (forward) {
      const distance = wordCount(after.slice(0, forward.index));
      if (distance <= SPEECH_WINDOW_WORDS && (!best || distance < best.distance)) {
        best = { speaker, distance, consumedTo: forward.index + forward[0].length };
      }
    }
  }
  return best;
}

// The message as prose and attributed speech, in order. `speakers` are the
// people the table knows; a quote near none of them stays prose.
export function attributeSpeech(text: string, speakers: Speaker[]): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  if (!speakers.length) {
    return text ? [{ kind: "prose", text }] : [];
  }
  let last = 0;
  // Where the previous quote's after-the-fact name ended, so the words
  // before this quote start past it.
  let consumed = 0;
  // Who spoke the quote that ended at `last`, for a line the tag splits in
  // two: "We ride at dawn," said Marla, "and not a moment later."
  let previous: Speaker | null = null;
  const matchers = speakerMatchers(speakers);
  QUOTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUOTE.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    // The words around the quote, stopping at the neighbouring quotes so
    // one line's attribution never borrows the last line's name.
    const before = text.slice(Math.max(last, consumed), start);
    const afterStop = text.slice(end).search(QUOTE_OPEN);
    const after = text.slice(end, afterStop === -1 ? undefined : end + afterStop);
    // The tag between this quote and the last one ends on a comma: the
    // sentence, and so the speaker, carries on, whoever is named next ("...,"
    // says Marla, "..." Pike spits). A full stop there settles nothing, as a
    // reply may be anyone's, and the line is left to the names around it.
    const between = text.slice(last, start);
    const carriesOn: boolean =
      previous !== null &&
      /,\s*$/.test(between) &&
      wordCount(between) <= SPEECH_WINDOW_WORDS &&
      !QUOTE_OPEN.test(between);
    const nearest: Nearest | null = carriesOn ? null : nearestSpeaker(before, after, matchers);
    const speaker: Speaker | null = carriesOn ? previous : (nearest?.speaker ?? null);
    if (!speaker) {
      continue;
    }
    consumed = end + (nearest?.consumedTo ?? 0);
    if (start > last) {
      out.push({ kind: "prose", text: text.slice(last, start) });
    }
    out.push({ kind: "speech", text: match[1], speaker });
    previous = speaker;
    last = end;
  }
  if (last < text.length) {
    out.push({ kind: "prose", text: text.slice(last) });
  }
  return out.filter((segment) => segment.text.trim().length > 0);
}

const QUOTE_OPEN = /[“"]/;

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
