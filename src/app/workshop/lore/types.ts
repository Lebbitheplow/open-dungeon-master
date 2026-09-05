import type { WorldLoreCategory } from "@/lib/dm/world-lore-logic";

// What the lore panel shows of an entry, and the words it uses for the
// categories. Shared by the campaign's list and the workshop's rows so both
// name a faction a faction.

export type LoreEntryView = {
  id: string;
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
};

export const CATEGORY_LABELS: Record<WorldLoreCategory, string> = {
  geography: "Geography",
  factions: "Factions",
  history: "History",
  magic: "Magic",
  culture: "Culture",
  religion: "Religion",
  other: "Other",
};
