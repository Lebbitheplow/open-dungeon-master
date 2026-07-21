import { stripReasoningArtifacts } from "../story-prompt.ts";

// Pure story-arc logic, kept free of alias imports so node test scripts
// (scripts/test-arc.mjs) can load it directly. The arc is the DM's secret
// spine: a multi-act main plot, a recurring cast, planned special events,
// and quest-scale sub-arcs. Refreshes apply small clamped deltas, never full
// rewrites, so a confused model can stall the arc but can never thrash it.
//
// Beat TEXT is immutable once written. Play reaches the spine through
// annotations (a beat's `detail`), skipped beats, fired/dropped events, and
// new cast, never by rewording the plot.

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

export type StoryArc = {
  version: 2;
  premise: string;
  stakes: string;
  antagonist: string;
  // Ordered main beats across `acts` acts; the last act escalates into the
  // finale. Extended a whole act at a time when the party plays past it.
  beats: ArcBeat[];
  // Highest act number written so far.
  acts: number;
  finale: string;
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

const MAX_BEATS = 24;
const MAX_ACT_BEATS = 8;
const MAX_ACTS = 8;
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

// Validates/coerces a parsed object into a StoryArc; null on garbage. Also
// guards reads of the stored JSON, so a corrupt row degrades to arc-less,
// and upgrades v1 rows in place (beats gain act 1, layers default empty).
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

  return {
    version: 2,
    premise,
    stakes: str(record.stakes, 400),
    antagonist: str(record.antagonist, 400),
    beats,
    acts: beats.reduce((highest, beat) => Math.max(highest, beat.act), 1),
    finale: str(record.finale, 400),
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

// Clamped merge of a refresh delta. Beat completion is monotonic (a settled
// beat never reopens) and beat text is never touched: play reaches the spine
// through annotations, skips, and the event/cast layers. Invalid indices and
// unknown ids are ignored, and additions are capped per refresh.
export function applyArcDelta(arc: StoryArc, delta: ArcDelta): StoryArc {
  const next: StoryArc = {
    ...arc,
    beats: arc.beats.map((beat) => ({ ...beat })),
    cast: arc.cast.map((npc) => ({ ...npc })),
    events: arc.events.map((event) => ({ ...event })),
    subArcs: arc.subArcs.map((subArc) => ({ ...subArc })),
  };

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
  const next: StoryArc = {
    ...arc,
    beats: arc.beats.map((beat) => ({ ...beat })),
    cast: arc.cast.map((npc) => ({ ...npc })),
    events: arc.events.map((event) => ({ ...event })),
    subArcs: arc.subArcs.map((subArc) => ({ ...subArc })),
  };
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

// One-time v1 -> v2 upgrade: adds the cast and event layers and tags beats
// with acts. Beat text and statuses are never touched, so a mid-campaign arc
// keeps all its progress.
export function applyArcEnrichment(arc: StoryArc, enrichment: ArcEnrichment): StoryArc {
  const next: StoryArc = {
    ...arc,
    beats: arc.beats.map((beat) => ({ ...beat })),
    cast: arc.cast.map((npc) => ({ ...npc })),
    events: arc.events.map((event) => ({ ...event })),
    subArcs: arc.subArcs.map((subArc) => ({ ...subArc })),
  };
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
  const next: StoryArc = {
    ...arc,
    beats: arc.beats.map((entry) => ({ ...entry })),
    cast: arc.cast.map((npc) => ({ ...npc })),
    events: arc.events.map((event) => ({ ...event })),
    subArcs: arc.subArcs.map((subArc) => ({ ...subArc })),
  };
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

  const activeIndex = arc.beats.findIndex((beat) => beat.status === "active");
  const currentAct = activeIndex >= 0 ? arc.beats[activeIndex].act : arc.acts;
  lines.push("Main beats:");
  let renderedAct = 0;
  arc.beats.slice(0, MAX_BEATS).forEach((beat, index) => {
    // Acts the party has finished collapse to one line; only the current and
    // coming acts are worth their tokens every turn.
    if (beat.act < currentAct) {
      if (beat.act !== renderedAct) {
        renderedAct = beat.act;
        const actBeats = arc.beats.filter((entry) => entry.act === beat.act);
        lines.push(
          `Act ${beat.act} (finished): ${actBeats
            .map((entry) => `${entry.text}${entry.status === "skipped" ? " [skipped]" : ""}`)
            .join("; ")}`,
        );
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
  if (arc.finale) {
    lines.push(`Finale: ${arc.finale}`);
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
