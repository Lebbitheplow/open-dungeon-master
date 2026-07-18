"use client";

import { useEffect, useMemo, useState } from "react";
import {
  classMechanics,
  raceMechanics,
  type ClassMechanics,
  type RaceMechanics,
} from "@/lib/content/mechanics";
import { SRD_BACKGROUNDS, SRD_CLASSES, SRD_RACES } from "@/lib/srd";
import { skillsInText } from "@/lib/content/mechanics";

export type RaceOption = { id: string; name: string; note: string } & RaceMechanics;
export type ClassOption = { id: string; name: string } & ClassMechanics;
export type BackgroundOption = { id: string; name: string; skills: string[] };
export type ArchetypeOption = { id: string; name: string };

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
    traitsSummary: race.traits.join(" · "),
    note: race.traits.join(" · "),
  }));
}

function srdClassOptions(): ClassOption[] {
  return SRD_CLASSES.map((klass) => ({
    id: klass.id,
    name: klass.name,
    hitDie: klass.hitDie,
    saves: klass.saves,
    skillChoices: klass.skillChoices,
    armor: klass.armor,
    weapons: klass.weapons,
    spellAbility: klass.spellAbility,
    casterType: klass.casterType,
  }));
}

function srdBackgroundOptions(): BackgroundOption[] {
  return SRD_BACKGROUNDS.map((background) => ({
    id: background.id,
    name: background.name,
    skills: background.skills,
  }));
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
          setClasses(
            classRows.map((row) => ({
              id: row.slug,
              name: row.name,
              ...classMechanics(row.slug, row.data),
            })),
          );
        }
        const backgroundRows = (backgroundsData.results ?? []) as ContentRow[];
        if (backgroundRows.length) {
          setBackgrounds(
            backgroundRows.map((row) => ({
              id: row.slug,
              name: row.name,
              skills: skillsInText(row.data.skill_proficiencies),
            })),
          );
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
            (data.results as ContentRow[]).map((row) => ({ id: row.slug, name: row.name })),
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
