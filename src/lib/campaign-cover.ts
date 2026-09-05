import { generateStoryImage } from "@/lib/image-generate";
import type { Campaign } from "@/lib/db/campaigns";
import { setCampaignCover } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";
import { enqueueMediaJob } from "@/lib/media-queue";
import { copyIntoUploads, whenImagesAvailable } from "@/lib/portrait";
import { presetFor } from "@/lib/worlds/preset";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";

// One-shot cover render for a campaign, the same shape as a character
// portrait (src/lib/portrait.ts): status lives in memory only, so a restart
// mid-job drops the entry and the tile falls back to the placeholder while
// the durable truth stays derivable from campaign.cover. On globalThis so
// dev-mode HMR cannot fork the map.

export type CoverState = "queued" | "generating" | "failed";

declare global {
  var __odmCoverStatus: Map<string, CoverState> | undefined;
}

function statusMap(): Map<string, CoverState> {
  globalThis.__odmCoverStatus ??= new Map();
  return globalThis.__odmCoverStatus;
}

export function coverStatus(campaignId: string): CoverState | null {
  return statusMap().get(campaignId) ?? null;
}

export type CoverPromptInput = {
  title: string;
  description: string;
  theme: string;
  genre: string;
  worldPack?: string;
};

// Deterministic prompt from the campaign's own words. The title is given as
// a subject cue rather than as text to paint: image models that are handed a
// title tend to letter it across the picture, and a cover with a garbled
// banner is worse than one with none. The world's portrait style is what
// makes the render match the companions and NPCs painted for the same table.
export function buildCoverPrompt(input: CoverPromptInput): string {
  const preset = presetFor({ genre: input.genre, worldPack: input.worldPack });
  const parts = [
    "Tabletop RPG campaign cover art, wide establishing scene, cinematic composition",
    input.title.trim() ? `Evoking a campaign called "${input.title.trim()}"` : "",
    preset.portraitStyle,
    input.theme.trim(),
    input.description.trim().slice(0, 300),
    "Detailed digital painting, dramatic lighting, no text, no letters, no title, no border",
  ];
  return parts.filter(Boolean).join(". ");
}

// Fire-and-forget from the cover route: renders on the serial media queue
// (one iGPU shared with the DM model), copies the result into public/uploads
// so the stored path is one /api/upload could have written, then tells every
// open table through campaign_updated, whose payload merges straight into the
// client's campaign (useCampaignStream.ts).
export function queueCampaignCover(
  campaign: Pick<Campaign, "id" | "title" | "description" | "theme" | "gameSettings">,
): void {
  const map = statusMap();
  const prompt = buildCoverPrompt({
    title: campaign.title,
    description: campaign.description,
    theme: campaign.theme,
    genre: campaign.gameSettings.genre,
    worldPack: campaign.gameSettings.worldPack,
  });
  void whenImagesAvailable(() => {
    map.set(campaign.id, "queued");
    return enqueueMediaJob(`cover ${campaign.id}`, async () => {
      map.set(campaign.id, "generating");
      try {
        const settings = configuredDefaultStorySettings();
        const image = await generateStoryImage(settings, {
          prompt,
          mode: "fast",
          aspect: "landscape",
        });
        const cover = copyIntoUploads(image.url);
        if (setCampaignCover(campaign.id, cover)) {
          publishPersisted(campaign.id, "campaign_updated", { cover });
        }
        map.delete(campaign.id);
      } catch (error) {
        map.set(campaign.id, "failed");
        console.error(`[cover] generation failed for ${campaign.id}:`, error);
      }
    });
  });
}
