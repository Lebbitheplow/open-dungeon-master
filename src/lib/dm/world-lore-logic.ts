// Pure logic for the world lore builder: entry normalization, keyword
// fallback scoring, and the budgeted WORLD LORE prompt block. No DB access
// and no "@/" imports so scripts/test-lore-builder.mjs can load it
// directly; the impure rim is src/lib/db/lore.ts.

import { bestPassage } from "./passage.ts";
import { canonMeaning } from "../worldforge/canon.ts";
import type { Canon } from "../worldforge/model.ts";
import { textKey } from "../language/text-logic.ts";

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
  // Held back from players because its WorldForge entry is not canon yet
  // (draft, alternate, retired): src/lib/db/world-publication.ts. Absent for
  // an entry with no world entry, or a canon one.
  unpublished?: boolean;
  // The canon state that holds it back, for the paths that hand lore to a
  // model (src/lib/worldforge/canon.ts): a draft is marked, an alternate is
  // marked as another telling, a retired one is left out. Absent when canon.
  canon?: Exclude<Canon, "canon">;
  style: LoreStyle;
  createdAt: string;
  updatedAt: string;
};

export const LORE_TITLE_MAX = 120;
// The cap a bundle entry travels under too (src/lib/workshop/bundle-schema.ts
// reads it from here), so an entry that arrived whole stays safe to edit
// (issue #302). The prompt never carries a whole body: renderLoreForPrompt
// clips each to an excerpt and search_lore answers with the nearest passage.
export const LORE_BODY_MAX = 20_000;
export const LORE_TAGS_MAX = 8;

