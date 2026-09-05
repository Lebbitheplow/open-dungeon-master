"use client";

import { useMemo } from "react";
import { classGenres } from "@/lib/classes";
import { GENRE_PRESETS } from "@/lib/genres";
import { describeRace } from "@/lib/help";
import type { Genre } from "@/lib/schemas/game-settings";
import { SRD_SKILLS } from "@/lib/srd";
import { subclassLevelFor, subclassNamesFor } from "@/lib/srd/features";
import { packRecommends, type Reskinned } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import type { PickerGroup, PickerOption } from "./OptionPicker";
import type {
  ArchetypeOption,
  BackgroundOption,
  ClassOption,
  RaceOption,
} from "./useBuilderOptions";

export const ALIGNMENTS = ["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"];

// A pack's own heading for its recommended tier ("Peoples of Middle-earth"),
// so the group reads like the world rather than like a filter.
function packGroupLabel(pack: WorldPack | null, prefix: string): string {
  return pack ? `${prefix} ${pack.name}` : "Recommended for this setting";
}

// The canonical name behind a reskin, shown in the option's meta column so a
// player can always see which SRD entry they are really choosing.
function canonicalName(options: Array<{ id: string; name: string }>, id: string): string {
  return options.find((entry) => entry.id === id)?.name ?? id;
}

// Splits a flat option list into the standard (SRD/content-pack) entries and
// the other settings' catalog entries, grouped by each entry's primary genre.
// Only catalog rows carry `genres`, so "no genres" IS the standard bucket.
// Used when no genre steers the picker (high fantasy, custom, or the library
// builder) so a new player can tell a Netrunner is not a high-fantasy class;
// everything stays selectable either way.
function groupBySourceSetting<T extends { id: string; genres?: Genre[] }>(
  options: T[],
): { standard: T[]; packs: Array<{ genre: Genre; label: string; options: T[] }> } {
  const standard: T[] = [];
  const byGenre = new Map<Genre, T[]>();
  for (const option of options) {
    const source = option.genres?.[0];
    if (!source) {
      standard.push(option);
      continue;
    }
    byGenre.set(source, [...(byGenre.get(source) ?? []), option]);
  }
  const packs = GENRE_PRESETS.filter((preset) => byGenre.has(preset.id)).map((preset) => ({
    genre: preset.id,
    label: preset.name,
    options: byGenre.get(preset.id) ?? [],
  }));
  return { standard, packs };
}

// Splits a list into the entries the setting recommends and the rest. A world
// pack names what exists in it, which is both narrower and truer than genre
// tags, so it wins when there is one. High fantasy keeps the default order:
// the SRD is its baseline.
function tier<T extends { id: string }>(
  all: T[],
  recommended: T[],
): { recommended: T[]; other: T[] } {
  return {
    recommended,
    other: recommended.length
      ? all.filter((entry) => !recommended.some((match) => match.id === entry.id))
      : all,
  };
}

