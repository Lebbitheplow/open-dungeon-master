import { generateStoryImage } from "@/lib/image-generate";
import { getLocation, setLocationMap } from "@/lib/db/locations";
import { presetFor } from "@/lib/worlds/preset";
import { publishPersisted } from "@/lib/events";
import { pictureFailureReason, publishMediaStatus } from "@/lib/dm/images";
import { enqueueMediaJob } from "@/lib/media-queue";
import { toEnglishForImage } from "@/lib/image-english";
import type { Campaign } from "@/lib/db/campaigns";

// Renders a top-down illustrated map of a location on the serial media
// queue (never blocks narration; one GPU job at a time machine-wide).
export function enqueueLocationMap(campaign: Campaign, locationId: string) {
  const preset = presetFor(campaign.gameSettings);
  publishMediaStatus(campaign.id, "map", locationId, "queued");
  return enqueueMediaJob(`map ${locationId}`, async () => {
    const location = getLocation(locationId);
    if (!location) {
      return;
    }
    publishMediaStatus(campaign.id, "map", locationId, "generating");
    try {
      const place = await toEnglishForImage(campaign, {
        name: location.name,
        layout: location.layoutDescription,
      });
      const prompt = [
        "top-down illustrated game map",
        preset.mapStyle,
        "labeled areas, clear pathways, no text captions",
        place.name,
        place.layout,
      ]
        .filter(Boolean)
        .join(", ");
      const image = await generateStoryImage(campaign.settings, {
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
    } catch (error) {
      publishMediaStatus(campaign.id, "map", locationId, "failed", pictureFailureReason(error));
      throw error;
    }
  });
}
