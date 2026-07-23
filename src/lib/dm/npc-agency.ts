import { listNpcs, patchNpcAgency, type Npc } from "@/lib/db/npcs";
import { recordExtractedFacts } from "@/lib/db/facts";
import { publishEphemeral } from "@/lib/events";
import { rollExpression } from "@/lib/dice";
import {
  advanceSessionGoal,
  detectGoalCollisions,
  shiftRelation,
  tickPressure,
} from "@/lib/dm/npc-logic";
import type { FactCandidate } from "@/lib/dm/fact-logic";

// The background goal engine: once per chapter close, every tracked NPC's
// life moves on without a single model call. Pressure counters notice who
// the chapter featured and who it ignored, session goals advance on real
// dice, finished goals and goal collisions become DM-only world facts the
// next prompts surface as rumors. Timeskips (long rests, travel) reuse the
// same pass via extra rounds.

export function advanceNpcAgency(
  campaignId: string,
  chapterTranscript: string,
  options: { rounds?: number; tickPressureCounters?: boolean } = {},
) {
  const rounds = Math.max(1, Math.min(5, options.rounds ?? 1));
  const npcs = listNpcs(campaignId);
  if (!npcs.length) {
    return;
  }
  const transcript = chapterTranscript.toLowerCase();
  const facts: FactCandidate[] = [];
  const holders: Array<{ npc: Npc; goalText: string }> = [];

  for (const npc of npcs) {
    let goals = npc.agency.goals;
    const pressure =
      options.tickPressureCounters === false
        ? npc.agency.pressure
        : tickPressure(npc.agency.pressure, transcript.includes(npc.name.toLowerCase()));

    for (let round = 0; round < rounds && goals.session; round += 1) {
      const result = advanceSessionGoal(
        goals.session,
        npc.agency.personality,
        rollExpression("1d20").total,
      );
      if (result.completed) {
        facts.push({
          category: "npc",
          subject: npc.name,
          fact: `Off-screen, ${npc.name} achieved what they were working toward: ${goals.session.text}.`,
        });
        goals = { ...goals, session: undefined };
      } else {
        goals = { ...goals, session: result.goal };
      }
    }

    patchNpcAgency(npc.id, { pressure, goals });
    if (goals.session) {
      holders.push({ npc, goalText: goals.session.text });
    }
  }

  // Two NPCs chasing the same prize contest it with opposed dice; the loser
  // resents the winner and the outcome surfaces as a rumor-ready fact.
  const collisions = detectGoalCollisions(
    holders.map((holder) => ({ name: holder.npc.name, goalText: holder.goalText })),
  ).slice(0, 2);
  for (const collision of collisions) {
    const a = holders.find((holder) => holder.npc.name === collision.a);
    const b = holders.find((holder) => holder.npc.name === collision.b);
    if (!a || !b) {
      continue;
    }
    const rollA = rollExpression("1d20").total + (a.npc.agency.personality?.drive ?? 0);
    const rollB = rollExpression("1d20").total + (b.npc.agency.personality?.drive ?? 0);
    if (rollA === rollB) {
      continue;
    }
    const [winner, loser] = rollA > rollB ? [a.npc, b.npc] : [b.npc, a.npc];
    facts.push({
      category: "npc",
      subject: loser.name,
      fact: `Off-screen, ${winner.name} outmaneuvered ${loser.name} in their rivalry over "${collision.over}"; ${loser.name} lost ground and resents it.`,
    });
    patchNpcAgency(loser.id, {
      relations: shiftRelation(loser.agency.relations, winner.name, -1, "outmaneuvered"),
    });
    patchNpcAgency(winner.id, {
      relations: shiftRelation(winner.agency.relations, loser.name, -1, "rival"),
    });
  }

  if (facts.length) {
    const inserted = recordExtractedFacts(campaignId, facts, "simulation", {
      knownBy: "dm",
    });
    if (inserted.length) {
      publishEphemeral(campaignId, "facts_updated", {});
    }
  }
}
