import { stripReasoningArtifacts } from "../story-prompt.ts";

// Pure story-arc logic, kept free of alias imports so node test scripts
// (scripts/test-arc.mjs) can load it directly. The arc is the DM's secret
// spine, in three tiers: a campaign-spanning saga (act sketches with planned
// bosses and allies, detailed lazily as the party reaches each act), the
// current act's main beats, and quest-scale sub-arcs. Refreshes apply small
// clamped deltas, never full rewrites, so a confused model can stall the arc
// but can never thrash it.
//
// Beat TEXT is immutable once settled. Play reaches the spine through
// annotations (a beat's `detail`), skipped beats, fired/dropped events, and
// new cast. The one exception is a clamped rewrite of a not-yet-played beat
// in the current act, for when the table killed or permanently altered the
// thing the beat depends on; future acts adapt through their sketches
// instead, because their beats do not exist yet.

export type BeatStatus = "pending" | "active" | "done" | "skipped";

export type ArcBeat = {
  text: string;
  status: BeatStatus;
  // 1-based act this beat belongs to; v1 arcs migrate to act 1.
  act: number;
  // Accreted from play: what the table actually did around this beat.
  detail?: string;
};

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

export type ArcEventKind =
  | "npc_encounter"
  | "ally"
  | "twist"
  | "betrayal"
  | "deadline"
  | "discovery"
  | "setpiece";

// A planned special moment. Triggers are SOFT: the DM fires one when the
// fiction naturally reaches it, and holds, adapts, or drops it otherwise.
export type ArcEvent = {
  // Server-allocated ("ev1", "ev2", ...).
  id: string;
  kind: ArcEventKind;
  name: string;
  // DM-only: what actually happens.
  detail: string;
  // DM-only: the condition that invites it, in fiction terms.
  trigger: string;
  // Soft placement only; never enforced.
  actHint: number | null;
  // Optional link into the cast.
  castId?: string;
  status: "pending" | "fired" | "dropped";
};

// A recurring NPC the arc plans around. Distinct from the npcs table, which
// holds server-authoritative attitude once they actually appear in play.
export type ArcNpc = {
  // Server-allocated ("np1", "np2", ...).
  id: string;
  name: string;
  role: string;
  // DM-only: what they want.
  agenda: string;
  // Accreted from play.
  notes?: string;
  status: "active" | "gone";
};

// The lead's campaign-length setting scales how far the saga plans ahead.
// Kept string-compatible with the schema enum in game-settings.ts without
// importing it, so this module stays alias-free for the test scripts.
export type CampaignLength = "short" | "standard" | "epic";

export type LengthProfile = {
  minActs: number;
  maxActs: number;
  // Prompt-ready phrasings, so every generation prompt scales consistently.
  actsText: string;
  subArcsText: string;
};

export function lengthProfile(length: CampaignLength): LengthProfile {
  switch (length) {
    case "short":
      return { minActs: 3, maxActs: 3, actsText: "exactly 3", subArcsText: "2 to 3" };
    case "epic":
      return { minActs: 6, maxActs: 8, actsText: "6 to 8", subArcsText: "4 to 5" };
    default:
      return { minActs: 4, maxActs: 5, actsText: "4 or 5", subArcsText: "3 to 4" };
  }
}

// One act of the saga plan. Only the current and past acts have real beats;
// a future act lives as this sketch until the party reaches it, when the
// act-detail pass turns it into beats using what actually happened. That is
// the saga's improv margin: distant plans stay one revisable line.
export type ActSketch = {
  // Aligns with ArcBeat.act once the act is detailed.
  act: number;
  // One line: what this act accomplishes.
  milestone: string;
  // The major set-piece fight the act builds toward.
  boss: { name: string; detail: string } | null;
  // 0-2 planned companion/ally encounters for the act.
  allies: string[];
  // 0-2 ways the act touches a party member's abilities, pets, or backstory.
  hooks: string[];
  status: "sketch" | "detailed" | "done";
};

// The campaign-spanning tier above the acts. When a saga concludes, a sequel
// saga replaces it and the old one joins priorSagas, so a table can keep
// playing indefinitely.
export type Saga = {
  title: string;
  plannedActs: number;
  // One per act, including detailed/done acts (their milestone keeps the
  // finished-act render to one line).
  sketches: ActSketch[];
  finaleBoss: { name: string; detail: string } | null;
  // 1 = the campaign's first saga, 2+ = sequels.
  sagaIndex: number;
  priorSagas: Array<{ title: string; resolution: string }>;
};

export type StoryArc = {
  version: 3;
  premise: string;
  stakes: string;
  antagonist: string;
  // Ordered main beats across `acts` acts; the last act escalates into the
  // finale. Grown an act at a time as the party reaches each saga sketch.
  beats: ArcBeat[];
  // Highest act number written so far.
  acts: number;
  finale: string;
  // null = a pre-v3 arc awaiting the one-time saga upgrade pass.
  saga: Saga | null;
  cast: ArcNpc[];
  events: ArcEvent[];
  subArcs: SubArc[];
  updatedAt: string;
};

export type ArcDelta = {
  // 1-based main-beat numbers now completed.
  beatsDone: number[];
  // 1-based main-beat numbers play made moot; they advance like done beats
  // so a drifted campaign never stalls on a [NOW] nobody will reach.
  beatsSkipped: number[];
  // Table-specific colour appended to a beat. Never changes its text.
  beatAnnotations: Array<{ beat: number; detail: string }>;
  // 1-based "you are here" beat; null lets the server pick.
  activeBeat: number | null;
  subArcUpdates: Array<{ id: string; status: SubArc["status"]; resolution?: string }>;
  newSubArcs: Array<Pick<SubArc, "name" | "goal" | "hook" | "beats">>;
  eventsFired: string[];
  eventsDropped: string[];
  newEvents: Array<Omit<ArcEvent, "id" | "status">>;
  castUpdates: Array<{ id: string; notes?: string; status?: ArcNpc["status"] }>;
  newCast: Array<Omit<ArcNpc, "id" | "status">>;
  // In-place text replacement of a pending/active beat in the CURRENT act,
  // for when play invalidated what the beat depends on. Indices never shift.
  beatRewrites: Array<{ beat: number; text: string }>;
  // Revisions to future (still-sketch) acts; boss null clears a planned boss
  // the players already dealt with.
  sketchUpdates: Array<{
    act: number;
    milestone?: string;
    boss?: { name: string; detail: string } | null;
    allies?: string[];
  }>;
};

