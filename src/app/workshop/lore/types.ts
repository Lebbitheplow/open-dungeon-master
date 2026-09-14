import type { LoreStyle, LoreVisibility, WorldLoreCategory } from "@/lib/dm/world-lore-logic";

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
  visibility: LoreVisibility;
  imagePath: string;
  audience?: string[] | null;
  attachmentPath?: string;
  style?: LoreStyle;
};

export type LoreDraft = {
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags: string;
  visibility: LoreVisibility;
  imagePath: string;
  audience: string[] | null;
  attachmentPath: string;
  style: LoreStyle;
};

export function blankLoreDraft(): LoreDraft {
  return { category: "geography", title: "", body: "", tags: "", visibility: "party", imagePath: "", audience: null, attachmentPath: "", style: "plain" };
}

export function draftFromEntry(entry: LoreEntryView): LoreDraft {
  return {
    category: entry.category,
    title: entry.title,
    body: entry.body,
    tags: entry.tags.join(", "),
    visibility: entry.visibility,
    imagePath: entry.imagePath,
    audience: entry.audience ?? null,
    attachmentPath: entry.attachmentPath ?? "",
    style: entry.style ?? "plain",
  };
}

export const CATEGORY_LABELS: Record<WorldLoreCategory, string> = {
  geography: "Geography",
  factions: "Factions",
  history: "History",
  magic: "Magic",
  culture: "Culture",
  religion: "Religion",
  other: "Other",
};
