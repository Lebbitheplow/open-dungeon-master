import { stripReasoningArtifacts } from "../story-prompt.ts";

// Pure story-arc logic, kept free of alias imports so node test scripts
// (scripts/test-arc.mjs) can load it directly. The arc is the DM's secret
// spine: a main plot with ordered beats plus quest/dungeon-scale sub-arcs.
// Refreshes apply small clamped deltas, never full rewrites, so a confused
// model can stall the arc but can never thrash it.

export type ArcBeat = { text: string; status: "pending" | "active" | "done" };

export type SubArc = {
  // Server-allocated ("sa1", "sa2", ...); the refresh delta targets these.
  id: string;
  // name and goal are player-safe and feed the quest log.
  name: string;
  goal: string;
  // DM-only: how this thread ties back to the main arc.
  hook: string;
  // DM-only: 2-4 expected beats.
  beats: string[];
  status: "pending" | "active" | "resolved" | "abandoned";
  resolution?: string;
};

export type StoryArc = {
  version: 1;
  premise: string;
  stakes: string;
  antagonist: string;
  // 5-8 ordered main beats; the last escalates into the finale.
  beats: ArcBeat[];
  finale: string;
  subArcs: SubArc[];
  updatedAt: string;
};

export type ArcDelta = {
  // 1-based main-beat numbers now completed.
  beatsDone: number[];
  // 1-based "you are here" beat; null lets the server pick.
  activeBeat: number | null;
  subArcUpdates: Array<{ id: string; status: SubArc["status"]; resolution?: string }>;
  newSubArcs: Array<Pick<SubArc, "name" | "goal" | "hook" | "beats">>;
};

const MAX_BEATS = 8;
const MAX_SUB_ARCS = 16;
const MAX_NEW_SUB_ARCS = 2;
const FIELD_CAP = 300;
const QUEST_LINE_CAP = 140;
const SUB_ARC_STATUSES: SubArc["status"][] = ["pending", "active", "resolved", "abandoned"];

function str(value: unknown, cap = FIELD_CAP): string {
  return String(value ?? "").trim().slice(0, cap);
}

function strList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.map((entry) => str(entry)).filter(Boolean).slice(0, max)
    : [];
}

function nextSubArcId(existing: SubArc[]): string {
  let highest = 0;
  for (const subArc of existing) {
    const match = /^sa(\d+)$/.exec(subArc.id);
    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return `sa${highest + 1}`;
}

function normalizeSubArc(raw: unknown, fallbackId: string): SubArc | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const name = str(record.name, 80);
  const goal = str(record.goal, 200);
  if (!name || !goal) {
    return null;
  }
  const status = SUB_ARC_STATUSES.includes(record.status as SubArc["status"])
    ? (record.status as SubArc["status"])
    : "pending";
  const subArc: SubArc = {
    id: str(record.id, 12) || fallbackId,
    name,
    goal,
    hook: str(record.hook),
    beats: strList(record.beats, 4),
    status,
  };
  const resolution = str(record.resolution, 200);
  if (resolution) {
    subArc.resolution = resolution;
  }
  return subArc;
}

// Validates/coerces a parsed object into a StoryArc; null on garbage. Also
// guards reads of the stored JSON, so a corrupt row degrades to arc-less.
export function normalizeStoryArc(raw: unknown): StoryArc | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const premise = str(record.premise, 600);
  const rawBeats = Array.isArray(record.beats) ? record.beats.slice(0, MAX_BEATS) : [];
  const beats: ArcBeat[] = [];
  for (const entry of rawBeats) {
    // Accepts both plain strings (fresh model output) and {text, status}
    // objects (stored form).
    const text =
      typeof entry === "string" ? str(entry) : str((entry as Record<string, unknown>)?.text);
    if (!text) {
      continue;
    }
    const status = (entry as Record<string, unknown>)?.status;
    beats.push({
      text,
      status: status === "done" || status === "active" ? status : "pending",
    });
  }
  if (!premise || beats.length < 2) {
    return null;
  }
  if (!beats.some((beat) => beat.status === "active")) {
    const first = beats.find((beat) => beat.status === "pending");
    if (first) {
      first.status = "active";
    }
  }
  const subArcs: SubArc[] = [];
  for (const entry of Array.isArray(record.subArcs) ? record.subArcs : []) {
    const subArc = normalizeSubArc(entry, nextSubArcId(subArcs));
    if (subArc && !subArcs.some((existing) => existing.id === subArc.id)) {
      subArcs.push(subArc);
    }
    if (subArcs.length >= MAX_SUB_ARCS) {
      break;
    }
  }
  return {
    version: 1,
    premise,
    stakes: str(record.stakes, 400),
    antagonist: str(record.antagonist, 400),
    beats,
    finale: str(record.finale, 400),
    subArcs,
    updatedAt: str(record.updatedAt, 40) || new Date().toISOString(),
  };
}

