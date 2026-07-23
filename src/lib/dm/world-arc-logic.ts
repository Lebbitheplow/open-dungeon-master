import { stripReasoningArtifacts } from "../story-prompt.ts";

// Pure world-arc logic, kept free of alias imports so node test scripts
// (scripts/test-world-arcs.mjs) can load it directly.
//
// A world arc is a DM-secret off-screen clock: a storyline that advances on
// background dice whether or not the party engages (a cult's summoning, a
// warlord's march, a plague's spread). It is ADDITIVE to the story arc, a
// sibling of subArcs, and never touches beats, acts, or the saga: subArcs
// are quests the party plays; world arcs are what the world does around
// them. Every rung is pre-authored at generation time, so advancing one
// costs zero model calls; the reached rung's text feeds the prompt as
// rumor/news material and the ignored-threat consequences are permanent.

export type WorldArcStance = "unaware" | "ignoring" | "opposing" | "aiding" | "fleeing";
export type WorldArcStatus = "building" | "climax" | "resolved";

export type WorldArc = {
  // Server-allocated ("wa1", "wa2", ...).
  id: string;
  name: string;
  // Who or what pushes it forward.
  driver: string;
  // 5-8 pre-authored escalation stages, written at generation time.
  rungs: string[];
  // Index of the highest rung REACHED (-1 = not yet begun).
  rung: number;
  // How the party currently relates to it, judged at chapter close.
  stance: WorldArcStance;
  // Baseline advance chance in permille per turn; the tick engine ramps it
  // by turns waited (see world-tick-logic.ts).
  cadence: number;
  // Permanent record of what ignoring or fleeing this arc cost the world.
  consequences: string[];
  status: WorldArcStatus;
};

export type WorldArcUpdate = {
  id: string;
  stance?: WorldArcStance;
  // A permanent consequence of the party's stance (usually ignoring).
  consequence?: string;
};

const MAX_WORLD_ARCS = 3;
const MAX_RUNGS = 8;
const MIN_RUNGS = 3;
const RUNG_CAP = 240;
const NAME_CAP = 80;
const DRIVER_CAP = 200;
const CONSEQUENCE_CAP = 240;
const MAX_CONSEQUENCES = 8;
export const DEFAULT_CADENCE = 12;

const STANCES: WorldArcStance[] = ["unaware", "ignoring", "opposing", "aiding", "fleeing"];

function str(value: unknown, cap: number): string {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

function nextId(existing: WorldArc[]): string {
  let index = existing.length + 1;
  while (existing.some((arc) => arc.id === `wa${index}`)) {
    index += 1;
  }
  return `wa${index}`;
}

function normalizeWorldArc(raw: unknown, id: string): WorldArc | null {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object") {
    return null;
  }
  const name = str(record.name, NAME_CAP);
  const rungs = (Array.isArray(record.rungs) ? record.rungs : [])
    .map((entry) => str(entry, RUNG_CAP))
    .filter(Boolean)
    .slice(0, MAX_RUNGS);
  if (!name || rungs.length < MIN_RUNGS) {
    return null;
  }
  const storedId = str(record.id, 10);
  const rung = Math.floor(Number(record.rung));
  const stance = STANCES.includes(record.stance as WorldArcStance)
    ? (record.stance as WorldArcStance)
    : "unaware";
  const cadence = Math.floor(Number(record.cadence));
  const status = record.status === "climax" || record.status === "resolved"
    ? (record.status as WorldArcStatus)
    : "building";
  return {
    id: /^wa\d+$/.test(storedId) ? storedId : id,
    name,
    driver: str(record.driver, DRIVER_CAP),
    rungs,
    rung: Number.isFinite(rung) ? Math.max(-1, Math.min(rung, rungs.length - 1)) : -1,
    stance,
    cadence:
      Number.isFinite(cadence) && cadence > 0 ? Math.min(cadence, 100) : DEFAULT_CADENCE,
    consequences: (Array.isArray(record.consequences) ? record.consequences : [])
      .map((entry) => str(entry, CONSEQUENCE_CAP))
      .filter(Boolean)
      .slice(0, MAX_CONSEQUENCES),
    status,
  };
}

