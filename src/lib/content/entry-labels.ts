// What a content row tells the table about how its rules were read (issue
// #570, "Rules and content"): `bestEffort` when the engine plays mechanics
// it parsed from the row's text and nobody has checked them
// (src/lib/content/reading-logic.ts readingIsBestEffort). The content routes
// attach it to what they send; the info dialog, the reference and the Hand
// show the note. Apart from the content index, which the readers' own
// imports reach.

import { readingOf } from "@/lib/content/readings";
import { readingIsBestEffort, type ReadingKind } from "@/lib/content/reading-logic";

const KIND: Record<string, ReadingKind> = {
  spells: "spell",
  monsters: "monster",
  feats: "feat",
  races: "race",
  classes: "class",
  backgrounds: "background",
  archetypes: "archetype",
};

type LabeledRow = {
  slug: string;
  name: string;
  source: string;
  documentSlug?: string;
  data: Record<string, unknown>;
  aliases?: string[];
};

export function withBestEffort<T>(table: string, value: T, options: { classSlug?: string } = {}): T {
  const row = value as T & LabeledRow;
  const kind = KIND[table];
  if (!kind || !row || row.source !== "open5e" || !row.documentSlug || !row.data) {
    return value;
  }
  const reading = readingOf(kind, {
    slug: row.slug,
    name: row.name,
    documentSlug: row.documentSlug,
    data: row.data,
    aliases: row.aliases ?? [],
    cr: Number(row.data.cr ?? 0) || null,
    classSlug: options.classSlug ?? null,
  });
  return readingIsBestEffort(reading) ? { ...row, bestEffort: true } : value;
}
