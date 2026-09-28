import authoredFeatsJson from "@/lib/srd/authored-feats.json";
import type { ContentEntry } from "@/lib/content";

// ODM's own feats (src/lib/srd/authored-feats.json) as picker rows, for the
// feats the content pack does not serve. The importer copies the list into
// the pack as document "odm-expanded", but it skips a name the pack already
// holds, and the pack's only Alert is a 2024 row that is never offered
// (src/lib/content/edition.ts). So the 2014 Alert reaches the builder and the
// level-up only from here, and a server with no pack still has every feat
// ODM wrote. Rows are matched by name: a feat the pack serves is not listed
// twice. Pure: no database.

export const AUTHORED_FEAT_DOCUMENT = "odm-expanded";

type AuthoredFeat = { name: string; prerequisite: string; desc: string };

const FEATS = (authoredFeatsJson as { feats: AuthoredFeat[] }).feats;

// The slug a picker asks the detail route for (src/lib/help contentSlug).
export function authoredFeatSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function entryOf(feat: AuthoredFeat): ContentEntry {
  return {
    slug: authoredFeatSlug(feat.name),
    name: feat.name,
    source: "open5e",
    documentSlug: AUTHORED_FEAT_DOCUMENT,
    // The importer stores the same object as the row's data.
    data: { ...feat },
  };
}

// The authored feats whose names contain `q`, sorted by name.
export function authoredFeatEntries(q?: string): ContentEntry[] {
  const wanted = (q ?? "").trim().toLowerCase();
  return FEATS.filter((feat) => feat.name.toLowerCase().includes(wanted))
    .map(entryOf)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The pack's page with the authored feats it lacks folded in, in name order.
// `packNames` is every name the pack serves for this search, on any page.
// Only the first page takes the missing ones, so a picker paging through the
// list meets each feat once.
export function withAuthoredFeats(
  served: ContentEntry[],
  options: { q?: string; offset?: number; packNames: string[] },
): ContentEntry[] {
  if ((options.offset ?? 0) > 0) {
    return served;
  }
  const names = new Set(options.packNames.map((name) => name.trim().toLowerCase()));
  const missing = authoredFeatEntries(options.q).filter(
    (entry) => !names.has(entry.name.toLowerCase()),
  );
  if (!missing.length) {
    return served;
  }
  return [...served, ...missing].sort((a, b) => a.name.localeCompare(b.name));
}

// The authored feat a detail link names, by its slug or its "odm-" slug.
export function authoredFeatBySlug(slug: string): ContentEntry | null {
  const wanted = slug.replace(/^odm-/, "");
  const feat = FEATS.find((entry) => authoredFeatSlug(entry.name) === wanted);
  return feat ? entryOf(feat) : null;
}
