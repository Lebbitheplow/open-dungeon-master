// Shaping for DM beats: what a beat may be, what a drafter is allowed to read,
// and how a model's answer is cleaned up before a person is shown it.
//
// Pure and dependency-free so scripts/test-beat-cadence.mjs can import it and
// the composer can share the labels with the server.

// What kind of story the beat records. Deliberately a small, concrete list:
// these are the things that happen at a table and get lost when nobody types
// them, and each one is a different shape of sentence.
export const BEAT_KINDS = [
  "scene",
  "npc",
  "discovery",
  "travel",
  "combat",
  "downtime",
] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];

export const BEAT_KIND_LABELS: Record<BeatKind, string> = {
  scene: "A scene played out",
  npc: "Someone they met",
  discovery: "Something they learned",
  travel: "Somewhere they went",
  combat: "How a fight went",
  downtime: "Downtime and shopping",
};

// How the text got here. Kept because "the DM wrote this" and "a model wrote
// this and the DM accepted it" are different provenance, and a later pass over
// the campaign's memory should be able to tell them apart.
export const BEAT_SOURCES = ["typed", "drafted", "voice"] as const;
export type BeatSource = (typeof BEAT_SOURCES)[number];

export const BEAT_MAX_CHARS = 2_000;

// The transcript slice a draft is allowed to read. Big enough for a long
// stretch of table talk, small enough that a local utility model answers in
// seconds.
export const BEAT_SOURCE_BUDGET = 8_000;

// Enough happened to be worth summarizing. Below this the honest answer is
// "nothing to write up yet" rather than a model call that invents filler.
export const BEAT_SOURCE_MIN_LINES = 2;

// A model asked for prose still hands back code fences, a "Summary:" label, or
// the whole thing in quotes. None of that belongs in the transcript, and the
// DM should not have to delete it before reading their own draft.
export function normalizeBeatBody(raw: string): string {
  let text = String(raw ?? "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
  }
  text = text.replace(/^(?:beat|summary|recap)\s*:\s*/i, "").trim();
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
  }
  // Blank-line runs come from models that "format" a two-sentence answer.
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.slice(0, BEAT_MAX_CHARS);
}

// Sorted by timestamp rather than campaign seq, because the lines come from
// three tables and only one of them (messages) carries a seq: rolls and audit
// entries are ordered by the clock the server stamped them with.
export type BeatSourceLine = { at: string; text: string };

// The record the drafter reads, in table order and trimmed from the FRONT
// when it is too long: the end of the stretch is the part the DM is about to
// summarize, so the oldest lines are the ones to lose.
export function beatSourceText(
  lines: BeatSourceLine[],
  budget = BEAT_SOURCE_BUDGET,
): string {
  const ordered = [...lines]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((line) => line.text.trim())
    .filter(Boolean);
  const joined = ordered.join("\n");
  return joined.length > budget ? joined.slice(-budget) : joined;
}

export function hasBeatSource(lines: BeatSourceLine[]): boolean {
  return lines.filter((line) => line.text.trim()).length >= BEAT_SOURCE_MIN_LINES;
}
