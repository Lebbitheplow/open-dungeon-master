import { litTiles, type MapForVision } from "@/lib/battlemap/los";
import type { BattleToken, MapLight } from "@/lib/battlemap/types";

// The lit set of a board depends on nothing about who is looking: the
// terrain, its size, the map's fixed lights, and where the carried lights
// stand. buildPlayerMapView projects the same board once per member on
// every change, so the set is kept here and reused across those calls. The
// key is the content itself rather than a version stamp, since a token move
// updates battle_tokens and never touches the map row.
//
// The returned set is shared: callers read it and never write to it.

const CAPACITY = 32;

const cache = new Map<string, Set<number>>();

// FNV-1a over the terrain string: a few thousand chars, far cheaper than one
// field-of-view cast, and it keeps the key short.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export function litTilesKey(
  map: Pick<MapForVision, "terrain" | "width" | "height"> & { id: string },
  tokens: BattleToken[],
  lights: MapLight[],
): string {
  const carried = tokens
    .filter((token) => token.lightRadius > 0)
    .map((token) => `${token.x},${token.y},${token.lightRadius}`)
    .sort()
    .join(";");
  const fixed = lights
    .map((light) => `${light.x},${light.y},${light.brightRadius},${light.dimRadius}`)
    .join(";");
  return `${map.id}|${map.width}x${map.height}|${map.terrain.length}:${fnv1a(map.terrain)}|${fixed}|${carried}`;
}

export function cachedLitTiles(
  map: MapForVision & { id: string },
  tokens: BattleToken[],
  lights: MapLight[],
): Set<number> {
  const key = litTilesKey(map, tokens, lights);
  const hit = cache.get(key);
  if (hit) {
    // Most recent to the end, so the eviction below drops the stalest.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const lit = litTiles(map, tokens, lights);
  cache.set(key, lit);
  if (cache.size > CAPACITY) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  return lit;
}

// For tests and for anything that must see the next call recompute.
export function clearLitTilesCache(): void {
  cache.clear();
}

export function litTilesCacheSize(): number {
  return cache.size;
}
