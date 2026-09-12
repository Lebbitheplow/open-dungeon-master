// The client-facing slice of a world pack: the summary the pickers list and
// the grouping the campaign wizard draws. Kept apart from ./types so a page
// that only lists packs (the home dashboard's create dialog) does not carry
// the zod schemas, which are the bulk of that module.
import type { WorldPack } from "@/lib/worlds/types";
import { packArtUrl } from "@/lib/worlds/art";

// Where a pack came from. Bundled packs ship with the app under its MIT
// license and are always original works; installed packs were added by an
// admin from a registry or a file and are the user's own responsibility.
// Only installed packs can be removed.
export type WorldPackSource = "bundled" | "installed";

// The subset the campaign-creation picker, the lobby panel and the plugin
// browser need. Listing every pack in full would ship every reskin table to
// the client for packs nobody selected.
export type WorldPackSummary = Pick<
  WorldPack,
  | "id"
  | "name"
  | "blurb"
  | "version"
  | "author"
  | "homepage"
  | "inspiredBy"
  | "rightsHolder"
  | "franchise"
  | "edition"
  | "editionOrder"
  | "baseGenre"
  | "theme"
  | "premise"
> & {
  source: WorldPackSource;
  // The cover thumbnail's URL, or "" when the pack carries none and the
  // picker draws the genre plate instead.
  cover: string;
};

export function summarizePack(
  pack: WorldPack,
  source: WorldPackSource = "installed",
): WorldPackSummary {
  return {
    id: pack.id,
    name: pack.name,
    blurb: pack.blurb,
    version: pack.version,
    author: pack.author,
    homepage: pack.homepage,
    inspiredBy: pack.inspiredBy,
    rightsHolder: pack.rightsHolder,
    franchise: pack.franchise,
    edition: pack.edition,
    editionOrder: pack.editionOrder,
    baseGenre: pack.baseGenre,
    theme: pack.theme,
    premise: pack.premise,
    source,
    cover: pack.artKeys.includes("cover") ? packArtUrl(pack.id, "cover", pack.version) : "",
  };
}

export type FranchiseGroup = {
  franchise: string;
  editions: WorldPackSummary[];
};

// Packs grouped for the picker: one button per franchise, and a second row of
// edition buttons for the franchises that have more than one. Pure so the
// dialog and its test agree on the ordering.
export function groupByFranchise(packs: WorldPackSummary[]): FranchiseGroup[] {
  const groups = new Map<string, WorldPackSummary[]>();
  for (const pack of packs) {
    const existing = groups.get(pack.franchise);
    if (existing) {
      existing.push(pack);
    } else {
      groups.set(pack.franchise, [pack]);
    }
  }
  return [...groups.entries()]
    .map(([franchise, editions]) => ({
      franchise,
      editions: [...editions].sort(
        (a, b) => a.editionOrder - b.editionOrder || a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => a.franchise.localeCompare(b.franchise));
}
