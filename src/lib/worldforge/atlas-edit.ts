import { regionMapOf } from "@/lib/worldforge/atlas-frame";
import type { AtlasMap, Pin, Region, WorldDoc } from "@/lib/worldforge/model";

// Deleting from the Atlas, and taking a delete back (audit finding WF-20).
// Pure: the Atlas shows the impact before anything is deleted, and the
// server deletes and restores by the same rules (src/lib/db/atlas-edit.ts).
//
// A map takes its own pins with it. Pins elsewhere that opened it open
// nothing afterwards, and the maps drawn inside its pins move to the top of
// the tree (their parent pin is gone, and the tree reads a missing parent
// as none). Nothing else is rewritten, so putting the rows back puts the
// tree back: the nested maps still name the pins they were drawn in.

export type AtlasTarget = { kind: "map"; mapId: string } | { kind: "pin"; pinId: string } | { kind: "region"; mapId: string; regionId: string };

// What a delete took away, enough to put it back as it was.
export type Removed = {
  maps: AtlasMap[];
  pins: Pin[];
  regions: Array<{ mapId: string; index: number; region: Region }>;
  // Pins elsewhere that opened a deleted map.
  openers: Array<{ pinId: string; linkedMapId: string }>;
};

export type DeleteImpact = {
  kind: AtlasTarget["kind"];
  name: string;
  // Pins that go with a map.
  pins: number;
  // Pins on other maps that open this map, and will open nothing.
  openers: string[];
  // Maps drawn inside the deleted pins, which move to the top of the list.
  nested: string[];
  // Bound pins that go: their places stay where they are on the Region.
  bound: number;
  overRegion: boolean;
};

const pinName = (pin: Pin, names: Map<string, string>) => pin.name || names.get(pin.ref) || "an unnamed pin";

// The pins a target removes.
function pinsOf(doc: Pick<WorldDoc, "pins">, target: AtlasTarget): Pin[] {
  if (target.kind === "map") return doc.pins.filter((pin) => pin.mapId === target.mapId);
  if (target.kind === "pin") return doc.pins.filter((pin) => pin.id === target.pinId);
  return [];
}

export function deleteImpact(doc: Pick<WorldDoc, "maps" | "pins">, target: AtlasTarget, names: Map<string, string> = new Map()): DeleteImpact | null {
  const over = regionMapOf(doc);
  if (target.kind === "region") {
    const region = doc.maps.find((atlas) => atlas.id === target.mapId)?.regions.find((entry) => entry.id === target.regionId);
    return region ? { kind: "region", name: region.name, pins: 0, openers: [], nested: [], bound: 0, overRegion: false } : null;
  }
  const atlas = target.kind === "map" ? doc.maps.find((entry) => entry.id === target.mapId) : null;
  const pin = target.kind === "pin" ? doc.pins.find((entry) => entry.id === target.pinId) : null;
  if (!atlas && !pin) return null;
  const gone = pinsOf(doc, target);
  const goneIds = new Set(gone.map((entry) => entry.id));
  const nested = doc.maps.filter((entry) => entry.parentPinId && goneIds.has(entry.parentPinId) && entry.id !== atlas?.id).map((entry) => entry.name);
  const openers = atlas ? doc.pins.filter((entry) => entry.linkedMapId === atlas.id && entry.mapId !== atlas.id).map((entry) => pinName(entry, names)) : [];
  return {
    kind: target.kind,
    name: atlas ? atlas.name : pinName(pin!, names),
    pins: atlas ? gone.length : 0,
    openers,
    nested,
    bound: gone.filter((entry) => entry.regionLink && over && entry.mapId === over.id).length,
    overRegion: Boolean(atlas && atlas.role === "region"),
  };
}

