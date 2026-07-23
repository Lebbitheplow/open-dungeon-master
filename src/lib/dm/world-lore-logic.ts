// Pure logic for the world lore builder: entry normalization, keyword
// fallback scoring, and the budgeted WORLD LORE prompt block. No DB access
// and no "@/" imports so scripts/test-lore-builder.mjs can load it
// directly; the impure rim is src/lib/db/lore.ts.

export const WORLD_LORE_CATEGORIES = [
  "geography",
  "factions",
  "history",
  "magic",
  "culture",
  "religion",
  "other",
] as const;
export type WorldLoreCategory = (typeof WORLD_LORE_CATEGORIES)[number];

export type WorldLoreEntry = {
  id: string;
  campaignId: string;
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export const LORE_TITLE_MAX = 120;
export const LORE_BODY_MAX = 4_000;
export const LORE_TAGS_MAX = 8;

export function normalizeLoreInput(input: {
  category?: unknown;
  title?: unknown;
  body?: unknown;
  tags?: unknown;
}): { category: WorldLoreCategory; title: string; body: string; tags: string[] } | null {
  const category = WORLD_LORE_CATEGORIES.includes(input.category as WorldLoreCategory)
    ? (input.category as WorldLoreCategory)
    : null;
  const title = typeof input.title === "string" ? input.title.trim().slice(0, LORE_TITLE_MAX) : "";
  const body = typeof input.body === "string" ? input.body.trim().slice(0, LORE_BODY_MAX) : "";
  if (!category || !title || !body) {
    return null;
  }
  const tags = Array.isArray(input.tags)
    ? input.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, LORE_TAGS_MAX)
    : [];
  return { category, title, body, tags };
}

// Keyword fallback when an entry has no embedding yet (or the embedder is
// down): overlap of query words against title/body/tags.
export function scoreLoreByKeywords(query: string, entry: WorldLoreEntry): number {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2);
  if (!words.length) {
    return 0;
  }
  const haystack = `${entry.title} ${entry.tags.join(" ")} ${entry.body}`.toLowerCase();
  let hits = 0;
  for (const word of words) {
    if (haystack.includes(word)) {
      hits += 1;
    }
  }
  return hits / words.length;
}

function clipBody(body: string, max: number): string {
  return body.length <= max ? body : `${body.slice(0, max - 3)}...`;
}

// The WORLD LORE prompt block: pinned entries first, then the retrieved
// ones, cut off at the character budget. Full bodies stay reachable through
// the search_lore tool.
export function renderLoreForPrompt(
  pinned: WorldLoreEntry[],
  retrieved: WorldLoreEntry[],
  budget = 1_600,
): string {
  const lines: string[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const entry of [...pinned, ...retrieved]) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    const line = `- [${entry.category}] ${entry.title}: ${clipBody(entry.body, 300)}`;
    if (used + line.length > budget) {
      break;
    }
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) {
    return "";
  }
  return `WORLD LORE (established by the party lead; treat as canon):\n${lines.join("\n")}`;
}
