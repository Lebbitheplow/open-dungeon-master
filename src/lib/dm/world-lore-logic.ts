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

// How a party-visible entry is dressed when it is read or shown
// (docs/vtt-parity-implementation-plan.md section 5.6): plain for the
// bible, parchment for a letter or a page, notice for a poster.
export const LORE_STYLES = ["plain", "parchment", "notice"] as const;
export type LoreStyle = (typeof LORE_STYLES)[number];

// The most people an entry can be written for by name.
export const LORE_AUDIENCE_MAX = 12;

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
  // Who may read a party entry: null for the whole table, or the user ids
  // it was written for (section 5.1). Ignored when visibility is "dm".
  audience: string[] | null;
  // A PDF that travels with the entry (section 5.3), as an /uploads/ path.
  attachmentPath: string;
  style: LoreStyle;
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

export function normalizeLoreStyle(raw: unknown): LoreStyle {
  return raw === "parchment" || raw === "notice" ? raw : "plain";
}

// A list of user ids, or null for everyone. Anything that is not a list of
// strings reads as the table, which is what every entry has always been.
export function normalizeLoreAudience(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const ids = [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(
    0,
    LORE_AUDIENCE_MAX,
  );
  return ids.length ? ids : null;
}

// Whether one reader may open an entry. Whoever steers the story reads all
// of it; a player reads the table's entries and the ones written for them.
export function loreReadableBy(entry: WorldLoreEntry, steersStory: boolean, userId?: string | null): boolean {
  if (steersStory) {
    return true;
  }
  if (entry.visibility === "dm") {
    return false;
  }
  const audience = entry.audience ?? null;
  return audience === null || (userId !== undefined && userId !== null && audience.includes(userId));
}

// What a reader may see. The DM prompt and whoever steers the story get
// everything; the table gets what was written for it, and a player also
// gets what was written for them by name.
export function loreVisibleTo(
  entries: WorldLoreEntry[],
  steersStory: boolean,
  userId?: string | null,
): WorldLoreEntry[] {
  return entries.filter((entry) => loreReadableBy(entry, steersStory, userId));
}

// ---- secret blocks ----
//
// A body may fence a passage the DM alone reads (section 5.1):
//
//   :::secret
//   The innkeeper is the cult's ear.
//   :::
//
// The renderer keeps it for the DM seat and drops it for everyone else;
// the prompt reads the whole body, so the model knows what it must not say.

const SECRET_BLOCK = /^[ \t]*:::secret[ \t]*\n([\s\S]*?)^[ \t]*:::[ \t]*$/gm;

export function hasSecretBlocks(body: string): boolean {
  SECRET_BLOCK.lastIndex = 0;
  return SECRET_BLOCK.test(body.replace(/\r\n/g, "\n"));
}

// The body without its secret passages, for any projection that is not
// the DM seat. Blank lines left behind are collapsed so the page does not
// show a gap where the secret was.
export function stripSecretBlocks(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(SECRET_BLOCK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The body with each secret passage marked, for the DM prompt: the model
// must know the secret and must know it is one.
export function markSecretBlocks(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(SECRET_BLOCK, (_match, inner: string) => `(SECRET, the party does not know: ${inner.trim()})`);
}

// ---- backlinks ----
//
// "Mentioned in" for an entry (section 5.4): every text on the table that
// links to it by name. Pure over whatever the caller gathered.

export type LoreMention = { kind: "lore" | "npc" | "beat" | "note"; id: string; name: string };

export function loreBacklinks(
  title: string,
  sources: Array<{ kind: LoreMention["kind"]; id: string; name: string; text: string }>,
): LoreMention[] {
  const wanted = title.trim().toLowerCase();
  if (!wanted) {
    return [];
  }
  const out: LoreMention[] = [];
  for (const source of sources) {
    if (loreLinkNames(source.text).some((name) => name.toLowerCase() === wanted)) {
      out.push({ kind: source.kind, id: source.id, name: source.name });
    }
  }
  return out;
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
    const line = `- [${entry.category}] ${entry.title}${secret}: ${clipBody(markSecretBlocks(entry.body), 300)}`;
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
