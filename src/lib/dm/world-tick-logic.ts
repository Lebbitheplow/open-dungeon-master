import {
  advanceWorldArc,
  stanceCadence,
  type WorldArc,
} from "./world-arc-logic.ts";

// Pure per-turn world tick, kept free of alias imports so node test scripts
// (scripts/test-world-tick.mjs) can load it directly.
//
// Three probability engines roll silently after each DM turn on a d1000
// with chances that RAMP the longer nothing has happened, so quiet
// stretches build toward something without ever being on a fixed timer:
// - surprise: a small in-scene complication or reversal
// - encounter: something finds the party (suppressed during combat)
// - world arcs: each off-screen clock's next rung (see world-arc-logic.ts)
// A fired engine pushes a "spark": a DIRECTOR NOTE the NEXT player-driven
// turn weaves in, so background dice never trigger model calls themselves.

export type SparkKind = "surprise" | "encounter" | "world";

export type Spark = {
  kind: SparkKind;
  text: string;
  // The world arc that fired this spark, when kind = world.
  arcId?: string;
};

export type WorldTickState = {
  turnCount: number;
  sinceSurprise: number;
  sinceEncounter: number;
  // Turns each world arc has waited since it last advanced, by arc id.
  arcWaits: Record<string, number>;
  sparks: Spark[];
};

export type TickConfig = {
  surprise: { base: number; slope: number; cap: number };
  encounter: { grace: number; slope: number; cap: number };
  worldArcSlope: number;
  worldArcCap: number;
};

// Permille ramps: expected intervals of roughly ~20 turns (surprise),
// ~35 turns (encounter, after its grace), ~25 turns per world-arc rung at
// the default cadence. Overridable via DM_TICK_* env (read by the caller).
export const DEFAULT_TICK_CONFIG: TickConfig = {
  surprise: { base: 5, slope: 4, cap: 150 },
  encounter: { grace: 10, slope: 3, cap: 100 },
  worldArcSlope: 2,
  worldArcCap: 100,
};

const MAX_SPARKS = 3;

export function emptyTickState(): WorldTickState {
  return { turnCount: 0, sinceSurprise: 0, sinceEncounter: 0, arcWaits: {}, sparks: [] };
}

export function parseTickState(raw: string): WorldTickState {
  if (!raw) {
    return emptyTickState();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorldTickState>;
    const count = (value: unknown) => Math.max(0, Math.floor(Number(value)) || 0);
    const arcWaits: Record<string, number> = {};
    if (parsed.arcWaits && typeof parsed.arcWaits === "object") {
      for (const [key, value] of Object.entries(parsed.arcWaits)) {
        arcWaits[key] = count(value);
      }
    }
    return {
      turnCount: count(parsed.turnCount),
      sinceSurprise: count(parsed.sinceSurprise),
      sinceEncounter: count(parsed.sinceEncounter),
      arcWaits,
      sparks: (Array.isArray(parsed.sparks) ? parsed.sparks : [])
        .filter(
          (spark): spark is Spark =>
            Boolean(spark) &&
            (spark.kind === "surprise" || spark.kind === "encounter" || spark.kind === "world") &&
            typeof spark.text === "string" &&
            Boolean(spark.text),
        )
        .slice(0, MAX_SPARKS),
    };
  } catch {
    return emptyTickState();
  }
}

export function surpriseChance(turnsSince: number, config: TickConfig): number {
  return Math.min(config.surprise.cap, config.surprise.base + config.surprise.slope * turnsSince);
}

export function encounterChance(turnsSince: number, config: TickConfig): number {
  if (turnsSince < config.encounter.grace) {
    return 0;
  }
  return Math.min(config.encounter.cap, config.encounter.slope * (turnsSince - config.encounter.grace));
}

export function worldArcChance(arc: WorldArc, turnsWaited: number, config: TickConfig): number {
  return Math.min(config.worldArcCap, stanceCadence(arc) + config.worldArcSlope * turnsWaited);
}

export type Rng = () => number; // uniform in [0, 1)

const SURPRISE_SPARK =
  "Work a small surprise into the next scene: a reversal, an odd discovery, an unexpected arrival, or a complication in whatever the party is doing. Keep it proportionate; not every surprise is a threat.";
