import { getCampaignById } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestDmMessage } from "@/lib/dm/model";
import { renderArcForPrompt, type StoryArc } from "@/lib/dm/arc-logic";
import { parseWorldArcsJson, type WorldArc } from "@/lib/dm/world-arc-logic";

// World-arc generation: the one model call the world-simulation engine ever
// makes. It runs when a campaign has no unresolved world arcs (at arc
// generation, and again after the party resolves the clocks in play), so it
// fires at most once per act in practice. Every rung is authored here, up
// front; advancing them later is pure dice (world-tick-logic.ts).

const GENERATE_SYSTEM = `You are planning the OFF-SCREEN side of an AI DM's secret story arc for a D&D 5e campaign: 1 or 2 world arcs, storylines that advance on their own whether or not the party engages (a cult's summoning nearing completion, a warlord's march, a plague's spread, a rival expedition closing in). Keep it brief and answer quickly.

Reply with ONLY a strict JSON array, no code fences, shaped exactly: [{"name": string, "driver": string, "rungs": string[]}]

name: the arc's short name. driver: who or what pushes it forward (a faction or figure, not the party). rungs: 5 to 7 ordered escalation stages, each ONE sentence describing a world change observable in play (rumors, prices, refugees, omens, troop movements), from first whisper to full catastrophe or triumph. The last rung is what happens if nobody ever stops it.

Rules: grow the arcs out of the campaign's own antagonist, factions, and unfinished threads rather than inventing an unrelated world; at most one arc may belong to the main antagonist. Do not include the party in any rung; these are what the WORLD does. Every string under 220 characters. Players never see this.`;

export async function generateWorldArcs(
  campaignId: string,
  arc: StoryArc,
): Promise<WorldArc[]> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return [];
  }
  const chapters = listChapters(campaignId)
    .filter((chapter) => chapter.status === "closed")
    .slice(-4)
    .map((chapter) => `${chapter.index}. "${chapter.title}"`)
    .join("\n");
  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      { role: "system", content: GENERATE_SYSTEM },
      {
        role: "user",
        content: [
          `The story arc these world arcs orbit:\n${renderArcForPrompt(arc)}`,
          chapters ? `Chapters played so far:\n${chapters}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    { timeoutMs: arcTextTimeoutMs() },
  );
  if (error) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] world arc generation: model call failed");
    }
    return [];
  }
  const arcs = parseWorldArcsJson(typeof message?.content === "string" ? message.content : "");
  if (!arcs.length && process.env.DM_DEBUG) {
    console.log(
      "[dm-debug] world arc generation: unparseable reply:",
      String(message?.content ?? "").slice(0, 400),
    );
  }
  return arcs;
}

// Tops up a story arc that has no live off-screen clocks. Failure returns
// the arc unchanged; generation simply retries at the next chapter close.
export async function ensureWorldArcs(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.gameSettings.worldSimulation) {
    return arc;
  }
  if (arc.worldArcs.some((worldArc) => worldArc.status !== "resolved")) {
    return arc;
  }
  try {
    const generated = await generateWorldArcs(campaignId, arc);
    if (!generated.length) {
      return arc;
    }
    // Resolved clocks stay on record (their consequences are history);
    // fresh ones join alongside under non-colliding ids.
    const kept = arc.worldArcs.filter((worldArc) => worldArc.status === "resolved");
    const merged = [...kept];
    for (const worldArc of generated) {
      let index = merged.length + 1;
      while (merged.some((existing) => existing.id === `wa${index}`)) {
        index += 1;
      }
      merged.push({ ...worldArc, id: `wa${index}` });
    }
    return { ...arc, worldArcs: merged.slice(0, 3) };
  } catch (error) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] world arc generation threw:", error);
    }
    return arc;
  }
}
