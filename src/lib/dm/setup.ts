import {
  getCampaignById,
  setCampaignScene,
  setDmOutline,
} from "@/lib/db/campaigns";
import { getDatabase, nowIso } from "@/lib/db/core";
import { listSheets } from "@/lib/db/sheets";
import { genrePreset } from "@/lib/genres";
import { publishPersisted } from "@/lib/events";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { requestDmMessage } from "@/lib/dm/model";

// Pre-session story setup: one model call that invents a premise, opening
// scene, and a SECRET outline the DM steers by. Runs on the campaign's DM
// queue right before the kickoff narration.
export async function runStorySetup(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || !campaign.gameSettings.aiStorySetup || campaign.dmOutline) {
    return;
  }
  const preset = genrePreset(campaign.gameSettings.genre);
  const sheets = listSheets(campaignId);
  const party = sheets
    .map((sheet) => `- ${sheet.name}: level ${sheet.level} ${sheet.race} ${sheet.class}${sheet.subclass ? ` (${sheet.subclass})` : ""}, background ${sheet.background || "unknown"}`)
    .join("\n");

  const worldHints = [
    campaign.theme ? `World/theme set by the table: ${campaign.theme}` : "",
    campaign.description ? `Table's own premise notes: ${campaign.description}` : "",
    campaign.gameSettings.genre === "custom"
      ? campaign.gameSettings.customGenreText
      : `Genre: ${preset.name}. ${preset.dmFlavor} ${preset.nameHints}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      {
        role: "system",
        content:
          "You design the seed of a D&D 5e campaign. Reply with ONLY a JSON object, no code fences, shaped exactly: {\"premise\": string, \"openingScene\": string, \"secretOutline\": string}. premise: 2-3 sentences the players will read. openingScene: one sentence naming where the story opens. secretOutline: 6-10 numbered beats for the DM only, with a central antagonist, two twists, and a finale; players never see this.",
      },
      {
        role: "user",
        content: `Difficulty: ${campaign.difficulty}. Party:\n${party}\n\n${worldHints}`,
      },
    ],
    {},
  );

  if (error) {
    if (process.env.DM_DEBUG) {
      const payload = await error
        .clone()
        .json()
        .catch(() => null);
      console.log("[dm-debug] story setup: model call failed:", JSON.stringify(payload));
    }
    return;
  }
  // Raw content, not extractStoryText: that helper reinterprets JSON-shaped
  // replies as the solo story schema and would swallow our setup JSON.
  const text = stripReasoningArtifacts(
    typeof message?.content === "string" ? message.content : "",
  ).trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let premise = "";
  let openingScene = "";
  let secretOutline = "";
  try {
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    premise = String(parsed.premise ?? "").trim();
    openingScene = String(parsed.openingScene ?? "").trim();
    secretOutline = String(parsed.secretOutline ?? "").trim();
  } catch {
    // Model ignored the shape; use the whole text as the secret outline.
    secretOutline = cleaned.slice(0, 6_000);
  }

  if (!secretOutline && !premise) {
    return;
  }
  if (premise && !campaign.description) {
    getDatabase()
      .prepare(`UPDATE campaigns SET description = ?, updated_at = ? WHERE id = ?`)
      .run(premise.slice(0, 500), nowIso(), campaignId);
  }
  if (openingScene) {
    setCampaignScene(campaignId, openingScene);
  }
  setDmOutline(campaignId, secretOutline);
  const updated = getCampaignById(campaignId);
  publishPersisted(campaignId, "campaign_updated", {
    description: updated?.description ?? premise,
    scene: openingScene,
  });
}
