"use client";

import { useEffect, useMemo, useState } from "react";
import {
  classMechanics,
  raceMechanics,
  type ClassMechanics,
  type RaceMechanics,
} from "@/lib/content/mechanics";
import { SRD_BACKGROUNDS, SRD_CLASSES, SRD_RACES } from "@/lib/srd";
import { CUSTOM_BACKGROUNDS } from "@/lib/backgrounds";
import { CUSTOM_CLASSES } from "@/lib/classes";
import type { Genre } from "@/lib/schemas/game-settings";
import { skillsInText } from "@/lib/content/mechanics";

export type RaceOption = { id: string; name: string; note: string } & RaceMechanics;
export type ClassOption = { id: string; name: string } & ClassMechanics & {
    // Catalog-only extras; absent on SRD and Open5e rows.
    genres?: Genre[];
    blurb?: string;
    knownCaster?: boolean;
    castingLabel?: string | null;
    spellListFrom?: string | null;
    // The content pack's write-up, shown under the class select.
    desc?: string;
    // Secret languages the class teaches (Druidic, Thieves' Cant).
    languages?: string[];
  };
export type BackgroundOption = {
  id: string;
  name: string;
  skills: string[];
  // Grants beyond skills. Open5e pack rows leave these undefined.
  tools?: string[];
  languages?: number;
  equipment?: string[];
  // Catalog-only extras; absent on SRD and Open5e rows.
  genres?: Genre[];
  blurb?: string;
  // The content pack's write-up, shown under the background select.
  desc?: string;
};
// `desc` is the subclass write-up shown in the builder before a pick is made.
// For the authored subclasses it holds the whole level-by-level feature table
// with its rules text, built by insertAuthoredContent in
// scripts/import-open5e.mjs, so a new player can read what a circle or an
// oath actually does before committing to it.
export type ArchetypeOption = { id: string; name: string; desc: string };

type ContentRow = {
  slug: string;
  name: string;
  source: string;
  data: Record<string, unknown>;
};

function srdRaceOptions(): RaceOption[] {
  return SRD_RACES.map((race) => ({
    id: race.id,
    name: race.name,
    speed: race.speed,
    asi: race.asi,
    languages: race.languages,
    bonusLanguages: race.bonusLanguages ?? 0,
    traitsSummary: race.traits.join(" · "),
    skills: race.skills,
    skillChoice: race.skillChoice,
    asiChoice: race.asiChoice,
    cantripChoice: race.cantripChoice,
    tools: race.tools,
    toolChoice: race.toolChoice,
    armor: race.armor,
    weapons: race.weapons,
    note: race.traits.join(" · "),
  }));
}

function customClassOptions(): ClassOption[] {
  return CUSTOM_CLASSES.map((klass) => ({
    id: klass.id,
    name: klass.name,
    hitDie: klass.hitDie,
    saves: klass.saves,
    skillChoices: klass.skillChoices,
    armor: klass.armor,
    weapons: klass.weapons,
    tools: klass.tools ?? [],
    spellAbility: klass.spellAbility,
    casterType: klass.casterType,
    genres: klass.genres,
    blurb: klass.blurb,
    knownCaster: klass.knownCaster,
    castingLabel: klass.castingLabel,
    spellListFrom: klass.spellListFrom,
  }));
}

function srdClassOptions(): ClassOption[] {
  return [
    ...SRD_CLASSES.map((klass) => ({
      id: klass.id,
      name: klass.name,
      languages: klass.languages,
      hitDie: klass.hitDie,
      saves: klass.saves,
      skillChoices: klass.skillChoices,
      armor: klass.armor,
      weapons: klass.weapons,
      tools: klass.tools ?? [],
      spellAbility: klass.spellAbility,
      casterType: klass.casterType,
    })),
    ...customClassOptions(),
  ];
}

function customBackgroundOptions(): BackgroundOption[] {
  return CUSTOM_BACKGROUNDS.map((background) => ({
    id: background.id,
    name: background.name,
    skills: background.skills,
    tools: background.tools,
    languages: background.languages,
    equipment: background.equipment,
    genres: background.genres,
    blurb: background.blurb,
  }));
}

function srdBackgroundOptions(): BackgroundOption[] {
  return [
    ...SRD_BACKGROUNDS.map((background) => ({
      id: background.id,
      name: background.name,
      skills: background.skills,
      tools: background.tools,
      languages: background.languages,
      equipment: background.equipment,
    })),
    ...customBackgroundOptions(),
  ];
}

// Loads race/class/background options from the Open5e content pack with the
// bundled SRD data as fallback (and as the shape contract).
export function useBuilderOptions() {
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
          setRaces(
            raceRows.map((row) => {
              const mechanics = raceMechanics(row.data);
              return {
                id: row.slug,
                name: row.name,
                ...mechanics,
                note: mechanics.traitsSummary,
              };
            }),
          );
        }
        const classRows = (classesData.results ?? []) as ContentRow[];
        if (classRows.length) {
          // Catalog classes ride along with the pack rows; pack slugs win a
          // (never expected) id collision so the dedupe is just a backstop.
          const packOptions: ClassOption[] = classRows.map((row) => ({
            id: row.slug,
            name: row.name,
            ...classMechanics(row.slug, row.data),
            desc: String(row.data?.desc ?? ""),
            // Open5e rows say nothing about Druidic or Thieves' Cant, so the
            // bundled SRD entry supplies them.
            languages: SRD_CLASSES.find((klass) => klass.id === row.slug)?.languages,
          }));
          const packIds = new Set(packOptions.map((option) => option.id));
          setClasses([
            ...packOptions,
            ...customClassOptions().filter((option) => !packIds.has(option.id)),
          ]);
        }
        const backgroundRows = (backgroundsData.results ?? []) as ContentRow[];
        if (backgroundRows.length) {
          // Catalog backgrounds ride along with the pack rows, same as
          // classes; pack slugs win a (never expected) id collision.
          const packBackgrounds: BackgroundOption[] = backgroundRows.map((row) => ({
            id: row.slug,
            name: row.name,
            skills: skillsInText(row.data.skill_proficiencies),
            desc: String(row.data?.desc ?? ""),
          }));
          const packBackgroundIds = new Set(packBackgrounds.map((option) => option.id));
          setBackgrounds([
            ...packBackgrounds,
            ...customBackgroundOptions().filter(
              (option) => !packBackgroundIds.has(option.id),
            ),
          ]);
        }
      } catch {
        // SRD fallback already in state.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => ({ races, classes, backgrounds, packInstalled }),
    [races, classes, backgrounds, packInstalled],
  );
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
