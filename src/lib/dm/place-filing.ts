import { textKey } from "@/lib/language/text-logic";
import {
  fileUnderPlace,
  getLocation,
  listLocations,
  setLocationParent,
  type CampaignLocation,
} from "@/lib/db/locations";
import { placeNamedInside, placeTree, type PlaceDistance } from "@/lib/overworld/places";

// Where an area move_party just named sits among the region's places (issue
// 548), decided once:
// - partOf files it under that place, making the place if it is new. It
//   applies to a place made now or one nobody has filed yet, never over the
//   DM's own filing; and not when it names the place the party set out from
//   while the call also says the new place lies half a day or more away,
//   which is a region named as a place rather than a room of one.
// - A new place given a direction or distance and no partOf is a place of
//   its own: the model said where it lies.
// - A new place with neither files under a place whose whole name its own
//   opens with ("Hollowroot Vault Entrance" under "Hollowroot Vault"), the
//   way a model names a room when it forgets partOf.
// The note is for the model, said only when its partOf was not applied.
const FAR: ReadonlySet<PlaceDistance> = new Set(["half a day", "a day", "several days"]);

export function filePlace(
  campaignId: string,
  input: {
    locationId: string;
    isNew: boolean;
    partOf: string;
    setOutFrom: string | null;
    distance: PlaceDistance | null;
    hasBearing: boolean;
  },
): { location: CampaignLocation | null; parentMade: CampaignLocation | null; note: string } {
  const location = getLocation(input.locationId);
  if (!location) {
    return { location: null, parentMade: null, note: "" };
  }
  const places = listLocations(campaignId);
  if (input.partOf) {
    if (!input.isNew && location.parentName !== null && textKey(location.parentName) !== textKey(input.partOf)) {
      const where = location.parentName ? `part of ${location.parentName}` : "a place of its own";
      return { location, parentMade: null, note: ` partOf was not applied: ${location.name} is already ${where}.` };
    }
    const named = places.find((place) => textKey(place.name) === textKey(input.partOf));
    if (named && input.setOutFrom && input.distance && FAR.has(input.distance)) {
      const tree = placeTree(places);
      const start = tree.topOf(input.setOutFrom);
      if (start === tree.topOf(named.id)) {
        if (input.isNew) {
          setLocationParent(campaignId, location.id, "");
        }
        const from = places.find((place) => place.id === start)?.name ?? named.name;
        return {
          location: getLocation(location.id),
          parentMade: null,
          note: ` partOf was not applied: the party set out from ${from}, and a place ${input.distance} away is a place of its own.`,
        };
      }
    }
    const filed = fileUnderPlace(campaignId, location.id, input.partOf);
    if ("error" in filed) {
      return { location, parentMade: null, note: ` partOf was not applied: ${filed.error}` };
    }
    return { location: filed.location, parentMade: filed.created ? filed.parent : null, note: "" };
  }
  // A new place with neither stays unfiled, which a later partOf may still
  // settle.
  if (input.isNew) {
    const inside = input.hasBearing
      ? null
      : placeNamedInside(location.name, places.filter((place) => place.id !== location.id));
    if (inside || input.hasBearing) {
      setLocationParent(campaignId, location.id, inside?.name ?? "");
      return { location: getLocation(location.id), parentMade: null, note: "" };
    }
  }
  return { location, parentMade: null, note: "" };
}