export function normalizeWorldArcs(raw: unknown): WorldArc[] {
  const arcs: WorldArc[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const arc = normalizeWorldArc(entry, nextId(arcs));
    if (arc && !arcs.some((existing) => existing.id === arc.id)) {
      arcs.push(arc);
    }
    if (arcs.length >= MAX_WORLD_ARCS) {
      break;
    }
  }
  return arcs;
}

// Parses the generation pass's JSON (an array of {name, driver, rungs}).
export function parseWorldArcsJson(raw: string): WorldArc[] {
  const cleaned = stripReasoningArtifacts(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) {
    return [];
  }
  try {
    return normalizeWorldArcs(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return [];
  }
}

// One dice-driven step up the ladder. The caller decides WHETHER the arc
// advances this turn (the tick engine's roll); this applies the step.
export function advanceWorldArc(arc: WorldArc): {
  arc: WorldArc;
  reachedRung: string | null;
} {
  if (arc.status === "resolved" || arc.rung >= arc.rungs.length - 1) {
    return { arc, reachedRung: null };
  }
  const rung = arc.rung + 1;
  const status: WorldArcStatus = rung >= arc.rungs.length - 1 ? "climax" : arc.status;
  return {
    arc: { ...arc, rung, status },
    reachedRung: arc.rungs[rung],
  };
}

// Chapter-close stance judgments from the arc refresh pass. Ignoring or
// fleeing a named threat leaves a permanent consequence on the record.
export function applyWorldArcUpdates(
  arcs: WorldArc[],
  updates: WorldArcUpdate[],
): WorldArc[] {
  return arcs.map((arc) => {
    const update = updates.find((entry) => entry.id === arc.id);
    if (!update) {
      return arc;
    }
    const next = { ...arc };
    if (update.stance && STANCES.includes(update.stance)) {
      next.stance = update.stance;
    }
    const consequence = str(update.consequence, CONSEQUENCE_CAP);
    if (consequence && !next.consequences.includes(consequence)) {
      next.consequences = [...next.consequences, consequence].slice(-MAX_CONSEQUENCES);
    }
    return next;
  });
}

export function resolveWorldArc(arcs: WorldArc[], id: string): WorldArc[] {
  return arcs.map((arc) => (arc.id === id ? { ...arc, status: "resolved" as const } : arc));
}

// Party opposition and aid tug the clock: an opposed arc rolls at 2/3
// cadence, an aided one at 4/3. Applied inside the tick engine.
export function stanceCadence(arc: WorldArc): number {
  if (arc.stance === "opposing") {
    return Math.max(1, Math.round((arc.cadence * 2) / 3));
  }
  if (arc.stance === "aiding") {
    return Math.round((arc.cadence * 4) / 3);
  }
  return arc.cadence;
}

// The DM-secret render for GAME STATE: current rung, what comes next (so
// foreshadowing lands), stance, and the permanent consequences. Bounded.
export function renderWorldArcsForPrompt(arcs: WorldArc[]): string {
  const active = arcs.filter((arc) => arc.status !== "resolved");
  if (!active.length) {
    return "";
  }
  const lines = active.map((arc) => {
    const parts = [
      `- ${arc.name} (${arc.driver || "unknown driver"}) [party: ${arc.stance}]`,
    ];
    if (arc.rung >= 0) {
      parts.push(`  now: ${arc.rungs[arc.rung]}`);
    } else {
      parts.push(`  not yet begun; first sign would be: ${arc.rungs[0]}`);
    }
    if (arc.rung < arc.rungs.length - 1 && arc.rung >= 0) {
      parts.push(`  brewing next: ${arc.rungs[arc.rung + 1]}`);
    }
    if (arc.status === "climax") {
      parts.push(`  AT ITS CLIMAX: resolve it on screen soon.`);
    }
    for (const consequence of arc.consequences.slice(-2)) {
      parts.push(`  consequence on record: ${consequence}`);
    }
    return parts.join("\n");
  });
  return `Off-screen world arcs (DM-secret clocks advancing on their own; weave reached stages into scenes as rumors, news, and encountered aftermath, never as announcements. The party's stance is judged at each chapter close; ignoring a direct threat has permanent consequences):\n${lines.join("\n")}`;
}