// What saving a body over the cap would cut, as a sentence for the editor
// and the route, or "" when it fits. The routes refuse rather than slice.
export function loreBodyOverflow(body: unknown): string {
  const text = typeof body === "string" ? body.trim() : "";
  if (text.length <= LORE_BODY_MAX) {
    return "";
  }
  const lost = text.slice(LORE_BODY_MAX).trim();
  const shown = lost.length > 60 ? `${lost.slice(0, 60).trimEnd()}...` : lost;
  return `This entry is ${text.length.toLocaleString("en-US")} characters; the limit is ${LORE_BODY_MAX.toLocaleString("en-US")}. The last ${(text.length - LORE_BODY_MAX).toLocaleString("en-US")} would be lost${shown ? `: "${shown}"` : ""}.`;
}

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
  // The author's audience and the entry's canon both have to allow it: a
  // draft is not the table's yet, whatever its audience will be.
  if (entry.visibility === "dm" || entry.unpublished) {
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
  const wanted = textKey(title);
  if (!wanted) {
    return [];
  }
  const out: LoreMention[] = [];
  for (const source of sources) {
    if (loreLinkNames(source.text).some((name) => textKey(name) === wanted)) {
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
  const byName = new Map(targets.map((target) => [textKey(target.name), target]));
  const segments: LoreSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const at = match.index ?? 0;
    if (at > last) {
      segments.push({ kind: "text", text: text.slice(last, at) });
    }
    const name = match[1].trim();
    segments.push({ kind: "link", name, target: byName.get(textKey(name)) ?? null });
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

function clipBody(body: string, max: number): string {
  return body.length <= max ? body : `${body.slice(0, max - 3)}...`;
}

// An entry's excerpt for the prompt: the whole body when it fits, else the
// passage nearest the moment when a scorer is given (passage.ts), else the
// head. A body with a secret passage keeps the head, so a secret's marker is
// never cut away from its words.
export function loreExcerpt(entry: WorldLoreEntry, max: number, score?: (text: string) => number): string {
  if (entry.body.length > max && score && !hasSecretBlocks(entry.body)) {
    const passage = bestPassage(entry.body, score, max);
    if (passage) {
      return passage;
    }
  }
  return clipBody(markSecretBlocks(entry.body), max);
}

// ---- the WORLD LORE prompt block (issue #305) ----
//
// Pinned entries first, then the entries picked for the moment, inside a
// character budget the caller measures from the prompt window
// (context-retrieval.ts). A picked entry shows a short excerpt, the passage
// of its body nearest the moment when the caller can tell; when the picks do
// not fit at the full excerpt they shorten together before any is left out.
// What is still left out (by the cap or the budget) is named in one closing
// line, so the block never reads as the whole set when it is not; the full
// bodies stay one search_lore away. A secret is marked so the model knows
// the party does not know it.

export const LORE_EXCERPT_STEPS = [300, 220, 160, 120] as const;
// The closing line of held-back titles stops listing past this length and
// ends ", and N more." instead, so it never takes more than HELD_LINE_ROOM.
const HELD_LINE_MAX = 260;
const HELD_LINE_ROOM = HELD_LINE_MAX + 20;

// One entry of the turn's lore and what became of it, for the context
// inspector (ContextPanel.tsx). Lead-only, like the rest of the trace.
export type LorePickTrace = {
  id: string;
  title: string;
  included: boolean;
  reason: string;
  pinned?: true;
  secret?: true;
  // A near match that was not close enough to ride: shown for the record,
  // not as something the turn missed.
  weak?: true;
};

export type LoreTrace = {
  picks: LorePickTrace[];
  // Characters the entry lines took, and what they were allowed.
  chars: number;
  budgetChars: number;
};

export type LorePickInput = { entry: WorldLoreEntry; reason: string };
// close: it matched the moment and only the cap or the budget kept it out,
// so the closing line names it; a weak near match is traced but not named.
export type LoreHeldInput = { entry: WorldLoreEntry; reason: string; close: boolean };

function entryLine(entry: WorldLoreEntry, excerpt: string): string {
  // A draft WorldForge holds back from players (src/lib/db/world-publication.ts)
  // is no more theirs than a DM-only entry: the DM may use it, not state it.
  // The words for its state are the canon policy's (src/lib/worldforge/canon.ts),
  // so an alternate reads as another telling and not as a draft.
  const secret = entry.canon
    ? ` (${canonMeaning(entry.canon, true)}; the party does not know this)`
    : entry.visibility === "dm"
      ? " (SECRET: the party does not know this)"
      : entry.unpublished
        ? " (NOT CANON YET: the party does not know this; use it only if it fits)"
        : "";
  return `- [${entry.category}] ${entry.title}${secret}: ${excerpt}`;
}

function heldLine(titles: string[]): string {
  const head = "Also bearing on this moment, left out for room (search_lore reads them): ";
  let line = head;
  for (const [index, title] of titles.entries()) {
    const next = `${index ? ", " : ""}${title}`;
    const rest = titles.length - index;
    if (line.length + next.length + 12 > HELD_LINE_MAX && index) {
      return `${line}, and ${rest} more.`;
    }
    line += next;
  }
  return `${line}.`;
}

export function renderLoreBlock(input: {
  pinned: WorldLoreEntry[];
  picked: LorePickInput[];
  held?: LoreHeldInput[];
  budget: number;
  // The excerpt of a body at most `max` characters long; the head of the
  // body when not given.
  excerpt?: (entry: WorldLoreEntry, max: number) => string;
}): { text: string; trace: LoreTrace } {
  const budget = Math.max(0, Math.floor(input.budget));
  const makeExcerpt = input.excerpt ?? ((entry: WorldLoreEntry, max: number) => loreExcerpt(entry, max));
  // The fit below asks for the same excerpt more than once.
  const excerpts = new Map<string, string>();
  const excerptOf = (entry: WorldLoreEntry, max: number) => {
    const key = `${entry.id}\u0000${max}`;
    let excerpt = excerpts.get(key);
    if (excerpt === undefined) {
      excerpt = makeExcerpt(entry, max);
      excerpts.set(key, excerpt);
    }
    return excerpt;
  };
  // An entry appears once, in the first place it was given.
  const seen = new Set<string>();
  const firstTime = (id: string) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  const pinned = input.pinned.filter((entry) => firstTime(entry.id));
  const picked = input.picked.filter(({ entry }) => firstTime(entry.id));
  const traces: LorePickTrace[] = [];
  const trace = (entry: WorldLoreEntry, included: boolean, reason: string, flags: { pinned?: boolean; weak?: boolean } = {}): LorePickTrace => ({
    id: entry.id,
    title: entry.title,
    included,
    reason,
    ...(flags.pinned ? { pinned: true as const } : {}),
    ...(entry.visibility === "dm" || entry.unpublished ? { secret: true as const } : {}),
    ...(flags.weak ? { weak: true as const } : {}),
  });

  // Lays the block out with `room` characters for the entry lines.
  const lay = (room: number) => {
    const lines: string[] = [];
    const out: LorePickTrace[] = [];
    const left: string[] = [];
    let used = 0;
    // The lead pinned these; they keep the excerpt they always had and come
    // first. One that does not fit is held back, and later ones still try.
    for (const entry of pinned) {
      const line = entryLine(entry, clipBody(markSecretBlocks(entry.body), LORE_EXCERPT_STEPS[0]));
      if (used + line.length + 1 > room) {
        out.push(trace(entry, false, "pinned; held back: over the lore budget", { pinned: true }));
        left.push(entry.title);
        continue;
      }
      lines.push(line);
      used += line.length + 1;
      out.push(trace(entry, true, "pinned", { pinned: true }));
    }
    // The picks at the longest excerpt that fits them all, else the shortest.
    const remaining = room - used;
    let step: number = LORE_EXCERPT_STEPS[LORE_EXCERPT_STEPS.length - 1];
    for (const candidate of LORE_EXCERPT_STEPS) {
      const total = picked.reduce((sum, { entry }) => sum + entryLine(entry, excerptOf(entry, candidate)).length + 1, 0);
      if (total <= remaining) {
        step = candidate;
        break;
      }
    }
    let shown = false;
    for (const [index, { entry, reason }] of picked.entries()) {
      const line = entryLine(entry, excerptOf(entry, step));
      if (used + line.length + 1 > room) {
        out.push(trace(entry, false, `held back: over the lore budget (rank ${index + 1}, ${reason})`));
        left.push(entry.title);
        continue;
      }
      lines.push(line);
      used += line.length + 1;
      shown = true;
      out.push(trace(entry, true, `rank ${index + 1}: ${reason}${step < LORE_EXCERPT_STEPS[0] ? `; excerpt ${step} characters` : ""}`));
    }
    return { lines, out, left, used, shown };
  };

  const held = (input.held ?? []).filter(({ entry }) => firstTime(entry.id));
  const capped = held.filter((entry) => entry.close).map(({ entry }) => entry.title);
  let laid = lay(budget);
  let names = [...laid.left, ...capped];
  let closing = names.length ? heldLine(names) : "";
  // The closing line comes out of the same budget: lay the entries out again
  // in what it leaves, and name whatever that leaves out too.
  if (closing && laid.used + closing.length > budget) {
    laid = lay(Math.max(0, budget - HELD_LINE_ROOM));
    names = [...laid.left, ...capped];
    closing = heldLine(names);
  }
  traces.push(...laid.out, ...held.map(({ entry, reason, close }) => trace(entry, false, `held back: ${reason}`, { weak: !close })));

  const blockTrace: LoreTrace = { picks: traces, chars: laid.used + closing.length, budgetChars: budget };
  if (!laid.lines.length && !closing) {
    return { text: "", trace: blockTrace };
  }
  // Retrieval keeps only close matches (lore-selection.ts), but close is
  // still relative, so the DM is told what it got.
  const pickedNote = laid.shown
    ? ". The entries picked for this moment are the nearest matches, nearest first; use only those that bear on it"
    : "";
  return {
    text: `WORLD LORE (established by the party lead; treat as canon${pickedNote}):\n${[...laid.lines, ...(closing ? [closing] : [])].join("\n")}`,
    trace: blockTrace,
  };
}

// The block for entries already chosen, in order: pinned, then the rest.
export function renderLoreForPrompt(
  pinned: WorldLoreEntry[],
  retrieved: WorldLoreEntry[],
  budget = 1_600,
): string {
  return renderLoreBlock({
    pinned,
    picked: retrieved.map((entry) => ({ entry, reason: "retrieved" })),
    budget,
  }).text;
}