// A whole new act, appended when the party plays past the current finale.
export type ArcExtension = {
  beats: string[];
  finale: string;
  antagonist?: string;
  newEvents: Array<Omit<ArcEvent, "id" | "status">>;
};

// The one-time v1 -> v2 upgrade payload: layers only, never beat text.
export type ArcEnrichment = {
  cast: Array<Omit<ArcNpc, "id" | "status">>;
  events: Array<Omit<ArcEvent, "id" | "status">>;
  // 1-based beat number -> act number.
  beatActs: Array<{ beat: number; act: number }>;
};

// The act-detail pass: the next sketch becomes a real act of beats, grown
// out of what the table actually did on the way here.
export type ActDetail = {
  beats: string[];
  // Optionally revised sketch milestone, when play changed the act's shape.
  milestone?: string;
  finale: string;
  // The act's planned boss as a set-piece event the DM steers toward.
  bossEvent: Omit<ArcEvent, "id" | "status"> | null;
  newEvents: Array<Omit<ArcEvent, "id" | "status">>;
  newCast: Array<Omit<ArcNpc, "id" | "status">>;
};

// The one-time v2 -> v3 upgrade payload: the saga wrapper plus sketches for
// the acts still ahead. Existing acts are synthesized from their own beats.
export type SagaUpgrade = {
  title: string;
  plannedActs: number;
  sketches: Array<Pick<ActSketch, "act" | "milestone" | "boss" | "allies" | "hooks">>;
  finaleBoss: { name: string; detail: string } | null;
};

const MAX_BEATS = 40;
const MAX_ACT_BEATS = 8;
const MAX_ACTS = 8;
const MAX_PRIOR_SAGAS = 3;
const MAX_BEAT_REWRITES = 2;
const MAX_SKETCH_UPDATES = 2;
const MAX_SKETCH_EXTRAS = 2;
const MAX_SUB_ARCS = 16;
const MAX_NEW_SUB_ARCS = 2;
const MAX_EVENTS = 24;
const MAX_NEW_EVENTS = 2;
const MAX_CAST = 12;
const MAX_NEW_CAST = 2;
const MAX_ANNOTATIONS = 3;
const FIELD_CAP = 300;
const BEAT_CAP = 220;
const DETAIL_CAP = 200;
const QUEST_LINE_CAP = 140;
const SUB_ARC_STATUSES: SubArc["status"][] = ["pending", "active", "resolved", "abandoned"];
const EVENT_KINDS: ArcEventKind[] = [
  "npc_encounter",
  "ally",
  "twist",
  "betrayal",
  "deadline",
  "discovery",
  "setpiece",
];

// Render budgets: the arc shares GAME STATE with sheets, the encounter, and
// the map, so every list is bounded.
const RENDER_OPEN_SUB_ARCS = 4;
const RENDER_PENDING_EVENTS = 4;
const RENDER_CAST = 6;
const RENDER_FUTURE_SKETCHES = 3;

function str(value: unknown, cap = FIELD_CAP): string {
  return String(value ?? "").trim().slice(0, cap);
}

function strList(value: unknown, max: number, cap = FIELD_CAP): string[] {
  return Array.isArray(value)
    ? value.map((entry) => str(entry, cap)).filter(Boolean).slice(0, max)
    : [];
}

function posInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function nextId(prefix: string, existing: Array<{ id: string }>): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let highest = 0;
  for (const entry of existing) {
    const match = pattern.exec(entry.id);
    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return `${prefix}${highest + 1}`;
}

function normalizeSubArc(raw: unknown, fallbackId: string): SubArc | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const name = str(record.name, 80);
  const goal = str(record.goal, 300);
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
    hook: str(record.hook, 300),
    beats: strList(record.beats, 4, BEAT_CAP),
    status,
  };
  const resolution = str(record.resolution, 200);
  if (resolution) {
    subArc.resolution = resolution;
  }
  return subArc;
}

function normalizeEvent(raw: unknown, fallbackId: string): ArcEvent | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const name = str(record.name, 80);
  const detail = str(record.detail, 300);
  if (!name || !detail) {
    return null;
  }
  const kind = EVENT_KINDS.includes(record.kind as ArcEventKind)
    ? (record.kind as ArcEventKind)
    : "setpiece";
  const status =
    record.status === "fired" || record.status === "dropped"
      ? (record.status as ArcEvent["status"])
      : "pending";
  const event: ArcEvent = {
    id: str(record.id, 12) || fallbackId,
    kind,
    name,
    detail,
    trigger: str(record.trigger, 200),
    actHint: posInt(record.actHint),
    status,
  };
  const castId = str(record.castId, 12);
  if (castId) {
    event.castId = castId;
  }
  return event;
}

function normalizeNpc(raw: unknown, fallbackId: string): ArcNpc | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const name = str(record.name, 80);
  if (!name) {
    return null;
  }
  const npc: ArcNpc = {
    id: str(record.id, 12) || fallbackId,
    name,
    role: str(record.role, 200),
    agenda: str(record.agenda, 300),
    status: record.status === "gone" ? "gone" : "active",
  };
  const notes = str(record.notes, DETAIL_CAP);
  if (notes) {
    npc.notes = notes;
  }
  return npc;
}

function normalizeBoss(raw: unknown): { name: string; detail: string } | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const name = str(record.name, 80);
  if (!name) {
    return null;
  }
  return { name, detail: str(record.detail, FIELD_CAP) };
}

const SKETCH_STATUSES: ActSketch["status"][] = ["sketch", "detailed", "done"];

function normalizeSketch(raw: unknown): ActSketch | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const milestone = str(record.milestone, BEAT_CAP);
  const act = posInt(record.act);
  if (!milestone || act === null || act > MAX_ACTS) {
    return null;
  }
  return {
    act,
    milestone,
    boss: normalizeBoss(record.boss),
    allies: strList(record.allies, MAX_SKETCH_EXTRAS, DETAIL_CAP),
    hooks: strList(record.hooks, MAX_SKETCH_EXTRAS, DETAIL_CAP),
    status: SKETCH_STATUSES.includes(record.status as ActSketch["status"])
      ? (record.status as ActSketch["status"])
      : "sketch",
  };
}