function extractJsonObject(raw: string): unknown | null {
  const cleaned = stripReasoningArtifacts(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Parses a freshly generated arc. Fresh sub-arcs open as active (they are
// the campaign's opening threads), and the first main beat becomes [NOW].
export function parseArcJson(raw: string): StoryArc | null {
  const arc = normalizeStoryArc(extractJsonObject(raw));
  if (!arc) {
    return null;
  }
  for (const subArc of arc.subArcs) {
    if (subArc.status === "pending") {
      subArc.status = "active";
    }
  }
  arc.updatedAt = new Date().toISOString();
  return arc;
}

export function parseArcDeltaJson(raw: string): ArcDelta | null {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const beatsDone = Array.isArray(record.beatsDone)
    ? record.beatsDone.map(Number).filter((n) => Number.isInteger(n) && n >= 1)
    : [];
  const activeBeat = Number(record.activeBeat);
  const subArcUpdates: ArcDelta["subArcUpdates"] = [];
  for (const entry of Array.isArray(record.subArcUpdates) ? record.subArcUpdates : []) {
    const update = entry as Record<string, unknown> | null;
    const id = str(update?.id, 12);
    if (!id || !SUB_ARC_STATUSES.includes(update?.status as SubArc["status"])) {
      continue;
    }
    const item: ArcDelta["subArcUpdates"][number] = {
      id,
      status: update?.status as SubArc["status"],
    };
    const resolution = str(update?.resolution, 200);
    if (resolution) {
      item.resolution = resolution;
    }
    subArcUpdates.push(item);
  }
  const newSubArcs: ArcDelta["newSubArcs"] = [];
  for (const entry of Array.isArray(record.newSubArcs) ? record.newSubArcs : []) {
    const subArc = normalizeSubArc(entry, "new");
    if (subArc) {
      newSubArcs.push({ name: subArc.name, goal: subArc.goal, hook: subArc.hook, beats: subArc.beats });
    }
    if (newSubArcs.length >= MAX_NEW_SUB_ARCS) {
      break;
    }
  }
  return {
    beatsDone,
    activeBeat: Number.isInteger(activeBeat) && activeBeat >= 1 ? activeBeat : null,
    subArcUpdates,
    newSubArcs,
  };
}

// Clamped merge of a refresh delta. Beat completion is monotonic (a done
// beat never reopens), invalid indices and unknown sub-arc ids are ignored,
// and at most MAX_NEW_SUB_ARCS threads are added per refresh.
export function applyArcDelta(arc: StoryArc, delta: ArcDelta): StoryArc {
  const next: StoryArc = {
    ...arc,
    beats: arc.beats.map((beat) => ({ ...beat })),
    subArcs: arc.subArcs.map((subArc) => ({ ...subArc })),
  };

  for (const beatNumber of delta.beatsDone) {
    const beat = next.beats[beatNumber - 1];
    if (beat) {
      beat.status = "done";
    }
  }

  for (const beat of next.beats) {
    if (beat.status === "active") {
      beat.status = "pending";
    }
  }
  const requested = delta.activeBeat === null ? null : next.beats[delta.activeBeat - 1];
  const active =
    requested && requested.status !== "done"
      ? requested
      : next.beats.find((beat) => beat.status === "pending");
  if (active) {
    active.status = "active";
  }

  for (const update of delta.subArcUpdates) {
    const subArc = next.subArcs.find((entry) => entry.id === update.id);
    if (!subArc) {
      continue;
    }
    subArc.status = update.status;
    if (update.resolution) {
      subArc.resolution = update.resolution;
    }
  }

  for (const raw of delta.newSubArcs.slice(0, MAX_NEW_SUB_ARCS)) {
    next.subArcs.push({
      id: nextSubArcId(next.subArcs),
      name: raw.name,
      goal: raw.goal,
      hook: raw.hook,
      beats: raw.beats,
      status: "active",
    });
  }

  // Cap total sub-arcs by shedding the oldest settled threads first.
  while (next.subArcs.length > MAX_SUB_ARCS) {
    const settled = next.subArcs.findIndex(
      (subArc) => subArc.status === "resolved" || subArc.status === "abandoned",
    );
    next.subArcs.splice(settled >= 0 ? settled : 0, 1);
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

// Bounded GAME STATE render. The header carries the steering instruction:
// aim scenes at the [NOW] beat, improvise the path, never dump the plot.
export function renderArcForPrompt(arc: StoryArc): string {
  const lines = [
    "DM story arc (secret; steer scenes toward the [NOW] beat while improvising freely on the way there; never reveal, quote, or rush it):",
    `Premise: ${arc.premise}`,
  ];
  if (arc.stakes) {
    lines.push(`Stakes: ${arc.stakes}`);
  }
  if (arc.antagonist) {
    lines.push(`Antagonist: ${arc.antagonist}`);
  }
  lines.push("Main beats:");
  arc.beats.slice(0, MAX_BEATS).forEach((beat, index) => {
    const marker = beat.status === "done" ? "[done]" : beat.status === "active" ? "[NOW]" : "[ahead]";
    lines.push(`${index + 1}. ${marker} ${beat.text}`);
  });
  if (arc.finale) {
    lines.push(`Finale: ${arc.finale}`);
  }
  const open = arc.subArcs.filter(
    (subArc) => subArc.status === "active" || subArc.status === "pending",
  );
  if (open.length) {
    lines.push("Active quests (quest-scale arcs; weave them toward the main beats):");
    for (const subArc of open.slice(0, 4)) {
      const beats = subArc.beats.length ? ` | expected: ${subArc.beats.join(" -> ")}` : "";
      lines.push(`- [${subArc.id}] ${subArc.name} | goal: ${subArc.goal}${subArc.hook ? ` | hook: ${subArc.hook}` : ""}${beats}`);
    }
  }
  const settled = arc.subArcs.filter(
    (subArc) => subArc.status === "resolved" || subArc.status === "abandoned",
  );
  if (settled.length) {
    lines.push(
      `Settled: ${settled
        .slice(-3)
        .map((subArc) => `${subArc.name} (${subArc.resolution || subArc.status})`)
        .join("; ")}`,
    );
  }
  return lines.join("\n");
}

// Player-safe quest-log projection: names and goals only, never hooks or
// expected beats.
export function activeQuestLines(arc: StoryArc): string[] {
  return arc.subArcs
    .filter((subArc) => subArc.status === "active" || subArc.status === "pending")
    .slice(0, 8)
    .map((subArc) => `${subArc.name}: ${subArc.goal}`.slice(0, QUEST_LINE_CAP));
}
