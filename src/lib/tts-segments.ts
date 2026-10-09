import { attributeSpeech, type Speaker } from "@/lib/dm/speech";

// Which voice reads which part of a message (docs/vtt-parity-
// implementation-plan.md section 8.2, issue 97). Prose is the narrator's; a
// line attributed to someone with a voice of their own is theirs; a message
// spoken outright as one person is all theirs. Pure: tts.ts renders what
// this plans, the test checks the plan.

// Anyone who may speak: a cast member, a character at the table, a monster.
// `aliases` are other names the prose may use for them.
export type CastVoice = { name: string; voiceId: string; speed: number; aliases?: string[] };

export type SpeechPlan = Array<{ text: string; voice: string; speed: number; speaker: string | null }>;

export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.4;

export function clampSpeed(raw: unknown): number {
  const speed = Number(raw);
  if (!Number.isFinite(speed)) {
    return 1;
  }
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed)) * 100) / 100;
}

// "Goblin 2" and "Goblin B" on the board are both a Goblin: monsters are
// given a voice by what they are, not by which one of them is talking.
export function baseCreatureName(name: string): string {
  return name.trim().replace(/\s+(?:#?\d+|[A-Z])$/, "").trim() || name.trim();
}

export function planSpeech(
  text: string,
  options: { narratorVoice: string; narratorSpeed?: number; cast: CastVoice[]; speaker?: Speaker | null },
): SpeechPlan {
  const byName = new Map<string, CastVoice>();
  for (const entry of options.cast) {
    for (const name of [entry.name, ...(entry.aliases ?? [])]) {
      if (!byName.has(name.toLowerCase())) {
        byName.set(name.toLowerCase(), entry);
      }
    }
  }
  const narrator = { voice: options.narratorVoice, speed: clampSpeed(options.narratorSpeed ?? 1) };
  const voiceFor = (name: string) => {
    const own = byName.get(name.toLowerCase()) ?? byName.get(baseCreatureName(name).toLowerCase());
    return own?.voiceId ? { voice: own.voiceId, speed: own.speed } : narrator;
  };
  // The text keeps its line breaks for reading who said what; the speech
  // server hears each part as one flowing run.
  const flat = (part: string) => part.replace(/\s+/g, " ").trim();
  // Spoken outright as one person: the whole message in their voice.
  if (options.speaker && options.speaker.kind !== "narrator") {
    const chosen = voiceFor(options.speaker.name);
    return flat(text) ? [{ text: flat(text), ...chosen, speaker: options.speaker.name }] : [];
  }
  // Lines are read with the whole cast, as the transcript reads them, so a
  // voiceless speaker's line is never handed to the voiced name beside it;
  // only someone with a voice of their own is worth a cut in the audio.
  const speakers: Speaker[] = options.cast.map((entry) => ({ kind: "npc", id: "", name: entry.name, aliases: entry.aliases }));
  const plan: SpeechPlan = [];
  // The narrator's current run as written, quote marks and all.
  let run = "";
  let cursor = 0;
  for (const segment of attributeSpeech(text, speakers)) {
    const at = text.indexOf(segment.text, cursor);
    const written = segment.kind === "speech" && at > 0 ? text.slice(at - 1, at + segment.text.length + 1) : segment.text;
    cursor = at === -1 ? cursor : at + segment.text.length;
    const chosen = segment.kind === "speech" ? voiceFor(segment.speaker.name) : narrator;
    if (segment.kind === "speech" && chosen !== narrator) {
      plan.push({ text: flat(segment.text), ...chosen, speaker: segment.speaker.name });
      run = "";
    } else {
      // Adjacent prose runs merge so the narrator is not cut into crumbs.
      const previous = plan[plan.length - 1];
      run = previous && previous.speaker === null ? run + written : written;
      if (previous && previous.speaker === null) {
        previous.text = flat(run);
      } else if (flat(run)) {
        plan.push({ text: flat(run), ...narrator, speaker: null });
      }
    }
  }
  return plan;
}

// Text cut for the speech server. A long run is split at sentence ends so
// no request is unreasonably large, and the passage's very first request is
// kept short on purpose: it is the one the table waits on before a word is
// heard, and a short one comes back in well under a second.
export const FIRST_CHUNK_CHARS = 320;
export const CHUNK_CHARS = 1_200;

export function chunkSentences(text: string, firstLimit = CHUNK_CHARS, limit = CHUNK_CHARS): string[] {
  if (text.length <= firstLimit) {
    return [text];
  }
  const sentences = text.match(/[^.!?]+[.!?]+["')\]”’]*\s*|.+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const cap = chunks.length ? limit : firstLimit;
    if (current && current.length + sentence.length > cap) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

export type SpeechRequest = { text: string; voice: string; speed: number };

// The plan as the requests actually sent, in the order they are heard.
export function speechRequests(plan: SpeechPlan): SpeechRequest[] {
  const requests: SpeechRequest[] = [];
  for (const part of plan) {
    for (const text of chunkSentences(part.text, requests.length ? CHUNK_CHARS : FIRST_CHUNK_CHARS)) {
      if (/[\p{L}\p{N}]/u.test(text)) {
        requests.push({ text, voice: part.voice, speed: part.speed });
      }
    }
  }
  return requests;
}