// A corrupt saga degrades to null (v2-style behavior; the upgrade pass will
// rebuild it) rather than taking the whole arc down with it.
function normalizeSaga(raw: unknown): Saga | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const title = str(record.title, 80);
  const sketches: ActSketch[] = [];
  for (const entry of Array.isArray(record.sketches) ? record.sketches : []) {
    const sketch = normalizeSketch(entry);
    if (sketch && !sketches.some((existing) => existing.act === sketch.act)) {
      sketches.push(sketch);
    }
    if (sketches.length >= MAX_ACTS) {
      break;
    }
  }
  sketches.sort((a, b) => a.act - b.act);
  if (!title || !sketches.length) {
    return null;
  }
  const priorSagas: Saga["priorSagas"] = [];
  for (const entry of Array.isArray(record.priorSagas) ? record.priorSagas : []) {
    const prior = entry as Record<string, unknown> | null;
    const priorTitle = str(prior?.title, 80);
    if (priorTitle) {
      priorSagas.push({ title: priorTitle, resolution: str(prior?.resolution, FIELD_CAP) });
    }
    if (priorSagas.length >= MAX_PRIOR_SAGAS) {
      break;
    }
  }
  const highestAct = sketches[sketches.length - 1].act;
  return {
    title,
    plannedActs: Math.min(Math.max(posInt(record.plannedActs) ?? highestAct, highestAct), MAX_ACTS),
    sketches,
    finaleBoss: normalizeBoss(record.finaleBoss),
    sagaIndex: posInt(record.sagaIndex) ?? 1,
    priorSagas,
  };
}

// Validates/coerces a parsed object into a StoryArc; null on garbage. Also
// guards reads of the stored JSON, so a corrupt row degrades to arc-less,
// and upgrades v1/v2 rows in place (beats gain act 1, layers default empty,
// the saga stays null until its one-time upgrade pass).
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
    const isObject = typeof entry === "object" && entry !== null;
    const fields = isObject ? (entry as Record<string, unknown>) : null;
    const text = typeof entry === "string" ? str(entry, BEAT_CAP) : str(fields?.text, BEAT_CAP);
    if (!text) {
      continue;
    }
    const status = fields?.status;
    const beat: ArcBeat = {
      text,
      status:
        status === "done" || status === "active" || status === "skipped"
          ? (status as BeatStatus)
          : "pending",
      act: Math.min(posInt(fields?.act) ?? 1, MAX_ACTS),
    };
    const detail = str(fields?.detail, DETAIL_CAP);
    if (detail) {
      beat.detail = detail;
    }
    beats.push(beat);
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

  const cast: ArcNpc[] = [];
  for (const entry of Array.isArray(record.cast) ? record.cast : []) {
    const npc = normalizeNpc(entry, nextId("np", cast));
    if (npc && !cast.some((existing) => existing.id === npc.id)) {
      cast.push(npc);
    }
    if (cast.length >= MAX_CAST) {
      break;
    }
  }

  const events: ArcEvent[] = [];
  for (const entry of Array.isArray(record.events) ? record.events : []) {
    const event = normalizeEvent(entry, nextId("ev", events));
    if (event && !events.some((existing) => existing.id === event.id)) {
      events.push(event);
    }
    if (events.length >= MAX_EVENTS) {
      break;
    }
  }

  const subArcs: SubArc[] = [];
  for (const entry of Array.isArray(record.subArcs) ? record.subArcs : []) {
    const subArc = normalizeSubArc(entry, nextId("sa", subArcs));
    if (subArc && !subArcs.some((existing) => existing.id === subArc.id)) {
      subArcs.push(subArc);
    }
    if (subArcs.length >= MAX_SUB_ARCS) {
      break;
    }
  }

  const acts = beats.reduce((highest, beat) => Math.max(highest, beat.act), 1);
  const saga = normalizeSaga(record.saga);
  if (saga && saga.plannedActs < acts) {
    saga.plannedActs = acts;
  }
  return {
    version: 3,
    premise,
    stakes: str(record.stakes, 400),
    antagonist: str(record.antagonist, 400),
    beats,
    acts,
    finale: str(record.finale, 400),
    saga,
    cast,
    events,
    subArcs,
    updatedAt: str(record.updatedAt, 40) || new Date().toISOString(),
  };
}

// True for an arc that predates the v2 layers, so refreshStoryArc knows to
// run the one-time enrichment pass. Version alone is not enough: a stored v1
// row normalizes to version 2 on read.
export function needsEnrichment(arc: StoryArc): boolean {
  return !arc.cast.length && !arc.events.length;
}