const ENCOUNTER_SPARK =
  "Something finds the party: an encounter fitting the current location and hour arrives on its own (a patrol, a beast, a traveler, trouble). It need not be hostile; if violence breaks out, use start_encounter.";

function pushSpark(sparks: Spark[], spark: Spark): Spark[] {
  // One pending spark per kind; newest wins, queue stays bounded.
  return [...sparks.filter((entry) => entry.kind !== spark.kind), spark].slice(-MAX_SPARKS);
}

export type TickResult = {
  state: WorldTickState;
  // World arcs after any rung advances (unchanged references otherwise).
  worldArcs: WorldArc[];
  // Rung texts reached this tick, for the fact record.
  reachedRungs: Array<{ arc: WorldArc; rung: string }>;
};

// One post-turn tick. Pure: dice come from the injected rng.
export function tickWorld(
  state: WorldTickState,
  worldArcs: WorldArc[],
  options: { inEncounter: boolean },
  rng: Rng,
  config: TickConfig = DEFAULT_TICK_CONFIG,
): TickResult {
  const roll = () => Math.floor(rng() * 1000);
  let sparks = state.sparks;
  const next: WorldTickState = {
    turnCount: state.turnCount + 1,
    sinceSurprise: state.sinceSurprise + 1,
    sinceEncounter: state.sinceEncounter + 1,
    arcWaits: { ...state.arcWaits },
    sparks,
  };

  if (roll() < surpriseChance(next.sinceSurprise, config)) {
    sparks = pushSpark(sparks, { kind: "surprise", text: SURPRISE_SPARK });
    next.sinceSurprise = 0;
  }
  if (options.inEncounter) {
    // Combat pauses the encounter clock entirely.
    next.sinceEncounter = state.sinceEncounter;
  } else if (roll() < encounterChance(next.sinceEncounter, config)) {
    sparks = pushSpark(sparks, { kind: "encounter", text: ENCOUNTER_SPARK });
    next.sinceEncounter = 0;
  }

  const reachedRungs: Array<{ arc: WorldArc; rung: string }> = [];
  const advanced = worldArcs.map((arc) => {
    if (arc.status === "resolved") {
      delete next.arcWaits[arc.id];
      return arc;
    }
    const waited = (next.arcWaits[arc.id] ?? 0) + 1;
    if (roll() < worldArcChance(arc, waited, config)) {
      const result = advanceWorldArc(arc);
      next.arcWaits[arc.id] = 0;
      if (result.reachedRung) {
        reachedRungs.push({ arc: result.arc, rung: result.reachedRung });
        sparks = pushSpark(sparks, {
          kind: "world",
          arcId: arc.id,
          text: `Off-screen development in "${result.arc.name}": ${result.reachedRung} Let word of it reach the party naturally this scene or soon: rumor, news, refugees, aftermath.`,
        });
      }
      return result.arc;
    }
    next.arcWaits[arc.id] = waited;
    return arc;
  });

  next.sparks = sparks;
  return { state: next, worldArcs: advanced, reachedRungs };
}

// Timeskips (a long rest, a journey) are several quiet ticks at once, with
// no surprise/encounter sparks piling up: only the world moves.
export function tickWorldQuietly(
  state: WorldTickState,
  worldArcs: WorldArc[],
  ticks: number,
  rng: Rng,
  config: TickConfig = DEFAULT_TICK_CONFIG,
): TickResult {
  let current: TickResult = { state, worldArcs, reachedRungs: [] };
  const all: Array<{ arc: WorldArc; rung: string }> = [];
  for (let index = 0; index < Math.max(1, Math.min(ticks, 12)); index += 1) {
    const before = current.state.sparks;
    current = tickWorld(current.state, current.worldArcs, { inEncounter: true }, rng, config);
    // inEncounter suppresses the encounter engine; drop any surprise spark
    // the quiet tick generated and keep only world sparks.
    current.state.sparks = [
      ...before.filter((spark) => spark.kind !== "world"),
      ...current.state.sparks.filter((spark) => spark.kind === "world"),
    ].slice(-MAX_SPARKS);
    all.push(...current.reachedRungs);
  }
  return { ...current, reachedRungs: all };
}

// Sparks are consumed the moment a turn's prompt carried them.
export function drainSparks(state: WorldTickState): WorldTickState {
  return { ...state, sparks: [] };
}
