import {
  getCampaignById,
  setQuestLog,
  setStoryArc,
} from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { genrePreset } from "@/lib/genres";
import {
  activeQuestLines,
  applyArcDelta,
  parseArcDeltaJson,
  parseArcJson,
  renderArcForPrompt,
} from "@/lib/dm/arc-logic";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestDmMessage } from "@/lib/dm/model";
import { setDmStatus } from "@/lib/dm/status";

// Story-arc generation and upkeep. The arc is the DM's secret spine: it is
// generated once at campaign activation (for every campaign, whether or not
// AI story setup wrote the premise) and refreshed with a small clamped delta
// at each chapter close. Every failure path is a silent no-op: the campaign
// falls back to dm_outline (or nothing) and generation retries at the next
// chapter close.

function worldContext(campaignId: string): string {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return "";
  }
  const preset = genrePreset(campaign.gameSettings.genre);
  const party = listSheets(campaignId)
    .map(
      (sheet) =>
        `- ${sheet.name}: level ${sheet.level} ${sheet.race} ${sheet.class}${sheet.subclass ? ` (${sheet.subclass})` : ""}, background ${sheet.background || "unknown"}`,
    )
    .join("\n");
  return [
    `Difficulty: ${campaign.difficulty}.`,
    party ? `Party:\n${party}` : "",
    campaign.theme ? `World/theme set by the table: ${campaign.theme}` : "",
    campaign.description ? `Premise: ${campaign.description}` : "",
    campaign.gameSettings.genre === "custom"
      ? campaign.gameSettings.customGenreText
      : `Genre: ${preset.name}. ${preset.dmFlavor} ${preset.nameHints}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const GENERATE_SYSTEM =
  'You sketch the secret story arc an AI Dungeon Master will steer a D&D 5e campaign by. It is a loose guideline of events to keep the story moving, not a script, so keep it brief and answer quickly. Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"premise": string, "stakes": string, "antagonist": string, "beats": string[], "finale": string, "subArcs": [{"name": string, "goal": string, "hook": string}]}. beats: 4 to 6 ordered main-story beats escalating to the finale, one short sentence each. subArcs: 2 to 3 opening quest- or dungeon-scale threads; name and goal are player-safe and may appear in a quest log, hook is a DM-only secret tying the quest to the main story. Every string under 140 characters. Stay consistent with any premise or outline you are given. Players never see this.';

// Runs on the campaign's DM queue at activation (after runStorySetup, so a
// freshly invented premise/outline is already in place) and from the lead's
// regenerate action.
export async function generateStoryArc(
  campaignId: string,
  opts?: { force?: boolean },
) {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign || (campaign.storyArc && !opts?.force)) {
      return;
    }
    setDmStatus(campaignId, "plotting_arc");
    const context = [
      worldContext(campaignId),
      campaign.dmOutline
        ? `The DM's existing secret outline; keep the arc consistent with it:\n${campaign.dmOutline}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: GENERATE_SYSTEM },
        { role: "user", content: context },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      if (process.env.DM_DEBUG) {
        const payload = await error
          .clone()
          .json()
          .catch(() => null);
        console.log("[dm-debug] arc generation: model call failed:", JSON.stringify(payload));
      }
      return;
    }
    const raw = typeof message?.content === "string" ? message.content : "";
    const arc = parseArcJson(raw);
    if (!arc) {
      if (process.env.DM_DEBUG) {
        console.log("[dm-debug] arc generation: unparseable reply:", raw.slice(0, 500));
      }
      return;
    }
    setStoryArc(campaignId, arc);
    setQuestLog(campaignId, activeQuestLines(arc));
  } catch (error) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] arc generation threw:", error);
    }
  } finally {
    setDmStatus(campaignId, "idle");
  }
}

const REFRESH_SYSTEM =
  'You maintain the AI DM\'s secret story arc between chapters of a D&D 5e campaign. Keep it brief and answer quickly. Compare the arc with what actually happened in the chapter that just closed and reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beatsDone": int[], "activeBeat": int|null, "subArcUpdates": [{"id": string, "status": "active"|"resolved"|"abandoned", "resolution": string}], "newSubArcs": [{"name": string, "goal": string, "hook": string}]}. Be conservative: mark a main beat done only if the chapter clearly accomplished it; never renumber or rewrite existing beats; add at most 2 new sub-arcs and only for genuinely new threads the story has opened; empty arrays are a correct answer when little changed. If the story has drifted from the arc, do not rewrite the arc; instead add or update a sub-arc that steers play back toward the current main beat.';

// Runs at chapter close, on the DM queue. Self-healing: a campaign that
// never got an arc (earlier failure, pre-feature campaign) generates one
// here instead.
export async function refreshStoryArc(
  campaignId: string,
  closedChapter: { index: number; title: string; summary: string; highlights: string[] },
) {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign) {
      return;
    }
    if (!campaign.storyArc) {
      await generateStoryArc(campaignId);
      return;
    }
    setDmStatus(campaignId, "plotting_arc");

    const chapterLines = [
      `Chapter ${closedChapter.index} just closed: "${closedChapter.title}"`,
      closedChapter.summary ? `Summary: ${closedChapter.summary}` : "",
      closedChapter.highlights.length
        ? `Highlights:\n${closedChapter.highlights.map((line) => `- ${line}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: REFRESH_SYSTEM },
        {
          role: "user",
          content: `Current arc:\n${renderArcForPrompt(campaign.storyArc)}\n\n${chapterLines}`,
        },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      if (process.env.DM_DEBUG) {
        console.log("[dm-debug] arc refresh: model call failed");
      }
      return;
    }
    const raw = typeof message?.content === "string" ? message.content : "";
    const delta = parseArcDeltaJson(raw);
    if (!delta) {
      if (process.env.DM_DEBUG) {
        console.log("[dm-debug] arc refresh: unparseable reply:", raw.slice(0, 500));
      }
      return;
    }
    const next = applyArcDelta(campaign.storyArc, delta);
    setStoryArc(campaignId, next);
    setQuestLog(campaignId, activeQuestLines(next));
  } catch (error) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] arc refresh threw:", error);
    }
  } finally {
    setDmStatus(campaignId, "idle");
  }
}