// True for an arc that predates the saga tier (v2 or earlier), so
// refreshStoryArc knows to run the one-time upgrade pass that wraps the
// existing acts into a saga and sketches the acts still ahead.
export function needsSagaUpgrade(arc: StoryArc): boolean {
  return !arc.saga;
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

// Generation returns acts as a nested array; flatten it into the indexed
// beat list the delta machinery addresses. Falls back to a flat `beats`
// array (a model that ignored the act shape) tagged as a single act.
function beatsFromActs(record: Record<string, unknown>): unknown[] {
  const acts = Array.isArray(record.acts) ? record.acts : null;
  if (!acts) {
    return Array.isArray(record.beats) ? record.beats : [];
  }
  const flattened: unknown[] = [];
  acts.slice(0, MAX_ACTS).forEach((entry, index) => {
    const actNumber = index + 1;
    const actBeats = Array.isArray(entry)
      ? entry
      : Array.isArray((entry as Record<string, unknown>)?.beats)
        ? ((entry as Record<string, unknown>).beats as unknown[])
        : [];
    for (const beat of actBeats.slice(0, MAX_ACT_BEATS)) {
      flattened.push(
        typeof beat === "string"
          ? { text: beat, act: actNumber }
          : { ...(beat as Record<string, unknown>), act: actNumber },
      );
    }
  });
  return flattened;
}

// Parses a freshly generated arc. Fresh sub-arcs open as active (they are
// the campaign's opening threads), and the first main beat becomes [NOW].
export function parseArcJson(raw: string): StoryArc | null {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const arc = normalizeStoryArc({ ...record, beats: beatsFromActs(record) });
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

// Parses a freshly generated saga (initial generation and sequel chaining).
// The saga layer degrades independently of the core arc: when actPlan is
// garbage but the premise and act-1 beats parse, the arc is returned with
// saga null and the upgrade pass rebuilds the sketch tier at a later chapter
// close. Never reject a parse for saga-layer problems alone.
export function parseSagaJson(raw: string, profile: LengthProfile): StoryArc | null {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const act1Beats = strList(record.act1Beats, MAX_ACT_BEATS, BEAT_CAP);
  // A model that ignored the saga shape and answered with the old nested
  // acts (or flat beats) still yields a working arc.
  const beats: unknown[] =
    act1Beats.length >= 2
      ? act1Beats.map((text) => ({ text, act: 1 }))
      : beatsFromActs(record);
  const plan = Array.isArray(record.actPlan)
    ? record.actPlan.slice(0, Math.min(profile.maxActs, MAX_ACTS))
    : [];
  const sketches = plan.map((entry, index) => ({
    ...(typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {}),
    act: index + 1,
    status: index === 0 ? "detailed" : "sketch",
  }));
  const saga =
    sketches.length >= 2
      ? {
          title: record.title,
          plannedActs: sketches.length,
          sketches,
          finaleBoss: record.finaleBoss,
          sagaIndex: 1,
          priorSagas: [],
        }
      : null;
  const arc = normalizeStoryArc({ ...record, beats, saga });
  if (!arc) {
    return null;
  }
  if (arc.saga) {
    // The nested-acts fallback can write more than one act of beats; keep
    // the sketch statuses consistent with what actually got detailed.
    for (const sketch of arc.saga.sketches) {
      if (sketch.act <= arc.acts && sketch.status === "sketch") {
        sketch.status = "detailed";
      }
    }
  }
  for (const subArc of arc.subArcs) {
    if (subArc.status === "pending") {
      subArc.status = "active";
    }
  }
  arc.updatedAt = new Date().toISOString();
  return arc;
}

// The sequel-chain reply also carries a one-line resolution of the saga it
// concludes, extracted separately so a missing line never fails the parse.
export function extractPreviousResolution(raw: string): string {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  return record && typeof record === "object" ? str(record.previousResolution, FIELD_CAP) : "";
}

export function parseArcDeltaJson(raw: string): ArcDelta | null {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const beatNumbers = (value: unknown): number[] =>
    Array.isArray(value)
      ? value.map(posInt).filter((entry): entry is number => entry !== null)
      : [];

  const beatAnnotations: ArcDelta["beatAnnotations"] = [];
  for (const entry of Array.isArray(record.beatAnnotations) ? record.beatAnnotations : []) {
    const annotation = entry as Record<string, unknown> | null;
    const beat = posInt(annotation?.beat);
    const detail = str(annotation?.detail, DETAIL_CAP);
    if (beat !== null && detail) {
      beatAnnotations.push({ beat, detail });
    }
    if (beatAnnotations.length >= MAX_ANNOTATIONS) {
      break;
    }
  }

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

  const castUpdates: ArcDelta["castUpdates"] = [];
  for (const entry of Array.isArray(record.castUpdates) ? record.castUpdates : []) {
    const update = entry as Record<string, unknown> | null;
    const id = str(update?.id, 12);
    if (!id) {
      continue;
    }
    const item: ArcDelta["castUpdates"][number] = { id };
    const notes = str(update?.notes, DETAIL_CAP);
    if (notes) {
      item.notes = notes;
    }
    if (update?.status === "gone" || update?.status === "active") {
      item.status = update.status;
    }
    castUpdates.push(item);
  }

  const beatRewrites: ArcDelta["beatRewrites"] = [];
  for (const entry of Array.isArray(record.beatRewrites) ? record.beatRewrites : []) {
    const rewrite = entry as Record<string, unknown> | null;
    const beat = posInt(rewrite?.beat);
    const text = str(rewrite?.text, BEAT_CAP);
    if (beat !== null && text) {
      beatRewrites.push({ beat, text });
    }
    if (beatRewrites.length >= MAX_BEAT_REWRITES) {
      break;
    }
  }

  const sketchUpdates: ArcDelta["sketchUpdates"] = [];
  for (const entry of Array.isArray(record.sketchUpdates) ? record.sketchUpdates : []) {
    const update = entry as Record<string, unknown> | null;
    const act = posInt(update?.act);
    if (act === null) {
      continue;
    }
    const item: ArcDelta["sketchUpdates"][number] = { act };
    const milestone = str(update?.milestone, BEAT_CAP);
    if (milestone) {
      item.milestone = milestone;
    }
    // boss null is meaningful (the planned boss is gone), so distinguish an
    // explicit null from a missing or garbage field.
    if (update && "boss" in update) {
      if (update.boss === null) {
        item.boss = null;
      } else {
        const boss = normalizeBoss(update.boss);
        if (boss) {
          item.boss = boss;
        }
      }
    }
    if (Array.isArray(update?.allies)) {
      item.allies = strList(update.allies, MAX_SKETCH_EXTRAS, DETAIL_CAP);
    }
    if (item.milestone || item.boss !== undefined || item.allies) {
      sketchUpdates.push(item);
    }
    if (sketchUpdates.length >= MAX_SKETCH_UPDATES) {
      break;
    }
  }

  return {
    beatsDone: beatNumbers(record.beatsDone),
    beatsSkipped: beatNumbers(record.beatsSkipped),
    beatAnnotations,
    activeBeat: posInt(record.activeBeat),
    subArcUpdates,
    newSubArcs,
    eventsFired: strList(record.eventsFired, MAX_EVENTS, 12),
    eventsDropped: strList(record.eventsDropped, MAX_EVENTS, 12),
    newEvents: parsePlannedEvents(record.newEvents, MAX_NEW_EVENTS),
    castUpdates,
    newCast: parsePlannedCast(record.newCast, MAX_NEW_CAST),
    beatRewrites,
    sketchUpdates,
  };
}

// Planned (not yet allocated) forms: the id and status are the server's to
// assign, so they are dropped from anything a model proposes.
function eventPlan(event: ArcEvent): Omit<ArcEvent, "id" | "status"> {
  const plan: Omit<ArcEvent, "id" | "status"> = {
    kind: event.kind,
    name: event.name,
    detail: event.detail,
    trigger: event.trigger,
    actHint: event.actHint,
  };
  if (event.castId) {
    plan.castId = event.castId;
  }
  return plan;
}

function npcPlan(npc: ArcNpc): Omit<ArcNpc, "id" | "status"> {
  const plan: Omit<ArcNpc, "id" | "status"> = {
    name: npc.name,
    role: npc.role,
    agenda: npc.agenda,
  };
  if (npc.notes) {
    plan.notes = npc.notes;
  }
  return plan;
}

function parsePlannedEvents(value: unknown, max: number): Array<Omit<ArcEvent, "id" | "status">> {
  const events: Array<Omit<ArcEvent, "id" | "status">> = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const event = normalizeEvent(entry, "new");
    if (event) {
      events.push(eventPlan(event));
    }
    if (events.length >= max) {
      break;
    }
  }
  return events;
}

function parsePlannedCast(value: unknown, max: number): Array<Omit<ArcNpc, "id" | "status">> {
  const cast: Array<Omit<ArcNpc, "id" | "status">> = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const npc = normalizeNpc(entry, "new");
    if (npc) {
      cast.push(npcPlan(npc));
    }
    if (cast.length >= max) {
      break;
    }
  }
  return cast;
}

