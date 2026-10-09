import { subjectRuns, type Speaker } from "@/lib/dm/speech";
import { TTS_VOICES } from "@/lib/tts-voices";

// Casting voices (issue 97): which of the server's voices suits a speaker
// nobody has chosen one for. Pure and deterministic, so the same table is
// always cast the same way and scripts/test-tts-cast.mjs can check it. The
// choice is saved the moment it is made, so it never drifts afterwards and
// the table can change it like any other.

export type VoiceGender = "f" | "m" | "";

// OpenAI's voices do not say what they sound like in their names.
const OPENAI_GENDER: Record<string, VoiceGender> = {
  ash: "m",
  ballad: "m",
  coral: "f",
  echo: "m",
  nova: "f",
  onyx: "m",
  sage: "f",
  shimmer: "f",
  verse: "m",
};

// Kokoro ids are <language><f|m>_<name>: af_heart, bm_george.
const KOKORO_ID = /^([a-z])([fm])_[a-z0-9]+$/;

export function voiceGender(voiceId: string): VoiceGender {
  const kokoro = KOKORO_ID.exec(voiceId);
  if (kokoro) {
    return kokoro[2] as VoiceGender;
  }
  return OPENAI_GENDER[voiceId] ?? "";
}

const FEMALE = /\b(she|her|hers|herself|woman|female|girl|lady|queen|princess|mother|sister|daughter|wife|aunt|priestess|matron|duchess|baroness|countess|widow|maid|witch|crone|f)\b/gi;
const MALE = /\b(he|him|his|himself|man|male|boy|lord|king|prince|father|brother|son|husband|uncle|priest|duke|baron|count|widower|wizard|m)\b/gi;

// What a description says about someone: a sheet's "she/her", a trait's
// "a tired old man", the "he growls" after a line. Says nothing when the
// words do not, or when they point both ways.
export function guessGender(text: string): VoiceGender {
  const female = text.match(FEMALE)?.length ?? 0;
  const male = text.match(MALE)?.length ?? 0;
  if (female === male) {
    return "";
  }
  return female > male ? "f" : "m";
}

const SHE = /\b(she|her|hers|herself)\b/gi;
const HE = /\b(he|him|his|himself)\b/gi;

// What the story so far says about each speaker: the pronouns in the
// sentences they are the subject of ("Brom plants his feet") and the ones
// after that carry on about them, never what a sentence about somebody
// else calls the person it mentions ("Sella turns to Liriel, her eyes
// hard" says nothing about Liriel), and never the words inside a quote.
// One stray pronoun is not enough to go on: a side has to outnumber the
// other two to one.
export function genderFromProse(speakers: Speaker[], texts: string[]): Map<string, VoiceGender> {
  const counts = new Map<string, { f: number; m: number }>();
  for (const text of texts) {
    for (const run of subjectRuns(text, speakers)) {
      const count = counts.get(run.speaker.id) ?? { f: 0, m: 0 };
      count.f += run.text.match(SHE)?.length ?? 0;
      count.m += run.text.match(HE)?.length ?? 0;
      counts.set(run.speaker.id, count);
    }
  }
  const guesses = new Map<string, VoiceGender>();
  for (const [id, { f, m }] of counts) {
    guesses.set(id, f >= 2 * m && f > 0 ? "f" : m >= 2 * f && m > 0 ? "m" : "");
  }
  return guesses;
}

const ENGLISH = new Set(["a", "b"]);

// The voices worth casting from: never the narrator's own, never the old
// takes and novelty voices a Kokoro server still lists, and on a Kokoro
// server only voices in the narrator's language (an English passage read by
// a Japanese voice is not a character, it is a fault). The shipped, named
// voices come first: they are the ones known to sound good.
export function castingPool(serverVoices: string[], narratorVoice: string): string[] {
  const narratorLanguage = KOKORO_ID.exec(narratorVoice)?.[1] ?? "a";
  const sameLanguage = (letter: string) =>
    ENGLISH.has(narratorLanguage) ? ENGLISH.has(letter) : letter === narratorLanguage;
  const pool = serverVoices.filter((id) => {
    if (id === narratorVoice || /_v0|santa/.test(id)) {
      return false;
    }
    const kokoro = KOKORO_ID.exec(id);
    return kokoro ? sameLanguage(kokoro[1]) : true;
  });
  const curated = TTS_VOICES.map((voice) => voice.id as string);
  const rank = (id: string) => (curated.includes(id) ? curated.indexOf(id) : curated.length);
  return [...pool].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  return value >>> 0;
}

// One voice for one speaker: of the right sort when that is known, the one
// fewest others at the table already have, a named voice before an unnamed
// one, and among equals the speaker's own name decides, so two tables do not
// cast everyone in the same order. "" when the server offers nothing.
export function pickVoice(name: string, gender: VoiceGender, pool: string[], taken: string[]): string {
  if (!pool.length) {
    return "";
  }
  const suited = gender ? pool.filter((id) => voiceGender(id) === gender) : [];
  const candidates = suited.length ? suited : pool;
  const uses = (id: string) => taken.filter((entry) => entry === id).length;
  const fewest = Math.min(...candidates.map(uses));
  const free = candidates.filter((id) => uses(id) === fewest);
  const curated = new Set<string>(TTS_VOICES.map((voice) => voice.id));
  const named = free.filter((id) => curated.has(id));
  const from = named.length ? named : free;
  return from[hash(name.trim().toLowerCase()) % from.length];
}