// Rows for the race/class/subclass/background dropdowns, each carrying the
// info wiring for its InfoButton so any option can be read before choosing,
// the same way the spell picker works.
export function usePickerGroups({
  races,
  rawRaces,
  classes,
  rawClasses,
  backgrounds,
  pack,
  genre,
  klass,
  subclass,
  effectiveLevel,
  archetypes,
}: {
  races: Reskinned<RaceOption>[];
  rawRaces: RaceOption[];
  classes: Reskinned<ClassOption>[];
  rawClasses: ClassOption[];
  backgrounds: Reskinned<BackgroundOption>[];
  pack: WorldPack | null;
  genre?: Genre;
  klass: ClassOption | undefined;
  subclass: string;
  effectiveLevel: number;
  archetypes: ArchetypeOption[];
}) {
  const steered = genre && genre !== "custom" && genre !== "high_fantasy" ? genre : null;

  const raceTier = useMemo(
    () =>
      tier(
        races,
        pack?.races.length ? races.filter((entry) => packRecommends(pack, "races", entry.id)) : [],
      ),
    [races, pack],
  );
  const classTier = useMemo(
    () =>
      tier(
        classes,
        pack?.classes.length
          ? classes.filter((entry) => packRecommends(pack, "classes", entry.id))
          : steered
            ? classes.filter((entry) => classGenres(entry.id).includes(steered))
            : [],
      ),
    [classes, pack, steered],
  );
  const backgroundTier = useMemo(
    () =>
      tier(
        backgrounds,
        pack?.backgrounds.length
          ? backgrounds.filter((entry) => packRecommends(pack, "backgrounds", entry.id))
          : steered
            ? backgrounds.filter((entry) => entry.genres?.includes(steered))
            : [],
      ),
    [backgrounds, pack, steered],
  );

  // A pack's own alignments lead the list, labelled rather than enforced: the
  // other nine stay pickable because a heretic is a legitimate character.
  const alignmentOrder = useMemo(() => {
    const preferred = (pack?.alignments ?? []).filter((code) => ALIGNMENTS.includes(code));
    return preferred.length
      ? [...preferred, ...ALIGNMENTS.filter((code) => !preferred.includes(code))]
      : ALIGNMENTS;
  }, [pack]);

  const raceGroups = useMemo<PickerGroup[]>(() => {
    const toOption = (entry: Reskinned<RaceOption>): PickerOption => ({
      id: entry.id,
      name: entry.name,
      // Under a reskin the canonical name goes in the meta column, so a
      // player always knows which SRD race they are actually taking.
      meta: entry.packName ? canonicalName(rawRaces, entry.id) : undefined,
      infoText: entry.packBlurb || describeRace(entry.id) || entry.note,
      reference: { kind: "races", slug: entry.id, name: entry.name },
    });
    if (raceTier.recommended.length) {
      return [
        { label: packGroupLabel(pack, "Peoples of"), options: raceTier.recommended.map(toOption) },
        { label: "All races", options: raceTier.other.map(toOption) },
      ];
    }
    return [{ label: null, options: races.map(toOption) }];
  }, [races, rawRaces, raceTier, pack]);

  const classGroups = useMemo<PickerGroup[]>(() => {
    const toOption = (entry: Reskinned<ClassOption>): PickerOption => ({
      id: entry.id,
      name: entry.name,
      meta: entry.packName
        ? `d${entry.hitDie} · ${canonicalName(rawClasses, entry.id)}`
        : entry.spellAbility
          ? `d${entry.hitDie} · caster`
          : `d${entry.hitDie}`,
      infoText: entry.packBlurb || entry.blurb || entry.desc,
      reference: { kind: "classes", slug: entry.id, name: entry.name },
    });
    if (classTier.recommended.length) {
      return [
        {
          label: pack ? packGroupLabel(pack, "Callings of") : "Recommended for this setting",
          options: classTier.recommended.map(toOption),
        },
        { label: "All classes", options: classTier.other.map(toOption) },
      ];
    }
    // With no recommended tier, the other settings' entries separate out
    // under their source setting instead of blending in unlabeled.
    const bySource = groupBySourceSetting(classTier.other);
    if (bySource.packs.length) {
      return [
        { label: "Standard classes (high fantasy)", options: bySource.standard.map(toOption) },
        ...bySource.packs.map((source) => ({
          label: `From the ${source.label} setting`,
          options: source.options.map(toOption),
        })),
      ];
    }
    return [{ label: null, options: classTier.other.map(toOption) }];
  }, [classTier, rawClasses, pack]);

  // The subclasses we have real feature tables for, offered once the chosen
  // level reaches the class's subclass level. Content-pack archetypes are
  // listed after them: those are prose only, so a player picking one gets no
  // features, and these should be the obvious choice.
  const builtInSubclasses = useMemo(() => {
    if (!klass) {
      return [];
    }
    const pickLevel = subclassLevelFor(klass.id);
    return pickLevel !== null && effectiveLevel >= pickLevel ? subclassNamesFor(klass.id) : [];
  }, [klass, effectiveLevel]);

  // Pack archetypes we already have a table for would otherwise appear twice.
  const packOnlyArchetypes = useMemo(() => {
    const known = new Set(builtInSubclasses.map((entry) => entry.toLowerCase()));
    return archetypes.filter((entry) => !known.has(entry.name.toLowerCase()));
  }, [archetypes, builtInSubclasses]);

  // The pack row behind the chosen subclass, which carries its write-up.
  const chosenArchetype = useMemo(
    () =>
      archetypes.find((entry) => entry.name.toLowerCase() === subclass.trim().toLowerCase()) ??
      null,
    [archetypes, subclass],
  );

  const subclassGroups = useMemo<PickerGroup[]>(() => {
    const groups: PickerGroup[] = [{ label: null, options: [{ id: "", name: "None yet" }] }];
    if (builtInSubclasses.length) {
      groups.push({
        label: "Full features",
        options: builtInSubclasses.map((subclassName) => {
          const match = archetypes.find(
            (entry) => entry.name.toLowerCase() === subclassName.toLowerCase(),
          );
          return {
            id: subclassName,
            name: subclassName,
            infoText: match?.desc,
            reference: match
              ? { kind: "archetypes", slug: match.id, name: subclassName }
              : undefined,
          };
        }),
      });
    }
    if (packOnlyArchetypes.length) {
      groups.push({
        label: "From the content pack",
        options: packOnlyArchetypes.map((entry) => ({
          id: entry.name,
          name: entry.name,
          infoText: entry.desc,
          reference: { kind: "archetypes", slug: entry.id, name: entry.name },
        })),
      });
    }
    return groups;
  }, [builtInSubclasses, packOnlyArchetypes, archetypes]);

  const backgroundGroups = useMemo<PickerGroup[]>(() => {
    const toOption = (entry: Reskinned<BackgroundOption>): PickerOption => ({
      id: entry.id,
      name: entry.name,
      meta: entry.skills
        .map((skillId) => SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId)
        .join(", "),
      infoText: entry.packBlurb || entry.blurb || entry.desc,
      reference: { kind: "backgrounds", slug: entry.id, name: entry.name },
    });
    if (backgroundTier.recommended.length) {
      return [
        {
          label: pack ? packGroupLabel(pack, "Lives in") : "Recommended for this setting",
          options: backgroundTier.recommended.map(toOption),
        },
        { label: "All backgrounds", options: backgroundTier.other.map(toOption) },
      ];
    }
    const bySource = groupBySourceSetting(backgroundTier.other);
    if (bySource.packs.length) {
      return [
        {
          label: "Standard backgrounds (high fantasy)",
          options: bySource.standard.map(toOption),
        },
        ...bySource.packs.map((source) => ({
          label: `From the ${source.label} setting`,
          options: source.options.map(toOption),
        })),
      ];
    }
    return [{ label: null, options: backgroundTier.other.map(toOption) }];
  }, [backgroundTier, pack]);

  return {
    alignmentOrder,
    raceGroups,
    classGroups,
    subclassGroups,
    backgroundGroups,
    // Whether the subclass picker has anything to offer at this level.
    offersSubclass: builtInSubclasses.length > 0 || packOnlyArchetypes.length > 0,
    chosenArchetype,
  };
}
