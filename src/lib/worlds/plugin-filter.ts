// The plugin browser's filter: a search over the words an entry shows, its
// genre, and whether it is an original world or a fan work. Pure, so the
// admin panel and the tests share it, and client-safe (no zod, no fs).
import { compareNames, textKey } from "@/lib/language/text-logic";

export type PluginOrigin = "all" | "original" | "fan";

export type PluginFilter = {
  query: string;
  // A base genre id, or "" for every genre.
  genre: string;
  origin: PluginOrigin;
};

export const NO_PLUGIN_FILTER: PluginFilter = { query: "", genre: "", origin: "all" };

// The fields a registry entry, a prepared world and an installed pack share
// closely enough to filter alike.
export type FilterablePlugin = {
  name: string;
  blurb: string;
  franchise?: string;
  edition?: string;
  author?: string;
  inspiredBy?: string;
  baseGenre?: string;
  rightsHolder?: string;
};

// A pack that names a rights holder is built on somebody else's setting
// (docs/worlds.md, "Attribution and the unofficial notice").
export function isFanWork(entry: FilterablePlugin): boolean {
  return Boolean(entry.rightsHolder?.trim());
}

export function isFiltering(filter: PluginFilter): boolean {
  return Boolean(filter.query.trim() || filter.genre || filter.origin !== "all");
}

// Every word of the query has to appear somewhere in what the entry shows,
// compared the way names are elsewhere (case and composed accents folded).
export function filterPlugins<T extends FilterablePlugin>(entries: readonly T[], filter: PluginFilter): T[] {
  const words = textKey(filter.query).split(" ").filter(Boolean);
  return entries.filter((entry) => {
    if (filter.genre && entry.baseGenre !== filter.genre) {
      return false;
    }
    if (filter.origin === "original" && isFanWork(entry)) {
      return false;
    }
    if (filter.origin === "fan" && !isFanWork(entry)) {
      return false;
    }
    if (!words.length) {
      return true;
    }
    const haystack = textKey(
      [entry.name, entry.blurb, entry.franchise, entry.edition, entry.author, entry.inspiredBy].filter(Boolean).join(" "),
    );
    return words.every((word) => haystack.includes(word));
  });
}

// The genres the entries actually use, so the genre picker never offers one
// that would empty the list.
export function genresOf(entries: readonly FilterablePlugin[]): string[] {
  return [...new Set(entries.map((entry) => entry.baseGenre ?? "").filter(Boolean))].sort(compareNames);
}

// "high_fantasy" as a person reads it.
export function genreName(genre: string): string {
  return genre.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
