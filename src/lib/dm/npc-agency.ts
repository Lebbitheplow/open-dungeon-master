import { campaignLanguage } from "@/lib/db/campaigns";
import { listNpcs, patchNpcAgency, setNpcArchived, type Npc } from "@/lib/db/npcs";
import { listRelationships } from "@/lib/db/relationships";
import { shouldArchive } from "@/lib/dm/npc-archive-logic";
import { recordExtractedFacts } from "@/lib/db/facts";
import { publishEphemeral } from "@/lib/events";
import { rollExpression } from "@/lib/dice";
import {
  advanceSessionGoal,
  shiftRelation,
  tickPressure,
} from "@/lib/dm/npc-logic";
import { detectGoalCollisions } from "@/lib/dm/npc-goal-logic";
import { avengingRound } from "@/lib/dm/companion-revenge";
import { agendaRounds } from "@/lib/dm/companion-agenda";
import type { FactCandidate } from "@/lib/dm/fact-logic";
import { textKey } from "@/lib/language/text-logic";

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
  const transcript = textKey(chapterTranscript);
  // Standing and romance live on the relationships table; the old per-NPC
  // bonds column is superseded and no longer written, so the archive guard
  // reads the table (issue 501's side finding: a romanced NPC was rostered
  // out because the guard only asked bonds_json).
  const standing = new Map<string, { relationship: boolean; romance: boolean }>();
  for (const relationship of listRelationships(campaignId)) {
    if (relationship.status === "ended") {
      continue;
    }
    const key = textKey(relationship.subjectName);
    const entry = standing.get(key) ?? { relationship: false, romance: false };
    entry.relationship ||= relationship.approval !== 0;
    entry.romance ||= relationship.romance !== "none";
    standing.set(key, entry);
  }
  const facts: FactCandidate[] = [];
  const holders: Array<{ npc: Npc; goalText: string }> = [];

  for (const npc of npcs) {
    let goals = npc.agency.goals;
    const pressure =
      options.tickPressureCounters === false
        ? npc.agency.pressure
        : tickPressure(npc.agency.pressure, transcript.includes(textKey(npc.name)));

    for (let round = 0; round < rounds && goals.session; round += 1) {
      const result = advanceSessionGoal(
        goals.session,
        npc.agency.personality,
        rollExpression("1d20").total,
      );
      // A companion who left to gather help against the party (issue 503):
      // each round leaves a rumour, and the last one cues their return.
      facts.push(...avengingRound(campaignId, npc, { completed: result.completed, goal: result.goal }));
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
    // A companion's hidden employer's order comes on the same dice (issue
    // 503 Phase 8, src/lib/dm/companion-agenda.ts).
    agendaRounds(campaignId, npc, rounds);
    // Roster hygiene, decided from the counters just ticked. Protections
    // live in npc-archive-logic.ts; an NPC with standing, a romance or an
    // unfinished goal is never rostered out mid-thread.
    const held = standing.get(textKey(npc.name));
    const decision = shouldArchive({
      id: npc.id,
      name: npc.name,
      aliases: npc.aliases,
      ignored: pressure.ignored,
      engaged: pressure.engaged,
      archived: npc.archived,
      hasBond: npc.agency.bonds.length > 0 || Boolean(held?.relationship),
      hasRelationship: npc.agency.relations.length > 0,
      hasRomance: Boolean(held?.romance),
      hasPendingGoal: Boolean(goals.session),
    });
    if (decision.archive) {
      setNpcArchived(npc.id, true);
    }
    if (goals.session) {
      holders.push({ npc, goalText: goals.session.text });
    }
  }

  // Two NPCs chasing the same prize contest it with opposed dice; the loser
  // resents the winner and the outcome surfaces as a rumor-ready fact.
  const pool = npcs.flatMap((npc) => {
    const { scene, session, ambition } = npc.agency.goals;
    return [scene, session?.text, ambition].filter((goal): goal is string => Boolean(goal));
  });
  const collisions = detectGoalCollisions(
    holders.map((holder) => ({ name: holder.npc.name, goalText: holder.goalText })),
    campaignLanguage(campaignId),
    pool,
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
