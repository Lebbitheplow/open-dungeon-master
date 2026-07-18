import { generateComfyImage } from "@/lib/comfyui";
import { getLocation, setLocationMap } from "@/lib/db/locations";
import { genrePreset } from "@/lib/genres";
import { publishPersisted } from "@/lib/events";
import { enqueueMediaJob } from "@/lib/media-queue";
import type { Campaign } from "@/lib/db/campaigns";

// Renders a top-down illustrated map of a location on the serial media
// queue (never blocks narration; one GPU job at a time machine-wide).
export function enqueueLocationMap(campaign: Campaign, locationId: string) {
  const preset = genrePreset(campaign.gameSettings.genre);
  return enqueueMediaJob(`map ${locationId}`, async () => {
    const location = getLocation(locationId);
    if (!location) {
      return;
    }
    const prompt = [
      "top-down illustrated game map",
      preset.mapStyle,
      "labeled areas, clear pathways, no text captions",
      location.name,
      location.layoutDescription,
    ]
      .filter(Boolean)
      .join(", ");
    const image = await generateComfyImage({
      url: campaign.settings.comfyUrl || undefined,
      checkpoint: campaign.settings.comfyCheckpoint || undefined,
      prompt,
      mode: campaign.settings.imageMode,
      aspect: "landscape",
    });
    if (!setLocationMap(location.id, image)) {
      return;
    }
    publishPersisted(campaign.id, "location_map_ready", {
      locationId: location.id,
      image,
    });
  });
}
