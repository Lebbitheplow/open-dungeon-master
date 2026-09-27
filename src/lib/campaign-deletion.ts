import fs from "node:fs";
import path from "node:path";
import { deleteCampaign } from "@/lib/db/campaigns";
import { campaignFilePaths, removeUnreferencedFiles } from "@/lib/image-files";

// Deleting a campaign for good: the rows (deleteCampaign, whose cascades
// take everything keyed to the campaign) and then the files only it used,
// which no cascade reaches. The files are read before the rows go and
// removed after, so a picture a clone or a library character still shows
// stays (src/lib/image-files.ts).
//
// Left on purpose: agent_activity (the capped log of what agents did),
// notifications (the user's inbox; campaign_id is a click-through hint) and
// content_reports (moderation outlives the table).

export function removeCampaignAudio(campaignId: string) {
  // The narration cache, one folder per campaign (src/lib/tts.ts).
  try {
    fs.rmSync(path.join(process.cwd(), "public", "generated-audio", campaignId), {
      recursive: true,
      force: true,
    });
  } catch (error) {
    console.error(`[campaign-deletion] could not remove the narration of ${campaignId}`, error);
  }
}

export function deleteCampaignWithFiles(campaignId: string) {
  const files = campaignFilePaths(campaignId);
  deleteCampaign(campaignId);
  removeUnreferencedFiles(files);
  removeCampaignAudio(campaignId);
}
