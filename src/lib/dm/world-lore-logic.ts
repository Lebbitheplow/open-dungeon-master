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

// Who may read an entry (docs/workshop-parity-audit.md phase 14). "party"
// is what every entry has always been: the world bible the table reads.
// "dm" is the secret: the true history, the cult behind the guild. The DM
// prompt reads both; a player's list carries only the first.
export const LORE_VISIBILITIES = ["party", "dm"] as const;
export type LoreVisibility = (typeof LORE_VISIBILITIES)[number];

export type WorldLoreEntry = {
  id: string;
  campaignId: string;
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  visibility: LoreVisibility;
  // A picture with the entry: the letter the party finds, the notice on the
  // tavern wall. A party-visible entry with one is a handout. Empty for none.
  imagePath: string;
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
  visibility?: unknown;
}): {
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags: string[];
  visibility: LoreVisibility;
} | null {
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
  return { category, title, body, tags, visibility: normalizeLoreVisibility(input.visibility) };
}

export function normalizeLoreVisibility(raw: unknown): LoreVisibility {
  return raw === "dm" ? "dm" : "party";
}

// What a reader may see. The DM prompt and whoever steers the story get
// everything; the table gets what was written for it.
export function loreVisibleTo(entries: WorldLoreEntry[], steersStory: boolean): WorldLoreEntry[] {
  return steersStory ? entries : entries.filter((entry) => entry.visibility !== "dm");
}

// ---- links between documents ----
//
// "[[Marla]]" in a body is a link to whatever the workshop holds under that
// name: another entry, an NPC, a place, a map. Resolved at render time
// against the names the caller knows, so nothing is stored but the text and
// a renamed NPC simply reads as an unresolved link until the body is fixed.

export type LoreLinkTarget = { kind: "lore" | "npc" | "place" | "map"; id: string; name: string };

export type LoreSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; name: string; target: LoreLinkTarget | null };

const LINK = /\[\[([^\]\n]{1,80})\]\]/g;

export function splitLoreLinks(text: string, targets: LoreLinkTarget[]): LoreSegment[] {
  const byName = new Map(targets.map((target) => [target.name.trim().toLowerCase(), target]));
  const segments: LoreSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const at = match.index ?? 0;
    if (at > last) {
      segments.push({ kind: "text", text: text.slice(last, at) });
    }
    const name = match[1].trim();
    segments.push({ kind: "link", name, target: byName.get(name.toLowerCase()) ?? null });
    last = at + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
  }
  return segments;
}

// The names an entry links to, for "what does this mention" without
// rendering it.
export function loreLinkNames(text: string): string[] {
  return [...new Set([...text.matchAll(LINK)].map((match) => match[1].trim()))];
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
// the search_lore tool. A secret is marked so the model knows the party
// does not know it.
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
    const secret = entry.visibility === "dm" ? " (SECRET: the party does not know this)" : "";
    const line = `- [${entry.category}] ${entry.title}${secret}: ${clipBody(entry.body, 300)}`;
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
