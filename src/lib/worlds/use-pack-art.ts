"use client";

import { useEffect, useState } from "react";
import { packArtUrl, packCharacterArtKey, packArtKey, type PackArtKind } from "@/lib/worlds/art";
import type { WorldPack } from "@/lib/worlds/types";

// A campaign's world pack, fetched once per page and shared by every panel
// that wants to draw its art. The full pack is what /api/worlds/<id> serves
// (the character builder already downloads it); the cache is module-level so
// the party rail, the sheet dialog and the settings panel agree on one fetch.
//
// Ask with url(kind, ref) and get a URL or null: null means "draw the
// placeholder plate", so a pack with no picture for a goliath, or no pack at
// all, costs nothing and changes nothing.

const cache = new Map<string, Promise<WorldPack | null>>();

function fetchPack(packId: string): Promise<WorldPack | null> {
  let pending = cache.get(packId);
  if (!pending) {
    pending = fetch(`/api/worlds/${encodeURIComponent(packId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { pack?: WorldPack } | null) => payload?.pack ?? null)
      .catch(() => null);
    cache.set(packId, pending);
  }
  return pending;
}

// Installing or updating a pack makes the cached copy stale; the admin panel
// calls this after either.
export function forgetPackArt(packId?: string): void {
  if (packId) {
    cache.delete(packId);
  } else {
    cache.clear();
  }
}

export type PackArt = {
  pack: WorldPack | null;
  // A picture for one of the pack's entries, by kind and the entry's id, slug
  // or name, or null when the pack carries none.
  url: (kind: PackArtKind, ref?: string) => string | null;
  // The picture a character's class or race resolves to, class first.
  characterUrl: (look: { race?: string | null; class?: string | null }) => string | null;
};

const NONE: PackArt = { pack: null, url: () => null, characterUrl: () => null };

export function usePackArt(packId: string | null | undefined): PackArt {
  const [pack, setPack] = useState<WorldPack | null>(null);

  // No reset on a cleared id: the id check below already answers NONE for a
  // pack that is not the one asked for, so the stale copy is harmless and
  // becomes the cache hit when the same pack is picked again.
  useEffect(() => {
    if (!packId) {
      return;
    }
    let cancelled = false;
    void fetchPack(packId).then((loaded) => {
      if (!cancelled) {
        setPack(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [packId]);

  if (!pack || pack.id !== packId) {
    return NONE;
  }
  const keys = pack.artKeys;
  return {
    pack,
    url: (kind, ref = "") => {
      const key = packArtKey(kind, ref);
      return key && keys.includes(key) ? packArtUrl(pack.id, key, pack.version) : null;
    },
    characterUrl: (look) => {
      const key = packCharacterArtKey(keys, look);
      return key ? packArtUrl(pack.id, key, pack.version) : null;
    },
  };
}
