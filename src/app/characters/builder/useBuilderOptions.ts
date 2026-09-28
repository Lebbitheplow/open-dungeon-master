"use client";

import { useEffect, useMemo, useState } from "react";
import { packRaceOptions } from "@/lib/content/race-options";
import {
  mergedBackgroundOptions,
  packClassOptions,
  srdBackgroundOptions,
  srdClassOptions,
  srdRaceOptions,
  type BackgroundOption,
  type ClassOption,
  type ContentRow,
  type RaceOption,
} from "@/lib/characters/options";
import type { WorldPack } from "@/lib/worlds/types";

// The option rows themselves are built in src/lib/characters/options.ts,
// which the server reads too; they are re-exported here because this is
// where the builder's modules have always found them.
export {
  mergedBackgroundOptions,
  srdBackgroundOptions,
  srdClassOptions,
  srdRaceOptions,
  type BackgroundOption,
  type ClassOption,
  type RaceOption,
};

// `desc` is the subclass write-up shown in the builder before a pick is made.
// For the authored subclasses it holds the whole level-by-level feature table
// with its rules text, built by insertAuthoredContent in
// scripts/import-open5e.mjs, so a new player can read what a circle or an
// oath actually does before committing to it.
export type ArchetypeOption = { id: string; name: string; desc: string };

// Loads race/class/background options from the Open5e content pack with the
// bundled SRD data as fallback (and as the shape contract). `keepRaceId` is
// the race of the character being edited, kept in the list even when the
// pack no longer offers it on its own (a bare Dwarf).
export function useBuilderOptions(keepRaceId?: string) {
  const [races, setRaces] = useState<RaceOption[]>(srdRaceOptions);
  const [classes, setClasses] = useState<ClassOption[]>(srdClassOptions);
  const [backgrounds, setBackgrounds] = useState<BackgroundOption[]>(srdBackgroundOptions);
  const [packInstalled, setPackInstalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [racesResponse, classesResponse, backgroundsResponse] = await Promise.all([
          fetch("/api/content/races?limit=200"),
          fetch("/api/content/classes?limit=100"),
          fetch("/api/content/backgrounds?limit=200"),
        ]);
        if (!racesResponse.ok || !classesResponse.ok || !backgroundsResponse.ok) {
          return;
        }
        const [racesData, classesData, backgroundsData] = await Promise.all([
          racesResponse.json(),
          classesResponse.json(),
          backgroundsResponse.json(),
        ]);
        if (cancelled || !racesData.packInstalled) {
          return;
        }
        setPackInstalled(true);
        const raceRows = (racesData.results ?? []) as ContentRow[];
        if (raceRows.length) {
          setRaces(packRaceOptions(raceRows, keepRaceId ? [keepRaceId] : []));
        }
        const classRows = (classesData.results ?? []) as ContentRow[];
        if (classRows.length) {
          setClasses(packClassOptions(classRows));
        }
        const backgroundRows = (backgroundsData.results ?? []) as ContentRow[];
        if (backgroundRows.length) {
          setBackgrounds(mergedBackgroundOptions(backgroundRows));
        }
      } catch {
        // SRD fallback already in state.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [keepRaceId]);

  return useMemo(
    () => ({ races, classes, backgrounds, packInstalled }),
    [races, classes, backgrounds, packInstalled],
  );
}

// The campaign's selected world pack, fetched whole so the builder can reskin
// display names. Null while loading, when there is no pack, and when the id no
// longer resolves, which is what keeps every caller's fallback path the same.
export function useWorldPack(packId?: string): WorldPack | null {
  const [pack, setPack] = useState<WorldPack | null>(null);
  const [prevId, setPrevId] = useState(packId);
  if (prevId !== packId) {
    setPrevId(packId);
    setPack(null);
  }
  useEffect(() => {
    let cancelled = false;
    if (!packId) {
      return;
    }
    fetch(`/api/worlds/${encodeURIComponent(packId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.pack) {
          setPack(data.pack as WorldPack);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [packId]);
  return pack;
}

export function useArchetypes(classId: string) {
  const [archetypes, setArchetypes] = useState<ArchetypeOption[]>([]);
  const [prevClassId, setPrevClassId] = useState(classId);
  if (prevClassId !== classId) {
    setPrevClassId(classId);
    setArchetypes([]);
  }
  useEffect(() => {
    let cancelled = false;
    if (!classId) {
      return;
    }
    fetch(`/api/content/archetypes?class=${encodeURIComponent(classId)}&limit=100`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.results) {
          setArchetypes(
            (data.results as ContentRow[]).map((row) => ({
              id: row.slug,
              name: row.name,
              desc: String(row.data?.desc ?? ""),
            })),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [classId]);
  return archetypes;
}