export function parseArcExtensionJson(raw: string): ArcExtension | null {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const beats = strList(record.beats, MAX_ACT_BEATS, BEAT_CAP);
  if (beats.length < 2) {
    return null;
  }
  const extension: ArcExtension = {
    beats,
    finale: str(record.finale, 400),
    newEvents: parsePlannedEvents(record.newEvents, MAX_NEW_EVENTS),
  };
  const antagonist = str(record.antagonist, 400);
  if (antagonist) {
    extension.antagonist = antagonist;
  }
  return extension;
}

export function parseArcEnrichmentJson(raw: string): ArcEnrichment | null {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const cast = parsePlannedCast(record.cast, MAX_CAST);
  const events = parsePlannedEvents(record.events, MAX_EVENTS);
  const beatActs: ArcEnrichment["beatActs"] = [];
  for (const entry of Array.isArray(record.beatActs) ? record.beatActs : []) {
    const mapping = entry as Record<string, unknown> | null;
    const beat = posInt(mapping?.beat);
    const act = posInt(mapping?.act);
    if (beat !== null && act !== null) {
      beatActs.push({ beat, act: Math.min(act, MAX_ACTS) });
    }
    if (beatActs.length >= MAX_BEATS) {
      break;
    }
  }
  if (!cast.length && !events.length && !beatActs.length) {
    return null;
  }
  return { cast, events, beatActs };
}

export function parseActDetailJson(raw: string): ActDetail | null {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const beats = strList(record.beats, MAX_ACT_BEATS, BEAT_CAP);
  if (beats.length < 2) {
    return null;
  }
  const bossEvents =
    record.bossEvent === null || record.bossEvent === undefined
      ? []
      : parsePlannedEvents([record.bossEvent], 1);
  const detail: ActDetail = {
    beats,
    finale: str(record.finale, 400),
    bossEvent: bossEvents[0] ?? null,
    newEvents: parsePlannedEvents(record.newEvents, MAX_NEW_EVENTS),
    newCast: parsePlannedCast(record.newCast, MAX_NEW_CAST),
  };
  const milestone = str(record.milestone, BEAT_CAP);
  if (milestone) {
    detail.milestone = milestone;
  }
  return detail;
}

export function parseSagaUpgradeJson(raw: string): SagaUpgrade | null {
  const record = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const title = str(record.title, 80);
  const sketches: SagaUpgrade["sketches"] = [];
  for (const entry of Array.isArray(record.sketches) ? record.sketches : []) {
    // A sketch without an act number still counts; applyArcUpgrade renumbers
    // the future acts contiguously anyway.
    const sketch = normalizeSketch({
      act: sketches.length + 1,
      ...(typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {}),
    });
    if (sketch) {
      sketches.push({
        act: sketch.act,
        milestone: sketch.milestone,
        boss: sketch.boss,
        allies: sketch.allies,
        hooks: sketch.hooks,
      });
    }
    if (sketches.length >= MAX_ACTS) {
      break;
    }
  }
  if (!title || !sketches.length) {
    return null;
  }
  return {
    title,
    plannedActs: posInt(record.plannedActs) ?? 0,
    sketches,
    finaleBoss: normalizeBoss(record.finaleBoss),
  };
}

function reseatActiveBeat(beats: ArcBeat[], requestedIndex: number | null) {
  for (const beat of beats) {
    if (beat.status === "active") {
      beat.status = "pending";
    }
  }
  const settled = (beat: ArcBeat) => beat.status === "done" || beat.status === "skipped";
  const requested = requestedIndex === null ? null : beats[requestedIndex - 1];
  const active =
    requested && !settled(requested) ? requested : beats.find((beat) => beat.status === "pending");
  if (active) {
    active.status = "active";
  }
}

function cloneSaga(saga: Saga | null): Saga | null {
  if (!saga) {
    return null;
  }
  return {
    ...saga,
    sketches: saga.sketches.map((sketch) => ({
      ...sketch,
      boss: sketch.boss ? { ...sketch.boss } : null,
      allies: [...sketch.allies],
      hooks: [...sketch.hooks],
    })),
    finaleBoss: saga.finaleBoss ? { ...saga.finaleBoss } : null,
    priorSagas: saga.priorSagas.map((entry) => ({ ...entry })),
  };
}

// Every mutator works on a deep-enough copy: callers keep their arc, and a
// failed pass can always fall back to the original.
function cloneArc(arc: StoryArc): StoryArc {
  return {
    ...arc,
    beats: arc.beats.map((beat) => ({ ...beat })),
    cast: arc.cast.map((npc) => ({ ...npc })),
    events: arc.events.map((event) => ({ ...event })),
    subArcs: arc.subArcs.map((subArc) => ({ ...subArc })),
    saga: cloneSaga(arc.saga),
  };
}

