// The adjudication catalog: one list of everything the engine can be asked
// to do, assembled from the per-area files so no single one grows past
// reading size.
//
// Its job is to make the two callers symmetrical. The AI DM reaches the
// engine through tool calls; a human DM reaches it through the console, and
// the console renders itself from this list. A tool added for the model and
// forgotten here would leave a person unable to do something the machine
// can, which is exactly the failure the human-DM mode exists to avoid, so
// scripts/test-invoke-catalog.mjs fails the build when the two drift.
import { COMBAT_ADJUDICATIONS } from "@/lib/dm/catalog-combat";
import { PARTY_ADJUDICATIONS } from "@/lib/dm/catalog-party";
import {
  SOCIAL_ADJUDICATIONS,
  STORY_ADJUDICATIONS,
  TABLE_ADJUDICATIONS,
  WORLD_ADJUDICATIONS,
} from "@/lib/dm/catalog-world";
import {
  CATEGORY_LABELS,
  findAdjudication,
  type AdjudicationCategory,
  type CatalogEntry,
} from "@/lib/dm/catalog-types";

export type { CatalogEntry, CatalogField, AdjudicationCategory } from "@/lib/dm/catalog-types";
export { CATEGORY_LABELS, checkArgs } from "@/lib/dm/catalog-types";

export const ADJUDICATIONS: CatalogEntry[] = [
  ...COMBAT_ADJUDICATIONS,
  ...PARTY_ADJUDICATIONS,
  ...WORLD_ADJUDICATIONS,
  ...SOCIAL_ADJUDICATIONS,
  ...STORY_ADJUDICATIONS,
  ...TABLE_ADJUDICATIONS,
];

export const ADJUDICATION_NAMES: string[] = ADJUDICATIONS.map((entry) => entry.name);

export function adjudication(name: string): CatalogEntry | null {
  return findAdjudication(ADJUDICATIONS, name);
}

// What the console offers, category by category, in the order the tabs are
// laid out. Every entry is offered: if the engine can do it, the person
// running the table can reach it, and scripts/test-invoke-catalog.mjs holds
// that line in both directions.
export function consoleAdjudications(): Array<{
  category: AdjudicationCategory;
  label: string;
  entries: CatalogEntry[];
}> {
  const order: AdjudicationCategory[] = ["combat", "party", "world", "social", "story", "table"];
  return order
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      entries: ADJUDICATIONS.filter((entry) => entry.category === category),
    }))
    .filter((group) => group.entries.length > 0);
}
