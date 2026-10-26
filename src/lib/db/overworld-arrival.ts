import { listLocations } from "@/lib/db/locations";
import { getOverworld, setOverworldAnchor } from "@/lib/db/overworld";
import { placeAnchor, type XY } from "@/lib/overworld/logic";
import {
  drawnAnchors,
  placeTree,
  spotFrom,
  type PlaceDirection,
  type PlaceDistance,
} from "@/lib/overworld/places";

// A place of its own the party just reached for the first time, put where
// the story says it is (issue 548): `direction` and `distance` from the
// place they set out from (the place of its own that one is part of).
// Without either, it lands the old way, but near where they came from rather
// than near whichever of its routes happens to be listed first. Only
// `newIds`, the places this arrival created, ever move: a place already on
// the map stays where the DM, an import or an earlier arrival put it.
export function placeArrival(
  campaignId: string,
  input: {
    locationId: string;
    fromId: string | null;
    newIds: string[];
    direction?: PlaceDirection | null;
    distance?: PlaceDistance | null;
  },
): XY | null {
  // Read first, so the new place already has the spot reconciling gave it,
  // which is the anchor moved below.
  const map = getOverworld(campaignId);
  const locations = listLocations(campaignId);
  const tree = placeTree(locations);
  const place = tree.topOf(input.locationId);
  const from = input.fromId ? tree.topOf(input.fromId) : null;
  const origin = from ? map.anchors[from] : null;
  const location = locations.find((entry) => entry.id === place);
  if (!location || !input.newIds.includes(place) || !from || from === place || !origin || !map.anchors[place]) {
    return null;
  }
  // A place made now as the parent of parts the table has already seen on
  // the map keeps the spot they stood on (reconcileAnchors gave it that).
  if (tree.descendantsOf(place).some((id) => map.anchors[id] && !input.newIds.includes(id))) {
    return null;
  }
  const said = Boolean(input.direction || input.distance);
  const at = placeAnchor({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    existing: drawnAnchors(map.anchors, tree, place),
    connected: said ? null : origin,
    name: location.name,
    target: said ? spotFrom(origin, { direction: input.direction, distance: input.distance }, location.name) : null,
  });
  setOverworldAnchor(campaignId, place, at);
  return at;
}
