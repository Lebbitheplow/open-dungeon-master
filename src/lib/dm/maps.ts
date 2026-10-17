import { generateStoryImage } from "@/lib/image-generate";
import { getLocation, setLocationMap, setLocationMapFailed, setLocationMapPending } from "@/lib/db/locations";
import { presetFor } from "@/lib/worlds/preset";
import { publishPersisted } from "@/lib/events";
import { pictureFailureReason, publishMediaStatus } from "@/lib/dm/images";
import { enqueueMediaJob } from "@/lib/media-queue";
import { toEnglishForImage } from "@/lib/image-english";
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { MAP_NEGATIVE, artDirection, locationMapPrompt, typedStyle } from "@/lib/art-direction";

// The place as stored, to every client: its map failure is part of the row.
function publishLocation(campaignId: string, locationId: string) {
  const location = getLocation(locationId);
  if (location) {
    publishPersisted(campaignId, "location_updated", { location });
  }
}

// Renders a top-down map of a location on the serial media
// queue (never blocks narration; one GPU job at a time machine-wide).
//
// A failure is recorded on the place as well as announced: the
// "Charting the area..." placeholder under the narration reads the place,
// so after a reload it would otherwise wait for a map that is not coming.
// So is the render being on its way, which is all that placeholder charts
// for; a restart that drops the queue turns it into the failure
// (src/lib/dm/restart-recovery.ts). Queuing a new render clears a failure.
export function enqueueLocationMap(campaign: Campaign, locationId: string) {
  if (setLocationMapPending(locationId)) {
    publishLocation(campaign.id, locationId);
  }
  publishMediaStatus(campaign.id, "map", locationId, "queued");
  return enqueueMediaJob(`map ${locationId}`, async () => {
    const location = getLocation(locationId);
    if (!location) {
      return;
    }
    publishMediaStatus(campaign.id, "map", locationId, "generating");
    try {
      // The campaign as it is now: a style picked since the map was queued
      // is the one a redraw asked for.
      const current = getCampaignById(campaign.id) ?? campaign;
      const look = artDirection(current.settings, presetFor(current.gameSettings));
      const typed = typedStyle(current.settings, "map");
      const place = await toEnglishForImage(campaign, {
        name: location.name,
        layout: location.layoutDescription,
        style: typed,
      });
      const prompt = locationMapPrompt(typed ? place.style : look.map, place);
      const image = await generateStoryImage(campaign.settings, {
        prompt,
        mode: campaign.settings.imageMode,
        aspect: "landscape",
        negative: MAP_NEGATIVE,
      });
      if (!setLocationMap(location.id, image)) {
        return;
      }
      publishPersisted(campaign.id, "location_map_ready", {
        locationId: location.id,
        image,
      });
    } catch (error) {
      const reason = pictureFailureReason(error);
      publishMediaStatus(campaign.id, "map", locationId, "failed", reason);
      if (setLocationMapFailed(locationId, reason)) {
        publishLocation(campaign.id, locationId);
      }
      throw error;
    }
  });
}
