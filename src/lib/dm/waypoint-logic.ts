// Pure waypoint mechanics (issue #31): which of a beat's steps a tool call
// satisfies, how a tick is recorded, and how the judge's reply is read.
// Database-free and model-free so scripts/test-waypoints.mjs can exercise
// every branch; waypoint-tick.ts wraps this with the campaign, the
// embeddings and the model.

import type { ArcBeat, StoryArc, Waypoint, WaypointKind } from "./arc-logic.ts";

export type WaypointSignal = { kind: WaypointKind; names: string[] };

export function openWaypoints(beat: ArcBeat | null | undefined): Waypoint[] {
  return (beat?.waypoints ?? []).filter((waypoint) => !waypoint.done);
}

// A beat with any open waypoint cannot complete; one with none, or with
// none written, gates nothing.
export function beatGated(beat: ArcBeat | null | undefined): boolean {
  return openWaypoints(beat).length > 0;
}

export function activeBeat(arc: StoryArc): { beat: ArcBeat; number: number } | null {
  const index = arc.beats.findIndex((beat) => beat.status === "active");
  return index < 0 ? null : { beat: arc.beats[index], number: index + 1 };
}

// What a tool call says the party just did, in waypoint terms. Names are
// what the DM passed in, so a place waypoint matches the location the DM
// moved the party to, not a guess from narration. Objective and fight
// signals need a lookup the caller does (the quest's text, the foes'
// names) and arrive through `extra`.
export function signalFromToolCall(
  name: string,
  rawArguments: string,
  extra: { objectiveText?: string; enemyNames?: string[] } = {},
): WaypointSignal | null {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }
  const text = (key: string) => (typeof args[key] === "string" ? (args[key] as string).trim() : "");
  switch (name) {
    case "move_party":
    case "update_location":
      return text("name") ? { kind: "place", names: [text("name")] } : null;
    case "set_npc":
    case "npc_reaction":
      return text("name") ? { kind: "npc", names: [text("name")] } : null;
    case "social_check":
      return text("npc") ? { kind: "npc", names: [text("npc")] } : null;
    case "grant_item":
      return text("name") ? { kind: "item", names: [text("name")] } : null;
    case "buy_item":
      return text("item") ? { kind: "item", names: [text("item")] } : null;
    case "tick_objective":
      return extra.objectiveText ? { kind: "objective", names: [extra.objectiveText] } : null;
    case "end_encounter":
      return extra.enemyNames?.length ? { kind: "fight", names: extra.enemyNames } : null;
    default:
      return null;
  }
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "at", "in", "on", "with", "and", "or", "for", "from", "into",
  "reach", "reaches", "reaching", "arrive", "arrives", "arriving", "find", "finds", "finding",
  "go", "goes", "get", "gets", "meet", "meets", "meeting", "speak", "speaks", "talk", "talks",
  "obtain", "obtains", "recover", "recovers", "take", "takes", "defeat", "defeats", "kill",
  "kills", "beat", "beats", "win", "wins", "party", "their", "its", "his", "her", "them", "it",
  "is", "are", "be", "by", "up", "out", "down",
]);

// Lower-case, unaccented, punctuation-free word stems (five letters, so
// "cathedral" and "cathedrals" agree) minus the words every waypoint
// shares. The stems are what the two sides are compared on.
export function stems(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map((word) => word.slice(0, 5));
}

// Whether a name the DM used (a location, a person, an item) is the thing
// a waypoint names. Every distinctive stem of the name has to appear in the
// waypoint, or the two have to share most of their stems: "the drowned
// cathedral" matches "Reach the Drowned Cathedral of Vael", and "Brisca"
// matches "speak with Brisca Hale", while "the ferry" does not match
// "reach the drowned cathedral".
export function lexicalMatch(waypointText: string, name: string): boolean {
  const target = new Set(stems(waypointText));
  const given = stems(name);
  if (!target.size || !given.length) {
    return false;
  }
  const hits = given.filter((stem) => target.has(stem)).length;
  if (hits === given.length) {
    return true;
  }
  const union = new Set([...target, ...given]).size;
  return hits / union >= 0.5;
}

// Open waypoints of the beat that a signal satisfies by name. Narrative
// waypoints never match here: only the judge can settle those.
export function matchSignal(beat: ArcBeat, signal: WaypointSignal): number[] {
  const matched: number[] = [];
  (beat.waypoints ?? []).forEach((waypoint, index) => {
    if (waypoint.done || waypoint.kind !== signal.kind || waypoint.kind === "narrative") {
      return;
    }
    if (signal.names.some((name) => lexicalMatch(waypoint.text, name))) {
      matched.push(index);
    }
  });
  return matched;
}

// Records ticks on one beat. Out-of-range or already-done indexes are
// ignored, so a stale tick can never throw a turn.
export function tickWaypoints(arc: StoryArc, beatNumber: number, indexes: number[]): StoryArc {
  const beat = arc.beats[beatNumber - 1];
  if (!beat?.waypoints || !indexes.length) {
    return arc;
  }
  const waypoints = beat.waypoints.map((waypoint, index) =>
    indexes.includes(index) && !waypoint.done ? { ...waypoint, done: true } : waypoint,
  );
  if (waypoints.every((waypoint, index) => waypoint === beat.waypoints![index])) {
    return arc;
  }
  return {
    ...arc,
    beats: arc.beats.map((entry, index) => (index === beatNumber - 1 ? { ...entry, waypoints } : entry)),
    updatedAt: new Date().toISOString(),
  };
}

export function setWaypointDone(arc: StoryArc, beatNumber: number, index: number, done: boolean): StoryArc {
  const beat = arc.beats[beatNumber - 1];
  if (!beat?.waypoints?.[index] || beat.waypoints[index].done === done) {
    return arc;
  }
  const waypoints = beat.waypoints.map((waypoint, at) => (at === index ? { ...waypoint, done } : waypoint));
  return {
    ...arc,
    beats: arc.beats.map((entry, at) => (at === beatNumber - 1 ? { ...entry, waypoints } : entry)),
    updatedAt: new Date().toISOString(),
  };
}

// The judge answers with the 1-based numbers of the listed waypoints that
// happened, as JSON or as bare numbers. Anything else is "none".
export function parseWaypointJudge(raw: string, count: number): number[] {
  const cleaned = raw.replace(/```[a-z]*/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  let numbers: number[] = [];
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      numbers = Array.isArray(parsed) ? parsed.map((entry) => Number(entry)) : [];
    } catch {
      numbers = [];
    }
  } else if (/^\W*(none|no)\b/i.test(cleaned)) {
    return [];
  } else {
    numbers = (cleaned.match(/\d+/g) ?? []).map(Number);
  }
  return [...new Set(numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= count))].map((n) => n - 1);
}

// The checklist as the lead and the log read it.
export function describeWaypoints(beat: ArcBeat): string {
  return (beat.waypoints ?? [])
    .map((waypoint) => `${waypoint.done ? "[x]" : "[ ]"} ${waypoint.text}`)
    .join("; ");
}
