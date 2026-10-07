"use client";

import { useMemo } from "react";
import { classGenres } from "@/lib/classes";
import { GENRE_PRESETS } from "@/lib/genres";
import { describeRace } from "@/lib/help";
import type { Genre } from "@/lib/schemas/game-settings";
import { SRD_SKILLS } from "@/lib/srd";
import { subclassBlurb, subclassGate, subclassNamesFor } from "@/lib/srd/features";
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

// Two-letter codes are the shorthand of people who already play. A first
// character should not have to guess what "CN" means, so the picker spells
// each one out and says how it tends to play at a table.
export const ALIGNMENT_LABELS: Record<string, { name: string; blurb: string }> = {
  LG: {
    name: "Lawful Good",
    blurb:
      "Does the right thing, by the rules. Keeps promises, protects the weak, trusts institutions to be worth defending. The paladin's default.",
  },
  NG: {
    name: "Neutral Good",
    blurb:
      "Does the most good available, law or no law. Helps whoever is in front of them without much regard for who is owed what.",
  },
  CG: {
    name: "Chaotic Good",
    blurb:
      "Does the right thing, and breaks whatever rule is in the way. Rebels, smugglers with a conscience, people who free prisoners first and ask later.",
  },
  LN: {
    name: "Lawful Neutral",
    blurb:
      "Order for its own sake. The judge, the soldier, the monk: the code matters more than any one outcome it produces.",
  },
  N: {
    name: "True Neutral",
    blurb:
      "No strong pull either way. Gets on with life, takes a side when a side has to be taken. The commonest alignment for ordinary people.",
  },
  CN: {
    name: "Chaotic Neutral",
    blurb:
      "Freedom above all, their own most of all. Unpredictable but not cruel. Easy to play badly; check with your table before choosing it.",
  },
  LE: {
    name: "Lawful Evil",
    blurb:
      "Takes what they want, within a system they respect and use. Tyrants, corrupt officials, devils. Keeps their word, which makes them worse.",
  },
  NE: {
    name: "Neutral Evil",
    blurb: "Takes what they want and feels no need to dress it up. Loyal to nobody but themselves.",
  },
  CE: {
    name: "Chaotic Evil",
    blurb:
      "Destruction for its own sake. Almost always an NPC alignment; a party rarely survives one.",
  },
};

const ALIGNMENT_INFO =
  "Alignment is a two-word shorthand for how your character treats rules (lawful, neutral, chaotic) and other people (good, neutral, evil). It binds nothing: it is a note to yourself and to the DM about how this person tends to act, and characters drift over a campaign. Pick the one that sounds most like them and stop worrying about it.";

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

// The pack documents the bundled SRD tables describe; everything else in the
// pack is another book, named on its rows (issue #116).
const CORE_DOCUMENTS = new Set(["wotc-srd", "odm-expanded"]);
const isCoreDocument = (documentSlug?: string) => !documentSlug || CORE_DOCUMENTS.has(documentSlug);

// Splits a flat option list into the standard entries (the SRD's, and the
// content pack's copies of them), the other books the pack carries (Tome of
// Heroes, Level Up's Adventurer's Guide) and the other settings' catalog
// entries, grouped by each entry's primary genre. Only catalog rows carry
// `genres`; only pack rows carry a `documentSlug`. Used when no genre steers
// the picker (high fantasy, custom, or the library builder) so a new player
// can tell a Netrunner is not a high-fantasy class and a Marshal is not a
// 5e Core Rules one; everything stays selectable either way.
function groupBySourceSetting<T extends { id: string; genres?: Genre[]; documentSlug?: string; source?: string }>(
  options: T[],
): {
  standard: T[];
  books: Array<{ label: string; options: T[] }>;
  packs: Array<{ genre: Genre; label: string; options: T[] }>;
} {
  const standard: T[] = [];
  const byBook = new Map<string, T[]>();
  const byGenre = new Map<Genre, T[]>();
  for (const option of options) {
    const genre = option.genres?.[0];
    if (genre) {
      byGenre.set(genre, [...(byGenre.get(genre) ?? []), option]);
      continue;
    }
    if (!isCoreDocument(option.documentSlug)) {
      const book = option.source ?? option.documentSlug ?? "Other books";
      byBook.set(book, [...(byBook.get(book) ?? []), option]);
      continue;
    }
    standard.push(option);
  }
  const books = [...byBook.entries()].map(([label, entries]) => ({ label, options: entries }));
  const packs = GENRE_PRESETS.filter((preset) => byGenre.has(preset.id)).map((preset) => ({
    genre: preset.id,
    label: preset.name,
    options: byGenre.get(preset.id) ?? [],
  }));
  return { standard, books, packs };
}

