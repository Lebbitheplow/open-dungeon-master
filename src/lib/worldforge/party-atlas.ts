import { frameOf } from "@/lib/worldforge/atlas-frame";
import type { AtlasMap, MapFrame, WorldDoc, XY } from "@/lib/worldforge/model";

// The party's Atlas (the plan's M3 item 4, held for M4's map work): the
// maps the DM has shown, as the players may see them. Pure, so the DM's
// review and the players' route say the same thing.
//
// The policy, stated once:
//   - A map is the DM's alone until the DM shows it (`party: "shown"`),
//     through a reviewed step. The editor's saves may hide a map but never
//     show one (keepPartyFields).
//   - On a shown map every pin and region shows, unless the DM hid it.
//   - A player never receives notes, the entry a pin or region stands for,
//     a Region binding, or a battle-map link. A pin carries a label and, when
//     it opens another shown map, that map's id.
//   - A pin's label is its own name, else the name of what it stands for
//     when that reader may already know it (labelOf decides: a place, whose
//     name the Region shows everyone, or lore that reader may open), else
//     nothing.
//   - A map nested in a pin names that pin only while the pin is shown.
//
// Who may read the picture itself is the media rule's (src/lib/media-access.ts):
// every member of the campaign that names it.

export type PartyPin = { id: string; x: number; y: number; label: string; opens: string | null };
export type PartyRegion = { id: string; name: string; points: XY[]; color: string };
export type PartyMap = { id: string; name: string; image: string; frame: MapFrame; parentPinId: string | null; pins: PartyPin[]; regions: PartyRegion[] };
export type PartyAtlas = { maps: PartyMap[] };

export const isShown = (atlas: Pick<AtlasMap, "party">) => atlas.party === "shown";

export function partyAtlas(doc: Pick<WorldDoc, "maps" | "pins">, labelOf: (ref: string) => string, extraShown: ReadonlySet<string> = new Set()): PartyAtlas {
  const shown = new Set(doc.maps.filter((atlas) => isShown(atlas) || extraShown.has(atlas.id)).map((atlas) => atlas.id));
  const visiblePins = new Map(doc.pins.filter((pin) => shown.has(pin.mapId) && !pin.hidden).map((pin) => [pin.id, pin]));
  return {
    maps: doc.maps
      .filter((atlas) => shown.has(atlas.id))
      .map((atlas) => ({
        id: atlas.id,
        name: atlas.name,
        image: atlas.image,
        frame: frameOf(atlas),
        parentPinId: atlas.parentPinId && visiblePins.has(atlas.parentPinId) ? atlas.parentPinId : null,
        pins: [...visiblePins.values()]
          .filter((pin) => pin.mapId === atlas.id)
          .map((pin) => ({ id: pin.id, x: pin.x, y: pin.y, label: pin.name || (pin.ref ? labelOf(pin.ref) : ""), opens: pin.linkedMapId && shown.has(pin.linkedMapId) ? pin.linkedMapId : null })),
        regions: atlas.regions.filter((region) => !region.hidden).map((region) => ({ id: region.id, name: region.name, points: region.points, color: region.color })),
      })),
  };
}

// The editor's saves may hide a map from the party, never show one: a map
// that was not shown before a save is not shown after it, whatever the save
// sent. Pins and regions take `hidden` freely, since hiding is always safe
// and showing one only matters on a map the DM already chose to show.
export function keepPartyFields(before: Pick<WorldDoc, "maps">, after: WorldDoc): WorldDoc {
  const was = new Set(before.maps.filter(isShown).map((atlas) => atlas.id));
  return {
    ...after,
    maps: after.maps.map((atlas) => {
      if (!isShown(atlas) || was.has(atlas.id)) return atlas;
      const { party: _party, ...rest } = atlas;
      void _party;
      return rest;
    }),
  };
}
