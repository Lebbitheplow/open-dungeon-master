"use client";

import { registerBrowserSubclassExtras, subclassLevelFor } from "@/lib/srd/features";
import { extraSubclassOf } from "@/lib/srd/subclass-tables";
import { useCallback, useEffect, useMemo, useState } from "react";
import { scopeQuery, useContentCampaign } from "@/lib/content-scope";
import { packRaceOptions } from "@/lib/content/race-options";
import { registerBrowserSpecies } from "@/lib/srd/race-id";
import {
  mergedBackgroundOptions,
  packClassOptions,
  srdBackgroundOptions,
  srdClassOptions,
  srdRaceOptions,
  workshopClassesOf,
  type BackgroundOption,
  type ClassOption,
  type ContentRow,
  type RaceOption,
} from "@/lib/characters/options";
import type { WorldPack } from "@/lib/worlds/types";
import { registerWorkshopClasses } from "@/lib/classes/workshop-registry";
import { isWorkshopClassId } from "@/lib/homebrew/class-data";

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
// `workshop`: a subclass from the table's (or your own) workshop, with its
// features listed by level; the rest are the content pack's.
export type ArchetypeOption = { id: string; name: string; desc: string; workshop?: boolean; features?: string };

// Loads race/class/background options from the Open5e content pack with the
// bundled SRD data as fallback (and as the shape contract). `keepRaceId` is
// the race of the character being edited, kept in the list even when the
// pack no longer offers it on its own (a bare Dwarf).
//
// At a table (src/lib/content-scope.tsx) the table's workshop species and
// backgrounds come with them. Without the content pack those still arrive,
// beside the bundled SRD options; `packInstalled` says which it was.
// What a table leaves out of an option list, or could not load: the asker's
// own entries the table does not admit (src/lib/content/scope.ts), and the
// lists whose request failed, which stand on the bundled options meanwhile.
export type OptionListKind = "races" | "classes" | "backgrounds";
export type OptionStatus = { unadmitted: Record<OptionListKind, string[]>; failed: OptionListKind[]; retry: () => void };

const NO_UNADMITTED: Record<OptionListKind, string[]> = { races: [], classes: [], backgrounds: [] };

