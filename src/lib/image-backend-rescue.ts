// Campaigns stranded on a picture backend that cannot paint.
//
// A campaign freezes its picture backend when it is made (createCampaign
// copies configuredDefaultStorySettings()). A server set up before it had
// pictures, the common order with an agent program, made its campaigns on
// ComfyUI; switching the agent's pictures on later changed the default for
// NEW campaigns only, so every map and scene in the existing ones still went
// to a ComfyUI that was not there, while the admin's test picture, which
// never looks at a campaign, passed. And the campaign creator, seeing no
// picture backend at that moment, had made them with area maps off.
//
// The rescue moves exactly those campaigns: on a backend that cannot paint
// right now, to the server's default when the default CAN paint. A campaign
// on a backend that works is never moved, so a working ComfyUI table is not
// switched to a paid one behind its lead's back. A rescued campaign also gets
// its maps back on, since they were off only because nothing could draw them.
import { configValue } from "@/lib/app-config";
import { imagesProbeUrl, probeReachable } from "@/lib/capabilities";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { getDatabase } from "@/lib/db/core";
import { getCampaignById, updateGameSettings, updateStorySettings } from "@/lib/db/campaigns";
import { harnessImagesReady } from "@/lib/harness/images";
import { openAiImagesConfigured } from "@/lib/openai-images";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { serverEnv } from "@/lib/server-env";
import type { ImageBackend, StorySettings } from "@/lib/types";

export type CampaignPictures = {
  id: string;
  title: string;
  kind: "campaign" | "workshop";
  backend: ImageBackend;
  // The lead switched pictures off; nothing to rescue.
  picturesOn: boolean;
  mapsOn: boolean;
  canPaint: boolean;
};

export type RescueMove = { id: string; title: string; from: ImageBackend; mapsTurnedOn: boolean };

// Pure: which campaigns move, given whether each can paint and where to.
export function strandedMoves(campaigns: readonly CampaignPictures[], target: ImageBackend, targetCanPaint: boolean): RescueMove[] {
  if (!targetCanPaint) {
    return [];
  }
  return campaigns
    .filter((campaign) => campaign.picturesOn && campaign.backend !== target && !campaign.canPaint)
    .map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      from: campaign.backend,
      mapsTurnedOn: campaign.kind === "campaign" && !campaign.mapsOn,
    }));
}

// Whether a campaign's backend can make a picture right now. One probe per
// address, cached in the capability probe store for half a minute.
async function canPaint(settings: Pick<StorySettings, "imageBackend" | "comfyUrl" | "customBaseUrl" | "customApiKey">): Promise<boolean> {
  if (settings.imageBackend === "harness") {
    return harnessImagesReady();
  }
  if (settings.imageBackend === "openai") {
    return openAiImagesConfigured(settings);
  }
  const comfy = settings.comfyUrl || configValue(getGlobalConfig().images.comfyUrl, "COMFYUI_URL", "http://127.0.0.1:8188");
  const flux = serverEnv("FLUX_WORKER_URL", "http://127.0.0.1:7869");
  return probeReachable(imagesProbeUrl(settings.imageBackend, comfy, flux));
}

export async function campaignPictures(): Promise<CampaignPictures[]> {
  const ids = getDatabase().prepare(`SELECT id FROM campaigns ORDER BY updated_at DESC`).all() as Array<{ id: string }>;
  const out: CampaignPictures[] = [];
  for (const { id } of ids) {
    const campaign = getCampaignById(id);
    if (!campaign) {
      continue;
    }
    out.push({
      id,
      title: campaign.title,
      kind: campaign.kind === "workshop" ? "workshop" : "campaign",
      backend: campaign.settings.imageBackend,
      picturesOn: campaign.settings.imageGenerationEnabled,
      mapsOn: campaign.gameSettings.mapsEnabled,
      canPaint: await canPaint(campaign.settings),
    });
  }
  return out;
}

// Moves the stranded campaigns onto the server's default backend. Safe to
// run after any save that touches pictures: it moves nothing when the
// default cannot paint either, or when every campaign already can.
export async function rescueStrandedCampaigns(): Promise<RescueMove[]> {
  const defaults = configuredDefaultStorySettings();
  const target = defaults.imageBackend;
  const moves = strandedMoves(await campaignPictures(), target, await canPaint(defaults));
  for (const move of moves) {
    updateStorySettings(move.id, { imageBackend: target });
    if (move.mapsTurnedOn) {
      updateGameSettings(move.id, { mapsEnabled: true });
    }
  }
  return moves;
}