// Races by the book they come from, in the order the pack lists the books
// (the SRD first): the one grid of seventy-two had no headings at all, and
// two rows named Drow could not be told apart (issue #116).
function groupByBook<T extends { id: string; source?: string; documentSlug?: string }>(
  options: T[],
): Array<{ label: string; options: T[] }> {
  const byBook = new Map<string, T[]>();
  for (const option of options) {
    const book = option.source ?? option.documentSlug ?? "";
    byBook.set(book, [...(byBook.get(book) ?? []), option]);
  }
  const rank = (entries: T[]) => {
    const slug = entries[0]?.documentSlug ?? "";
    return slug === "wotc-srd" ? 0 : slug === "odm-expanded" ? 1 : 2;
  };
  return [...byBook.entries()]
    .sort(([, a], [, b]) => rank(a) - rank(b))
    .map(([label, entries]) => ({ label, options: entries }));
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
// The write-up behind a class or background card's "?": the setting's own
// blurb, then the bundled line, then the content pack's full entry, and for
// a background what its feature does. Joined so a short line and a long
// rules text both show rather than one hiding the other.
export function classInfoText(entry: { packBlurb?: string; blurb?: string; desc?: string }): string | undefined {
  const parts = [entry.packBlurb || entry.blurb, entry.desc].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

export function backgroundInfoText(entry: {
  packBlurb?: string;
  blurb?: string;
  desc?: string;
  feature?: string;
  featureDesc?: string;
}): string | undefined {
  const feature = entry.feature
    ? `**Feature: ${entry.feature}.**${entry.featureDesc ? ` ${entry.featureDesc}` : ""}`
    : "";
  const parts = [entry.packBlurb || entry.blurb, feature, entry.desc].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

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
  const alignmentGroups = useMemo<PickerGroup[]>(() => {
    const toOption = (code: string): PickerOption => ({
      id: code,
      name: `${code}: ${ALIGNMENT_LABELS[code]?.name ?? code}`,
      infoText: ALIGNMENT_LABELS[code]?.blurb ?? ALIGNMENT_INFO,
    });
    const preferred = (pack?.alignments ?? []).filter((code) => ALIGNMENTS.includes(code));
    if (!preferred.length) {
      return [{ label: null, options: ALIGNMENTS.map(toOption) }];
    }
    return [
      { label: packGroupLabel(pack, "Common in"), recommended: true, options: preferred.map(toOption) },
      {
        label: "All alignments",
        options: ALIGNMENTS.filter((code) => !preferred.includes(code)).map(toOption),
      },
    ];
  }, [pack]);

  const raceGroups = useMemo<PickerGroup[]>(() => {
    // `showSource` names the book on the row where the group heading does
    // not: a pack's recommended tier mixes books.
    const toOption = (entry: Reskinned<RaceOption>, showSource: boolean): PickerOption => ({
      id: entry.id,
      name: entry.name,
      // Under a reskin the canonical name goes in the meta column, so a
      // player always knows which SRD race they are actually taking.
      meta: entry.packName ? canonicalName(rawRaces, entry.id) : undefined,
      ...(showSource && entry.source ? { source: entry.source } : {}),
      // A pack-only lineage has no bundled lines; leaving the text empty
      // lets the dialog fetch the row's full trait write-up instead of
      // showing the card's clipped summary.
      infoText: entry.packBlurb || describeRace(entry.id) || undefined,
      // The pack row behind the option, which is not always the id
      // (src/lib/content/race-options.ts optionIdFor).
      reference: { kind: "races", slug: entry.slug ?? entry.id, name: entry.name },
    });
    if (raceTier.recommended.length) {
      return [
        {
          label: packGroupLabel(pack, "Peoples of"),
          recommended: true,
          options: raceTier.recommended.map((entry) => toOption(entry, true)),
        },
        { label: "All races", options: raceTier.other.map((entry) => toOption(entry, true)) },
      ];
    }
    const books = groupByBook(races);
    if (books.length > 1) {
      return books.map((book) => ({ label: book.label, options: book.options.map((entry) => toOption(entry, false)) }));
    }
    return [{ label: null, options: races.map((entry) => toOption(entry, false)) }];
  }, [races, rawRaces, raceTier, pack]);

  const classGroups = useMemo<PickerGroup[]>(() => {
    const toOption = (entry: Reskinned<ClassOption>, showSource: boolean): PickerOption => ({
      id: entry.id,
      name: entry.name,
      meta: entry.packName
        ? `d${entry.hitDie} · ${canonicalName(rawClasses, entry.id)}`
        : entry.spellAbility
          ? `d${entry.hitDie} · caster`
          : `d${entry.hitDie}`,
      ...(showSource && entry.source && !isCoreDocument(entry.documentSlug) ? { source: entry.source } : {}),
      infoText: classInfoText(entry),
      reference: { kind: "classes", slug: entry.id, name: entry.name },
    });
    if (classTier.recommended.length) {
      return [
        {
          label: pack ? packGroupLabel(pack, "Callings of") : "Recommended for this setting",
          recommended: true,
          options: classTier.recommended.map((entry) => toOption(entry, true)),
        },
        { label: "All classes", options: classTier.other.map((entry) => toOption(entry, true)) },
      ];
    }
    // With no recommended tier, the other books' and the other settings'
    // entries separate out under their source instead of blending in
    // unlabeled (a Marshal is Level Up's, not the Core Rules').
    const bySource = groupBySourceSetting(classTier.other);
    if (bySource.packs.length || bySource.books.length) {
      return [
        { label: "Standard classes (5e Core Rules)", options: bySource.standard.map((entry) => toOption(entry, false)) },
        ...bySource.books.map((book) => ({
          label: `From ${book.label}`,
          options: book.options.map((entry) => toOption(entry, false)),
        })),
        ...bySource.packs.map((source) => ({
          label: `From the ${source.label} setting`,
          options: source.options.map((entry) => toOption(entry, false)),
        })),
      ];
    }
    return [{ label: null, options: classTier.other.map((entry) => toOption(entry, false)) }];
  }, [classTier, rawClasses, pack]);

  // The subclasses we have real feature tables for, offered once the chosen
  // level reaches the class's subclass level. Content-pack archetypes are
  // listed after them: those are prose only, so a player picking one gets no
  // features, and these should be the obvious choice.
  // Below the class's subclass level nothing is offered, the pack's
  // archetypes included: reconcile drops a subclass picked early, so a menu
  // that listed them took a pick and showed "None yet" (issue #109). The
  // step says when the choice comes instead (subclassLockedAt).
  const gate = useMemo(
    () => (klass ? subclassGate(klass.id, effectiveLevel) : { pickLevel: null, locked: false }),
    [klass, effectiveLevel],
  );
  const builtInSubclasses = useMemo(
    () => (klass && !gate.locked ? subclassNamesFor(klass.id) : []),
    [klass, gate.locked],
  );

  // Pack archetypes we already have a table for would otherwise appear twice.
  const packOnlyArchetypes = useMemo(() => {
    if (gate.locked) {
      return [];
    }
    const known = new Set(builtInSubclasses.map((entry) => entry.toLowerCase()));
    return archetypes.filter((entry) => !known.has(entry.name.toLowerCase()));
  }, [archetypes, builtInSubclasses, gate.locked]);

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
            // The pack's full write-up when it has the row, else the
            // bundled line, so no subclass is a bare name.
            infoText: match?.desc || subclassBlurb(klass?.id ?? "", subclassName) || undefined,
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
  }, [builtInSubclasses, packOnlyArchetypes, archetypes, klass]);

  const backgroundGroups = useMemo<PickerGroup[]>(() => {
    const toOption = (entry: Reskinned<BackgroundOption>, showSource: boolean): PickerOption => ({
      id: entry.id,
      name: entry.name,
      meta: entry.skills
        .map((skillId) => SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId)
        .join(", "),
      ...(showSource && entry.source && !isCoreDocument(entry.documentSlug) ? { source: entry.source } : {}),
      infoText: backgroundInfoText(entry),
      reference: { kind: "backgrounds", slug: entry.id, name: entry.name },
    });
    if (backgroundTier.recommended.length) {
      return [
        {
          label: pack ? packGroupLabel(pack, "Lives in") : "Recommended for this setting",
          recommended: true,
          options: backgroundTier.recommended.map((entry) => toOption(entry, true)),
        },
        { label: "All backgrounds", options: backgroundTier.other.map((entry) => toOption(entry, true)) },
      ];
    }
    const bySource = groupBySourceSetting(backgroundTier.other);
    if (bySource.packs.length || bySource.books.length) {
      return [
        {
          label: "Standard backgrounds (5e Core Rules)",
          options: bySource.standard.map((entry) => toOption(entry, false)),
        },
        ...bySource.books.map((book) => ({
          label: `From ${book.label}`,
          options: book.options.map((entry) => toOption(entry, false)),
        })),
        ...bySource.packs.map((source) => ({
          label: `From the ${source.label} setting`,
          options: source.options.map((entry) => toOption(entry, false)),
        })),
      ];
    }
    return [{ label: null, options: backgroundTier.other.map((entry) => toOption(entry, false)) }];
  }, [backgroundTier, pack]);

  return {
    alignmentGroups,
    alignmentInfo: ALIGNMENT_INFO,
    raceGroups,
    classGroups,
    subclassGroups,
    backgroundGroups,
    // Whether the subclass picker has anything to offer at this level.
    offersSubclass: builtInSubclasses.length > 0 || packOnlyArchetypes.length > 0,
    // The level the class picks its subclass at, while this level is below
    // it; null once the pick is open (or for a class with no pick level).
    subclassLockedAt: gate.locked ? gate.pickLevel : null,
    chosenArchetype,
  };
}
