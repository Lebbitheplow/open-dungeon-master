"use client";

import { registerBrowserSubclassExtras, subclassLevelFor } from "@/lib/srd/features";
import { extraSubclassOf } from "@/lib/srd/subclass-tables";
import { useEffect, useMemo, useState } from "react";
import { scopeQuery, useContentCampaign } from "@/lib/content-scope";
import { packRaceOptions } from "@/lib/content/race-options";
import { registerBrowserSpecies } from "@/lib/srd/race-id";
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
//
// At a table (src/lib/content-scope.tsx) the table's workshop species and
// backgrounds come with them. Without the content pack those still arrive,
// beside the bundled SRD options; `packInstalled` says which it was.
export function useBuilderOptions(keepRaceId?: string) {
  const campaignId = useContentCampaign();
  const [races, setRaces] = useState<RaceOption[]>(srdRaceOptions);
  const [classes, setClasses] = useState<ClassOption[]>(srdClassOptions);
  const [backgrounds, setBackgrounds] = useState<BackgroundOption[]>(srdBackgroundOptions);
  const [packInstalled, setPackInstalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [racesResponse, classesResponse, backgroundsResponse] = await Promise.all([
          fetch(`/api/content/races?limit=200${scopeQuery(campaignId, "&")}`),
          fetch(`/api/content/classes?limit=100${scopeQuery(campaignId, "&")}`),
          fetch(`/api/content/backgrounds?limit=200${scopeQuery(campaignId, "&")}`),
        ]);
        if (!racesResponse.ok || !classesResponse.ok || !backgroundsResponse.ok) {
          return;
        }
        const [racesData, classesData, backgroundsData] = await Promise.all([
          racesResponse.json(),
          classesResponse.json(),
          backgroundsResponse.json(),
        ]);
        if (cancelled) {
          return;
        }
        const installed = racesData.packInstalled !== false;
        setPackInstalled(installed);
        const raceRows = (racesData.results ?? []) as ContentRow[];
        if (raceRows.length) {
          const packed = packRaceOptions(raceRows, keepRaceId ? [keepRaceId] : []);
          // No pack: the rows are the table's workshop species, offered
          // beside the bundled SRD races rather than in their place.
          const options = installed
            ? packed
            : [...srdRaceOptions().filter((option) => !packed.some((entry) => entry.id === option.id)), ...packed];
          // Size, Dwarven Toughness and the rest read a pack or workshop
          // species by id, here as on the server.
          registerBrowserSpecies(
            Object.fromEntries(options.map((option) => [option.id, { size: option.size, heavyArmorSpeed: option.heavyArmorSpeed, traitNames: option.traitNames }])),
          );
          setRaces(options);
        }
        const classRows = (classesData.results ?? []) as ContentRow[];
        if (classRows.length && installed) {
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
  }, [keepRaceId, campaignId]);

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
  const campaignId = useContentCampaign();
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
    fetch(`/api/content/archetypes?class=${encodeURIComponent(classId)}&limit=100${scopeQuery(campaignId, "&")}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.results) {
          const rows = data.results as ContentRow[];
          // A workshop or pack subclass's features, for the grants the
          // builder previews (src/lib/srd/subclass-tables.ts).
          registerBrowserSubclassExtras(
            classId,
            rows
              .map((row) =>
                extraSubclassOf(
                  { name: row.name, source: String((row as { source?: string }).source ?? "open5e"), data: (row.data ?? {}) as Record<string, unknown> },
                  subclassLevelFor(classId) ?? 3,
                ),
              )
              .filter((table): table is NonNullable<typeof table> => table !== null),
          );
          setArchetypes(
            rows.map((row) => ({
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
  }, [classId, campaignId]);
  return archetypes;
}