// Clamped merge of a refresh delta. Beat completion is monotonic (a settled
// beat never reopens) and settled beat text is never touched: play reaches
// the spine through annotations, skips, and the event/cast layers, plus the
// clamped current-act rewrites and future-sketch revisions below. Invalid
// indices and unknown ids are ignored, and additions are capped per refresh.
export function applyArcDelta(arc: StoryArc, delta: ArcDelta): StoryArc {
  const next = cloneArc(arc);

  for (const beatNumber of delta.beatsDone) {
    const beat = next.beats[beatNumber - 1];
    if (beat) {
      beat.status = "done";
    }
  }
  for (const beatNumber of delta.beatsSkipped) {
    const beat = next.beats[beatNumber - 1];
    if (beat && beat.status !== "done") {
      beat.status = "skipped";
    }
  }
  for (const annotation of delta.beatAnnotations.slice(0, MAX_ANNOTATIONS)) {
    const beat = next.beats[annotation.beat - 1];
    if (beat) {
      beat.detail = annotation.detail;
    }
  }

  reseatActiveBeat(next.beats, delta.activeBeat);

  // Beat rewrites: the escape hatch for a table that killed or permanently
  // altered what a pending beat depends on. Only unplayed beats of the
  // current act; indices never shift, so later deltas stay valid.
  const activeAfter = next.beats.find((beat) => beat.status === "active");
  const rewriteAct = activeAfter ? activeAfter.act : next.acts;
  for (const rewrite of (delta.beatRewrites ?? []).slice(0, MAX_BEAT_REWRITES)) {
    const beat = next.beats[rewrite.beat - 1];
    if (beat && (beat.status === "pending" || beat.status === "active") && beat.act === rewriteAct) {
      beat.text = rewrite.text;
    }
  }

  // Sketch revisions only touch acts that have not been detailed yet.
  if (next.saga) {
    for (const update of (delta.sketchUpdates ?? []).slice(0, MAX_SKETCH_UPDATES)) {
      const sketch = next.saga.sketches.find((entry) => entry.act === update.act);
      if (!sketch || sketch.status !== "sketch" || sketch.act <= next.acts) {
        continue;
      }
      if (update.milestone) {
        sketch.milestone = update.milestone;
      }
      if (update.boss !== undefined) {
        sketch.boss = update.boss;
      }
      if (update.allies) {
        sketch.allies = update.allies;
      }
    }
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
      id: nextId("sa", next.subArcs),
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

  for (const id of delta.eventsFired) {
    const event = next.events.find((entry) => entry.id === id);
    if (event) {
      event.status = "fired";
    }
  }
  for (const id of delta.eventsDropped) {
    const event = next.events.find((entry) => entry.id === id);
    if (event && event.status === "pending") {
      event.status = "dropped";
    }
  }

  for (const update of delta.castUpdates) {
    const npc = next.cast.find((entry) => entry.id === update.id);
    if (!npc) {
      continue;
    }
    if (update.notes) {
      npc.notes = update.notes;
    }
    if (update.status) {
      npc.status = update.status;
    }
  }

  appendCast(next, delta.newCast.slice(0, MAX_NEW_CAST));
  while (next.cast.length > MAX_CAST) {
    const gone = next.cast.findIndex((npc) => npc.status === "gone");
    next.cast.splice(gone >= 0 ? gone : 0, 1);
  }

  appendEvents(next, delta.newEvents.slice(0, MAX_NEW_EVENTS));

  next.updatedAt = new Date().toISOString();
  return next;
}

// Cast counterpart to appendEvents: same duplicate-name guard, same cap.
function appendCast(arc: StoryArc, raws: Array<Omit<ArcNpc, "id" | "status">>) {
  for (const raw of raws) {
    const key = raw.name.trim().toLowerCase();
    if (arc.cast.length >= MAX_CAST || arc.cast.some((npc) => npc.name.trim().toLowerCase() === key)) {
      continue;
    }
    arc.cast.push({ ...raw, id: nextId("np", arc.cast), status: "active" });
  }
}

// Appends planned events, skipping ones the arc already has. A refresh or
// an act extension routinely re-proposes a thread that is still open (the
// model is shown the arc and echoes it back), and without this the event
// list silts up with duplicates that then crowd the prompt render.
function appendEvents(arc: StoryArc, raws: Array<Omit<ArcEvent, "id" | "status">>) {
  for (const raw of raws) {
    const key = raw.name.trim().toLowerCase();
    if (arc.events.some((event) => event.name.trim().toLowerCase() === key)) {
      continue;
    }
    arc.events.push({ ...raw, id: nextId("ev", arc.events), status: "pending" });
  }
  // Shed the oldest settled events first, so pending plans survive the cap.
  while (arc.events.length > MAX_EVENTS) {
    const settled = arc.events.findIndex((event) => event.status !== "pending");
    arc.events.splice(settled >= 0 ? settled : 0, 1);
  }
}

// Appends a whole new act when the party has played past the current one.
// Existing beats and their statuses are never touched.
export function applyArcExtension(arc: StoryArc, extension: ArcExtension): StoryArc {
  if (arc.acts >= MAX_ACTS || arc.beats.length >= MAX_BEATS) {
    return arc;
  }
  const next = cloneArc(arc);
  const act = next.acts + 1;
  for (const text of extension.beats.slice(0, MAX_ACT_BEATS)) {
    if (next.beats.length >= MAX_BEATS) {
      break;
    }
    next.beats.push({ text, status: "pending", act });
  }
  next.acts = act;
  if (extension.finale) {
    next.finale = extension.finale;
  }
  if (extension.antagonist) {
    next.antagonist = extension.antagonist;
  }
  appendEvents(next, extension.newEvents.slice(0, MAX_NEW_EVENTS));
  reseatActiveBeat(next.beats, null);
  next.updatedAt = new Date().toISOString();
  return next;
}

// The first act still waiting as a sketch beyond the acts already written,
// tolerant of numbering gaps a model may have left.
export function nextSketchAct(arc: StoryArc): ActSketch | null {
  if (!arc.saga) {
    return null;
  }
  return (
    arc.saga.sketches.find((sketch) => sketch.status === "sketch" && sketch.act > arc.acts) ?? null
  );
}

// The saga is finished: every written beat is settled and no act sketch
// remains to detail. The chapter-close orchestration then plans a sequel
// saga rather than another act.
export function sagaComplete(arc: StoryArc): boolean {
  return Boolean(arc.saga) && arcExhausted(arc) && nextSketchAct(arc) === null;
}

// Turns the next act sketch into real beats when the party reaches it: the
// lazy-detail counterpart of applyArcExtension. Existing beats and their
// statuses are never touched, the sketch flips to detailed, and the act's
// planned boss lands as a set-piece event the DM can steer toward.
export function applyActDetail(arc: StoryArc, detail: ActDetail): StoryArc {
  const sketch = nextSketchAct(arc);
  if (!sketch || arc.acts >= MAX_ACTS || arc.beats.length >= MAX_BEATS) {
    return arc;
  }
  const next = cloneArc(arc);
  const act = next.acts + 1;
  for (const text of detail.beats.slice(0, MAX_ACT_BEATS)) {
    if (next.beats.length >= MAX_BEATS) {
      break;
    }
    next.beats.push({ text, status: "pending", act });
  }
  next.acts = act;
  if (next.saga) {
    for (const entry of next.saga.sketches) {
      if (entry.act < act && entry.status === "detailed") {
        entry.status = "done";
      }
    }
    const target = next.saga.sketches.find((entry) => entry.act === sketch.act);
    if (target) {
      // Heal numbering gaps so the sketch aligns with the act it became.
      target.act = act;
      target.status = "detailed";
      if (detail.milestone) {
        target.milestone = detail.milestone;
      }
      if (detail.bossEvent) {
        target.boss = { name: detail.bossEvent.name, detail: detail.bossEvent.detail };
      }
    }
    next.saga.sketches.sort((a, b) => a.act - b.act);
    if (next.saga.plannedActs < act) {
      next.saga.plannedActs = act;
    }
  }
  if (detail.finale) {
    next.finale = detail.finale;
  }
  if (detail.bossEvent) {
    appendEvents(next, [{ ...detail.bossEvent, actHint: act }]);
  }
  appendEvents(next, detail.newEvents.slice(0, MAX_NEW_EVENTS));
  appendCast(next, detail.newCast.slice(0, MAX_NEW_CAST));
  reseatActiveBeat(next.beats, null);
  next.updatedAt = new Date().toISOString();
  return next;
}

// One-time v2 -> v3 upgrade for a campaign already in progress: wraps the
// acts already written into a saga (their sketches are synthesized from
// their own first beats, so nothing is invented about the past) and appends
// the future acts the upgrade planned. Beat text and statuses are never
// touched.
export function applyArcUpgrade(arc: StoryArc, upgrade: SagaUpgrade): StoryArc {
  if (arc.saga) {
    return arc;
  }
  const futures: ActSketch[] = upgrade.sketches
    .slice(0, Math.max(0, MAX_ACTS - arc.acts))
    .map((sketch, index) => ({
      act: arc.acts + 1 + index,
      milestone: sketch.milestone,
      boss: sketch.boss,
      allies: sketch.allies,
      hooks: sketch.hooks,
      status: "sketch" as const,
    }));
  if (!futures.length) {
    return arc;
  }
  const next = cloneArc(arc);
  const synthesized: ActSketch[] = [];
  for (let act = 1; act <= next.acts; act += 1) {
    const actBeats = next.beats.filter((beat) => beat.act === act);
    if (!actBeats.length) {
      continue;
    }
    const settled = actBeats.every(
      (beat) => beat.status === "done" || beat.status === "skipped",
    );
    synthesized.push({
      act,
      milestone: actBeats[0].text,
      boss: null,
      allies: [],
      hooks: [],
      status: settled ? "done" : "detailed",
    });
  }
  next.saga = {
    title: upgrade.title,
    plannedActs: next.acts + futures.length,
    sketches: [...synthesized, ...futures],
    finaleBoss: upgrade.finaleBoss,
    sagaIndex: 1,
    priorSagas: [],
  };
  next.updatedAt = new Date().toISOString();
  return next;
}

// Replaces a concluded saga with its sequel. The new arc arrives fully
// generated (parseSagaJson); the chain carries forward what the table still
// cares about: the concluded saga joins priorSagas, unresolved quest threads
// ride along under fresh ids, and surviving recurring cast the generation
// did not already reuse fill the remaining cast slots with their notes.
export function applySagaChain(oldArc: StoryArc, newArc: StoryArc, resolution: string): StoryArc {
  const next = cloneArc(newArc);
  const priorEntry = {
    title: oldArc.saga?.title || str(oldArc.premise, 80),
    resolution: str(resolution, FIELD_CAP) || str(oldArc.finale, FIELD_CAP) || "The saga concluded.",
  };
  if (next.saga) {
    next.saga.sagaIndex = (oldArc.saga?.sagaIndex ?? 1) + 1;
    next.saga.priorSagas = [...(oldArc.saga?.priorSagas ?? []), priorEntry].slice(-MAX_PRIOR_SAGAS);
  }
  let carried = 0;
  for (const subArc of oldArc.subArcs) {
    if (carried >= 4 || next.subArcs.length >= MAX_SUB_ARCS) {
      break;
    }
    if (subArc.status !== "active" && subArc.status !== "pending") {
      continue;
    }
    const key = subArc.name.trim().toLowerCase();
    if (next.subArcs.some((entry) => entry.name.trim().toLowerCase() === key)) {
      continue;
    }
    next.subArcs.push({ ...subArc, id: nextId("sa", next.subArcs) });
    carried += 1;
  }
  appendCast(
    next,
    oldArc.cast.filter((npc) => npc.status === "active").map(npcPlan),
  );
  next.updatedAt = new Date().toISOString();
  return next;
}

// One-time v1 -> v2 upgrade: adds the cast and event layers and tags beats
// with acts. Beat text and statuses are never touched, so a mid-campaign arc
// keeps all its progress.
export function applyArcEnrichment(arc: StoryArc, enrichment: ArcEnrichment): StoryArc {
  const next = cloneArc(arc);
  for (const mapping of enrichment.beatActs) {
    const beat = next.beats[mapping.beat - 1];
    if (beat) {
      beat.act = mapping.act;
    }
  }
  next.acts = next.beats.reduce((highest, beat) => Math.max(highest, beat.act), 1);
  appendCast(next, enrichment.cast);
  appendEvents(next, enrichment.events);
  next.updatedAt = new Date().toISOString();
  return next;
}

// 1-based number of the [NOW] beat, or null when the arc is exhausted.
export function activeBeatNumber(arc: StoryArc): number | null {
  const index = arc.beats.findIndex((beat) => beat.status === "active");
  return index < 0 ? null : index + 1;
}

// Marks one beat done and advances [NOW]. This is the chapter heartbeat:
// the DM calls complete_beat when the story actually moves, which is what
// closes a chapter, so a party that spends twenty messages searching one
// room completes no beat and stays in the same chapter. Returns null when
// the number is not a real unsettled beat so the tool can say why.
export function completeBeat(
  arc: StoryArc,
  beatNumber: number,
): { arc: StoryArc; beat: ArcBeat } | null {
  const beat = arc.beats[beatNumber - 1];
  if (!beat || beat.status === "done" || beat.status === "skipped") {
    return null;
  }
  const next = cloneArc(arc);
  next.beats[beatNumber - 1].status = "done";
  reseatActiveBeat(next.beats, null);
  next.updatedAt = new Date().toISOString();
  return { arc: next, beat: next.beats[beatNumber - 1] };
}

export function arcExhausted(arc: StoryArc): boolean {
  return arc.beats.every((beat) => beat.status === "done" || beat.status === "skipped");
}

const BEAT_MARKERS: Record<BeatStatus, string> = {
  done: "[done]",
  active: "[NOW]",
  pending: "[ahead]",
  skipped: "[skipped]",
};

const EVENT_LABELS: Record<ArcEventKind, string> = {
  npc_encounter: "NPC encounter",
  ally: "ally",
  twist: "twist",
  betrayal: "betrayal",
  deadline: "deadline",
  discovery: "discovery",
  setpiece: "set piece",
};

// Bounded GAME STATE render. The header carries the steering instruction:
// aim scenes at the [NOW] beat, improvise the path, never dump the plot.
export function renderArcForPrompt(arc: StoryArc): string {
  const lines = [
    "DM story arc (secret; steer scenes toward the [NOW] beat while improvising freely on the way there; never reveal, quote, or rush it). When your narration actually accomplishes the [NOW] beat, call complete_beat in that same reply:",
    `Premise: ${arc.premise}`,
  ];
  if (arc.stakes) {
    lines.push(`Stakes: ${arc.stakes}`);
  }
  if (arc.antagonist) {
    lines.push(`Antagonist: ${arc.antagonist}`);
  }

  const saga = arc.saga;
  const activeIndex = arc.beats.findIndex((beat) => beat.status === "active");
  const currentAct = activeIndex >= 0 ? arc.beats[activeIndex].act : arc.acts;
  if (saga) {
    lines.push(
      `Saga${saga.sagaIndex > 1 ? ` ${saga.sagaIndex} (sequel)` : ""}: "${saga.title}", act ${currentAct} of ${saga.plannedActs} planned.`,
    );
    for (const prior of saga.priorSagas.slice(-2)) {
      lines.push(`Previously concluded: "${prior.title}" (${prior.resolution})`);
    }
  }
  lines.push("Main beats:");
  let renderedAct = 0;
  arc.beats.slice(0, MAX_BEATS).forEach((beat, index) => {
    // Acts the party has finished collapse to one line; only the current and
    // coming acts are worth their tokens every turn. A saga sketch milestone
    // is the cheaper one-liner when it exists.
    if (beat.act < currentAct) {
      if (beat.act !== renderedAct) {
        renderedAct = beat.act;
        const milestone = saga?.sketches.find((entry) => entry.act === beat.act)?.milestone;
        if (milestone) {
          lines.push(`Act ${beat.act} (finished): ${milestone}`);
        } else {
          const actBeats = arc.beats.filter((entry) => entry.act === beat.act);
          lines.push(
            `Act ${beat.act} (finished): ${actBeats
              .map((entry) => `${entry.text}${entry.status === "skipped" ? " [skipped]" : ""}`)
              .join("; ")}`,
          );
        }
      }
      return;
    }
    if (beat.act !== renderedAct) {
      renderedAct = beat.act;
      lines.push(`Act ${beat.act}:`);
    }
    const detail = beat.detail ? ` | table: ${beat.detail}` : "";
    lines.push(`${index + 1}. ${BEAT_MARKERS[beat.status]} ${beat.text}${detail}`);
  });

  // Future acts render as their sketches: the next one in full (its planned
  // allies and party hooks are what the DM should be seeding now), the rest
  // as a milestone and boss line each.
  if (saga) {
    const ahead = saga.sketches.filter(
      (sketch) => sketch.status === "sketch" && sketch.act > arc.acts,
    );
    ahead.slice(0, RENDER_FUTURE_SKETCHES).forEach((sketch, index) => {
      const boss = sketch.boss ? ` | planned boss: ${sketch.boss.name}` : "";
      const extras =
        index === 0
          ? `${sketch.allies.length ? ` | planned allies: ${sketch.allies.join("; ")}` : ""}${sketch.hooks.length ? ` | party hooks: ${sketch.hooks.join("; ")}` : ""}`
          : "";
      lines.push(`Act ${sketch.act} (ahead, sketch only): ${sketch.milestone}${boss}${extras}`);
    });
    if (ahead.length > RENDER_FUTURE_SKETCHES) {
      const extra = ahead.length - RENDER_FUTURE_SKETCHES;
      lines.push(`(...and ${extra} more sketched act${extra === 1 ? "" : "s"} before the finale)`);
    }
  }

  if (arc.finale) {
    lines.push(
      `Finale: ${arc.finale}${saga?.finaleBoss ? ` | final boss: ${saga.finaleBoss.name}` : ""}`,
    );
  } else if (saga?.finaleBoss) {
    lines.push(`Finale: the final boss is ${saga.finaleBoss.name}. ${saga.finaleBoss.detail}`);
  }

  // A gap between acts (or sagas) must not read as "the story is over": the
  // next tier is planned at the chapter break, so hold the table in the
  // aftermath instead of improvising a new main plot that the plan will then
  // contradict.
  if (arcExhausted(arc)) {
    if (nextSketchAct(arc)) {
      lines.push(
        "The current act is complete; the next act will be planned at the chapter break. Play a breather or transition scene that follows from what just happened, and do not open a new major storyline yourself.",
      );
    } else if (saga) {
      lines.push(
        "The saga has concluded; a sequel saga will be planned at the chapter break. Play the aftermath and let the party savor the outcome; do not open a new major storyline yourself.",
      );
    }
  }

  const cast = arc.cast.filter((npc) => npc.status === "active").slice(0, RENDER_CAST);
  if (cast.length) {
    lines.push(
      "Recurring cast (the arc's own people; when one actually appears in a scene, register them with set_npc so their attitude persists):",
    );
    for (const npc of cast) {
      lines.push(
        `- ${npc.name}${npc.role ? `, ${npc.role}` : ""}${npc.agenda ? ` | wants: ${npc.agenda}` : ""}${npc.notes ? ` | so far: ${npc.notes}` : ""}`,
      );
    }
  }

  const pending = arc.events.filter((event) => event.status === "pending");
  if (pending.length) {
    lines.push(
      "Planned events (opportunities, NOT a schedule; fire one only when the fiction naturally reaches its trigger, and if the table went elsewhere, hold it, adapt it, or let it go, never bend a scene to force one):",
    );
    // Events hinted at the current act or earlier come first: they are the
    // ones the table is most likely to walk into next.
    const ordered = [...pending].sort(
      (a, b) => (a.actHint ?? currentAct) - (b.actHint ?? currentAct),
    );
    for (const event of ordered.slice(0, RENDER_PENDING_EVENTS)) {
      const extra =
        event.kind === "ally"
          ? " (an ally who fights goes through add_companion: kind party if they stay, kind guest for one scene)"
          : "";
      lines.push(
        `- [${event.id}] ${EVENT_LABELS[event.kind]}: ${event.name}${event.trigger ? ` | when: ${event.trigger}` : ""} | ${event.detail}${extra}`,
      );
    }
  }

  const open = arc.subArcs.filter(
    (subArc) => subArc.status === "active" || subArc.status === "pending",
  );
  if (open.length) {
    lines.push("Active quests (quest-scale arcs; weave them toward the main beats):");
    for (const subArc of open.slice(0, RENDER_OPEN_SUB_ARCS)) {
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

// Player-safe quest-log projection: names and goals only, never hooks,
// expected beats, cast agendas, or planned events.
export function activeQuestLines(arc: StoryArc): string[] {
  return arc.subArcs
    .filter((subArc) => subArc.status === "active" || subArc.status === "pending")
    .slice(0, 8)
    .map((subArc) => `${subArc.name}: ${subArc.goal}`.slice(0, QUEST_LINE_CAP));
}
