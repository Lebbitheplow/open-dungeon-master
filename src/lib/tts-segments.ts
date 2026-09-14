import { attributeSpeech, type Speaker } from "@/lib/dm/speech";

// Which voice reads which part of a message (docs/vtt-parity-
// implementation-plan.md section 8.2). Prose is the narrator's; a line
// attributed to someone with a voice of their own is theirs; a message
// spoken outright as one person is all theirs. Pure: tts.ts renders what
// this plans, the test checks the plan.

export type CastVoice = { name: string; voiceId: string; speed: number };

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

export function planSpeech(
  text: string,
  options: { narratorVoice: string; cast: CastVoice[]; speaker?: Speaker | null },
): SpeechPlan {
  const byName = new Map(options.cast.map((entry) => [entry.name.toLowerCase(), entry]));
  const narrator = { voice: options.narratorVoice, speed: 1 };
  const voiceFor = (name: string) => {
    const own = byName.get(name.toLowerCase());
    return own ? { voice: own.voiceId, speed: own.speed } : narrator;
  };
  // Spoken outright as one person: the whole message in their voice.
  if (options.speaker && options.speaker.kind !== "narrator") {
    const chosen = voiceFor(options.speaker.name);
    return text.trim() ? [{ text: text.trim(), ...chosen, speaker: options.speaker.name }] : [];
  }
  // Only someone with a voice of their own is worth a cut in the audio.
  const speakers: Speaker[] = options.cast.filter((entry) => entry.voiceId).map((entry) => ({ kind: "npc", id: "", name: entry.name }));
  const plan: SpeechPlan = [];
  for (const segment of attributeSpeech(text, speakers)) {
    if (segment.kind === "speech") {
      plan.push({ text: segment.text.trim(), ...voiceFor(segment.speaker.name), speaker: segment.speaker.name });
    } else {
      // Adjacent prose runs merge so the narrator is not cut into crumbs.
      const previous = plan[plan.length - 1];
      if (previous && previous.speaker === null) {
        previous.text = `${previous.text} ${segment.text.trim()}`.trim();
      } else if (segment.text.trim()) {
        plan.push({ text: segment.text.trim(), ...narrator, speaker: null });
      }
    }
  }
  return plan;
}
