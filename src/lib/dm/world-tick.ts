import {
  getCampaignById,
  getWorldTickJson,
  setStoryArc,
  setWorldTickJson,
} from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { recordExtractedFacts } from "@/lib/db/facts";
import { publishEphemeral } from "@/lib/events";
import { advanceNpcAgency } from "@/lib/dm/npc-agency";
import {
  DEFAULT_TICK_CONFIG,
  drainSparks,
  parseTickState,
  tickWorld,
  tickWorldQuietly,
  type Spark,
  type TickConfig,
  type TickResult,
} from "@/lib/dm/world-tick-logic";

// The impure rim around world-tick-logic.ts: reads/writes the per-campaign
// counters, persists advanced world arcs back into the story arc, records
// reached rungs as DM-only facts, and hands pending sparks to the prompt.
// Runs on the post-narration heartbeat (turn.ts), so it is already
// serialized on the DM queue. Zero model calls.

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// DM_TICK_* env knobs, read per tick so tuning needs no restart discipline.
function tickConfig(): TickConfig {
  const defaults = DEFAULT_TICK_CONFIG;
  return {
    surprise: {
      base: envNumber("DM_TICK_SURPRISE_BASE", defaults.surprise.base),
      slope: envNumber("DM_TICK_SURPRISE_SLOPE", defaults.surprise.slope),
      cap: envNumber("DM_TICK_SURPRISE_CAP", defaults.surprise.cap),
    },
    encounter: {
      grace: envNumber("DM_TICK_ENCOUNTER_GRACE", defaults.encounter.grace),
      slope: envNumber("DM_TICK_ENCOUNTER_SLOPE", defaults.encounter.slope),
      cap: envNumber("DM_TICK_ENCOUNTER_CAP", defaults.encounter.cap),
    },
    worldArcSlope: envNumber("DM_TICK_ARC_SLOPE", defaults.worldArcSlope),
    worldArcCap: envNumber("DM_TICK_ARC_CAP", defaults.worldArcCap),
  };
}

function persistTickResult(campaignId: string, result: TickResult) {
  const campaign = getCampaignById(campaignId);
  if (campaign?.storyArc && result.reachedRungs.length) {
    setStoryArc(campaignId, {
      ...campaign.storyArc,
      worldArcs: campaign.storyArc.worldArcs.map(
        (worldArc) =>
          result.worldArcs.find((advanced) => advanced.id === worldArc.id) ?? worldArc,
      ),
    });
    const inserted = recordExtractedFacts(
      campaignId,
      result.reachedRungs.map((reached) => ({
        category: "world" as const,
        subject: reached.arc.name,
        fact: `Off-screen, "${reached.arc.name}" advanced: ${reached.rung}`,
      })),
      "simulation",
      { knownBy: "dm" },
    );
    if (inserted.length) {
      publishEphemeral(campaignId, "facts_updated", {});
    }
  }
  setWorldTickJson(campaignId, JSON.stringify(result.state));
}

// The per-turn tick: one d1000 roll per engine, sparks queued for the next
// player-driven turn. Never throws (heartbeat callers must not wedge).
export function tickWorldState(campaignId: string) {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.gameSettings.worldSimulation) {
      return;
    }
    const result = tickWorld(
      parseTickState(getWorldTickJson(campaignId)),
      campaign.storyArc?.worldArcs ?? [],
      { inEncounter: Boolean(getActiveEncounter(campaignId)) },
      Math.random,
      tickConfig(),
    );
    persistTickResult(campaignId, result);
  } catch (error) {
    console.error("[world-tick] turn tick failed", error);
  }
}

// Timeskips (long rest, travel): several quiet world ticks at once plus a
// round of NPC goal advancement, so time passing means the world moved.
export function tickWorldTimeskip(campaignId: string, ticks: number) {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.gameSettings.worldSimulation) {
      return;
    }
    const result = tickWorldQuietly(
      parseTickState(getWorldTickJson(campaignId)),
      campaign.storyArc?.worldArcs ?? [],
      ticks,
      Math.random,
      tickConfig(),
    );
    persistTickResult(campaignId, result);
    advanceNpcAgency(campaignId, "", { rounds: 1, tickPressureCounters: false });
  } catch (error) {
    console.error("[world-tick] timeskip failed", error);
  }
}

// Pending sparks are consumed on read: the caller is about to put them in a
// prompt, and a spark lost to a failed turn simply re-rolls later.
export function consumePendingSparks(campaignId: string): Spark[] {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.gameSettings.worldSimulation) {
      return [];
    }
    const state = parseTickState(getWorldTickJson(campaignId));
    if (!state.sparks.length) {
      return [];
    }
    setWorldTickJson(campaignId, JSON.stringify(drainSparks(state)));
    return state.sparks;
  } catch {
    return [];
  }
}
