// Who is talking (docs/vtt-parity-implementation-plan.md section 8.1).
// A DM message may be spoken as one person outright (speaker_json), or
// its quoted lines may be attributed after the fact by finding a known
// name within a few words of each quote. Conservative on purpose: an
// unattributed quote stays the narrator's, because a wrong face on a line
// is worse than none. Pure, so the tests and the client both use it.

export type Speaker = { kind: "narrator" | "npc" | "monster"; id: string; name: string };

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

// The known speaker named nearest a quote: looking back over the words
// before it, or forward over the words after it, at most
// SPEECH_WINDOW_WORDS away. A name found after the quote is consumed, so
// the next quote cannot claim it as the name before itself.
function nearestSpeaker(before: string, after: string, speakers: Speaker[]): Nearest | null {
  let best: Nearest | null = null;
  for (const speaker of speakers) {
    const pattern = new RegExp(`\\b${escapeRegExp(speaker.name)}\\b`, "gi");
    let match: RegExpExecArray | null;
    let lastBack: RegExpExecArray | null = null;
    while ((match = pattern.exec(before))) {
      lastBack = match;
    }
    if (lastBack) {
      const distance = wordCount(before.slice(lastBack.index + lastBack[0].length));
      if (distance <= SPEECH_WINDOW_WORDS && (!best || distance < best.distance)) {
        best = { speaker, distance, consumedTo: 0 };
      }
    }
    pattern.lastIndex = 0;
    const forward = pattern.exec(after);
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
    const nearest = nearestSpeaker(before, after, speakers);
    if (!nearest) {
      continue;
    }
    consumed = end + nearest.consumedTo;
    if (start > last) {
      out.push({ kind: "prose", text: text.slice(last, start) });
    }
    out.push({ kind: "speech", text: match[1], speaker: nearest.speaker });
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
