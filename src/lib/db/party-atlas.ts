import type { Failure } from "@/lib/db/atlas-region";
import { publishEphemeral } from "@/lib/events";
import { listLocations } from "@/lib/db/locations";
import { listLoreEntries } from "@/lib/db/lore";
import { getWorldDoc, saveWorldDoc } from "@/lib/db/world-forge";
import { loreReadableBy } from "@/lib/dm/world-lore-logic";
import { parseRef, type WorldDoc } from "@/lib/worldforge/model";
import { isShown, partyAtlas, type PartyAtlas, type PartyMap } from "@/lib/worldforge/party-atlas";

// The party's Atlas on the server (src/lib/worldforge/party-atlas.ts holds
// the policy): the projection a member reads, and the step that shows a map
// to the party after a review of exactly what they will see.

// A pin's fallback label for one reader: a place's name (the Region already
// shows every place to every member), or a lore entry's title when this
// reader may open it. Cast members and factions are never named this way.
function labeller(campaignId: string, userId: string | null, steers: boolean): (ref: string) => string {
  const places = new Map(listLocations(campaignId).map((location) => [location.id, location.name]));
  const lore = new Map(
    listLoreEntries(campaignId)
      .filter((entry) => loreReadableBy(entry, steers, userId))
      .map((entry) => [entry.id, entry.title]),
  );
  return (ref) => {
    const parsed = parseRef(ref);
    if (parsed?.shelf === "location") return places.get(parsed.id) ?? "";
    if (parsed?.shelf === "lore") return lore.get(parsed.id) ?? "";
    return "";
  };
}

// What this member sees. Whoever runs the story reads the same projection,
// as the party sees it, never the DM's own fields.
export function partyAtlasFor(campaignId: string, userId: string, steers: boolean): PartyAtlas {
  return partyAtlas(getWorldDoc(campaignId), labeller(campaignId, steers ? null : userId, false));
}

export type ShowPlan = {
  map: { id: string; name: string };
  // The map as an ordinary player would see it, labels included.
  seen: PartyMap;
  hiddenPins: number;
  hiddenRegions: number;
  // Shown pins with no name of their own and nothing a player may know them
  // by: they appear as unlabelled markers.
  unlabelled: number;
  notes: string[];
  applied: boolean;
};

export function showToParty(campaignId: string, mapId: string, apply: boolean): ShowPlan | Failure {
  const doc = getWorldDoc(campaignId);
  const atlas = doc.maps.find((entry) => entry.id === mapId);
  if (!atlas) return { error: "That map is not in this world.", status: 404 };
  // An ordinary player: one with no lore written for them by name.
  const seen = partyAtlas(doc, labeller(campaignId, null, false), new Set([mapId])).maps.find((entry) => entry.id === mapId)!;
  const pins = doc.pins.filter((pin) => pin.mapId === mapId);
  const plan: ShowPlan = {
    map: { id: atlas.id, name: atlas.name },
    seen,
    hiddenPins: pins.filter((pin) => pin.hidden).length,
    hiddenRegions: atlas.regions.filter((region) => region.hidden).length,
    unlabelled: seen.pins.filter((pin) => !pin.label).length,
    notes: [
      "Players see the picture, the pins and regions listed here and their names. They never see notes, what a pin stands for, or anything you hid.",
      ...(atlas.image ? [] : ["This map has no picture: players see its pins on a blank ground."]),
    ],
    applied: false,
  };
  if (!apply || isShown(atlas)) return { ...plan, applied: apply && isShown(atlas) };
  saveWorldDoc(campaignId, { ...doc, maps: doc.maps.map((entry) => (entry.id === mapId ? { ...entry, party: "shown" as const } : entry)) });
  return { ...plan, applied: true };
}

// After a change to the world: tells every seat when what the party sees
// changed, and only then (positions, names, what is shown or hidden). Labels
// are compared by the pins' own names, so a renamed place shows on the
// next read rather than through this.
export function partyAtlasChanged(campaignId: string, before: Pick<WorldDoc, "maps" | "pins">) {
  const plain = () => "";
  if (JSON.stringify(partyAtlas(before, plain)) !== JSON.stringify(partyAtlas(getWorldDoc(campaignId), plain))) {
    publishEphemeral(campaignId, "party_atlas_updated", { at: Date.now() });
  }
}

// Hiding needs no review: the map leaves the party's Atlas, and nothing
// else changes.
export function hideFromParty(campaignId: string, mapId: string): { hidden: boolean } | Failure {
  const doc = getWorldDoc(campaignId);
  const atlas = doc.maps.find((entry) => entry.id === mapId);
  if (!atlas) return { error: "That map is not in this world.", status: 404 };
  if (!isShown(atlas)) return { hidden: false };
  saveWorldDoc(campaignId, {
    ...doc,
    maps: doc.maps.map((entry) => {
      if (entry.id !== mapId) return entry;
      const { party: _party, ...rest } = entry;
      void _party;
      return rest;
    }),
  });
  return { hidden: true };
}