// Each list is asked for on its own: one that fails falls back to the
// bundled options alone, and says so, without taking the others with it.
export function useBuilderOptions(keepRaceId?: string) {
  const campaignId = useContentCampaign();
  const [races, setRaces] = useState<RaceOption[]>(srdRaceOptions);
  const [classes, setClasses] = useState<ClassOption[]>(srdClassOptions);
  const [backgrounds, setBackgrounds] = useState<BackgroundOption[]>(srdBackgroundOptions);
  const [packInstalled, setPackInstalled] = useState(false);
  // Whether the rows the server offers have arrived (or failed to): until
  // then the bundled lists stand in, and a stored pick missing from them
  // proves nothing.
  const [loaded, setLoaded] = useState(false);
  const [unadmitted, setUnadmitted] = useState<Record<OptionListKind, string[]>>(NO_UNADMITTED);
  const [failed, setFailed] = useState<OptionListKind[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function list(kind: OptionListKind, limit: number): Promise<{ results?: ContentRow[]; packInstalled?: boolean; unadmitted?: string[] }> {
      const response = await fetch(`/api/content/${kind}?limit=${limit}${scopeQuery(campaignId, "&")}`);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      return response.json();
    }
    async function load() {
      const [racesAnswer, classesAnswer, backgroundsAnswer] = await Promise.allSettled([list("races", 200), list("classes", 100), list("backgrounds", 200)]);
      if (cancelled) {
        return;
      }
      setFailed((["races", "classes", "backgrounds"] as const).filter((_, index) => [racesAnswer, classesAnswer, backgroundsAnswer][index].status === "rejected"));
      const value = <T,>(answer: PromiseSettledResult<T>) => (answer.status === "fulfilled" ? answer.value : null);
      const racesData = value(racesAnswer);
      const classesData = value(classesAnswer);
      const backgroundsData = value(backgroundsAnswer);
      setUnadmitted({
        races: Array.isArray(racesData?.unadmitted) ? racesData.unadmitted : [],
        classes: Array.isArray(classesData?.unadmitted) ? classesData.unadmitted : [],
        backgrounds: Array.isArray(backgroundsData?.unadmitted) ? backgroundsData.unadmitted : [],
      });
      // Whether the pack is installed, from whichever list answered.
      const installed = [racesData, classesData, backgroundsData].find((data) => data)?.packInstalled !== false;
      setPackInstalled(installed);
      const raceRows = (racesData?.results ?? []) as ContentRow[];
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
      const classRows = (classesData?.results ?? []) as ContentRow[];
      // The table's workshop classes, read by the builder's engines as on
      // the server (src/lib/classes/workshop-registry.ts), and offered with
      // or without a content pack.
      registerWorkshopClasses(workshopClassesOf(classRows));
      if (classRows.length && installed) {
        setClasses(packClassOptions(classRows));
      } else if (classRows.length) {
        setClasses([...srdClassOptions(), ...packClassOptions(classRows).filter((option) => isWorkshopClassId(option.id))]);
      }
      const backgroundRows = (backgroundsData?.results ?? []) as ContentRow[];
      if (backgroundRows.length) {
        setBackgrounds(mergedBackgroundOptions(backgroundRows));
      }
      setLoaded(true);
    }
    load().catch(() => {
      // Building the options themselves failed: the bundled ones stand.
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [keepRaceId, campaignId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return useMemo(
    () => ({ races, classes, backgrounds, packInstalled, loaded, status: { unadmitted, failed, retry } as OptionStatus }),
    [races, classes, backgrounds, packInstalled, loaded, unadmitted, failed, retry],
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

// A class's subclasses for the builder and the level-up dialog, with what the
// table leaves out (the asker's own subclasses of this class it does not
// admit) and whether the request failed, so the picker can say why a
// subclass is missing rather than leaving the list short.
export function useArchetypeOptions(classId: string): { archetypes: ArchetypeOption[]; unadmitted: string[]; failed: boolean; retry: () => void } {
  const campaignId = useContentCampaign();
  const [archetypes, setArchetypes] = useState<ArchetypeOption[]>([]);
  const [unadmitted, setUnadmitted] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [prevClassId, setPrevClassId] = useState(classId);
  if (prevClassId !== classId) {
    setPrevClassId(classId);
    setArchetypes([]);
    setUnadmitted([]);
    setFailed(false);
  }
  useEffect(() => {
    let cancelled = false;
    if (!classId) {
      return;
    }
    fetch(`/api/content/archetypes?class=${encodeURIComponent(classId)}&limit=100${scopeQuery(campaignId, "&")}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        if (cancelled) {
          return;
        }
        setFailed(false);
        setUnadmitted(Array.isArray(data?.unadmitted) ? data.unadmitted : []);
        const rows = (data?.results ?? []) as ContentRow[];
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
          rows.map((row) => {
            const workshop = String((row as { source?: string }).source ?? "") === "homebrew";
            const table = workshop
              ? extraSubclassOf({ name: row.name, source: "homebrew", data: (row.data ?? {}) as Record<string, unknown> })
              : null;
            return {
              id: row.slug,
              name: row.name,
              desc: String(row.data?.desc ?? ""),
              ...(workshop ? { workshop: true } : {}),
              ...(table
                ? {
                    features: Object.entries(table.levels)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([level, features]) => `Level ${level}: ${features.map((feature) => feature.n).join(", ")}`)
                      .join(". "),
                  }
                : {}),
            };
          }),
        );
      })
      .catch(() => {
        // The built-in subclasses still offer; the picker says the rest
        // could not be read.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, campaignId, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { archetypes, unadmitted, failed, retry };
}

export function useArchetypes(classId: string) {
  return useArchetypeOptions(classId).archetypes;
}