export function removeFromDoc<D extends Pick<WorldDoc, "maps" | "pins">>(doc: D, target: AtlasTarget): { doc: D; removed: Removed } | null {
  if (target.kind === "region") {
    const atlas = doc.maps.find((entry) => entry.id === target.mapId);
    const index = atlas ? atlas.regions.findIndex((entry) => entry.id === target.regionId) : -1;
    if (!atlas || index < 0) return null;
    return {
      doc: { ...doc, maps: doc.maps.map((entry) => (entry.id === atlas.id ? { ...entry, regions: entry.regions.filter((region) => region.id !== target.regionId) } : entry)) },
      removed: { maps: [], pins: [], regions: [{ mapId: atlas.id, index, region: atlas.regions[index] }], openers: [] },
    };
  }
  const atlas = target.kind === "map" ? doc.maps.find((entry) => entry.id === target.mapId) : null;
  if (target.kind === "map" && !atlas) return null;
  const gone = pinsOf(doc, target);
  if (target.kind === "pin" && !gone.length) return null;
  const goneIds = new Set(gone.map((entry) => entry.id));
  const openers = atlas ? doc.pins.filter((entry) => entry.linkedMapId === atlas.id && !goneIds.has(entry.id)).map((entry) => ({ pinId: entry.id, linkedMapId: atlas.id })) : [];
  const opened = new Set(openers.map((entry) => entry.pinId));
  return {
    doc: {
      ...doc,
      maps: atlas ? doc.maps.filter((entry) => entry.id !== atlas.id) : doc.maps,
      pins: doc.pins.filter((entry) => !goneIds.has(entry.id)).map((entry) => (opened.has(entry.id) ? { ...entry, linkedMapId: "" } : entry)),
    },
    removed: { maps: atlas ? [atlas] : [], pins: gone, regions: [], openers },
  };
}

// The rows put back, as far as the world still has room for them: a row
// whose id is in use again stays out, a pin whose map is gone stays out,
// and a pin that opens another map since keeps it. Only one map stands
// over the Region: a restored map takes the role back only while no other
// map holds it.
export function restoreIntoDoc<D extends Pick<WorldDoc, "maps" | "pins">>(doc: D, removed: Removed): { doc: D; restored: number; skipped: string[] } {
  const skipped: string[] = [];
  let restored = 0;
  const mapIds = new Set(doc.maps.map((atlas) => atlas.id));
  let roleTaken = Boolean(regionMapOf(doc));
  const maps = [...doc.maps];
  for (const atlas of removed.maps) {
    if (mapIds.has(atlas.id)) {
      skipped.push(`The map ${atlas.name} is back already.`);
      continue;
    }
    const keepsRole = atlas.role === "region" && !roleTaken;
    if (atlas.role === "region" && !keepsRole) skipped.push(`${atlas.name} is back, but another map now stands over the Region, so it does not.`);
    const { role: _role, ...rest } = atlas;
    void _role;
    maps.push(keepsRole ? { ...rest, role: "region" } : rest);
    if (keepsRole) roleTaken = true;
    mapIds.add(atlas.id);
    restored += 1;
  }
  const pinIds = new Set(doc.pins.map((pin) => pin.id));
  const pins = [...doc.pins];
  for (const pin of removed.pins) {
    if (pinIds.has(pin.id)) continue;
    if (!mapIds.has(pin.mapId)) {
      skipped.push(`A pin could not come back: its map is gone.`);
      continue;
    }
    pins.push(pin);
    pinIds.add(pin.id);
    restored += 1;
  }
  for (const { mapId, index, region } of removed.regions) {
    const at = maps.findIndex((atlas) => atlas.id === mapId);
    if (at < 0) {
      skipped.push(`The region ${region.name} could not come back: its map is gone.`);
      continue;
    }
    if (maps[at].regions.some((entry) => entry.id === region.id)) continue;
    const regions = [...maps[at].regions];
    regions.splice(Math.min(Math.max(0, index), regions.length), 0, region);
    maps[at] = { ...maps[at], regions };
    restored += 1;
  }
  const opens = new Map(removed.openers.map((entry) => [entry.pinId, entry.linkedMapId]));
  const relinked = pins.map((pin) => {
    const target = opens.get(pin.id);
    return target && !pin.linkedMapId && mapIds.has(target) ? { ...pin, linkedMapId: target } : pin;
  });
  return { doc: { ...doc, maps, pins: relinked }, restored, skipped };
}
