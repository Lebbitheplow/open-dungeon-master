// Planning an import from a workshop into a campaign.
//
// Copying rows between two campaign ids is the easy half. This module is the
// hard half: deciding what the copy will be CALLED when the target already
// has something by that name, and saying out loud what an import is about to
// overwrite. `locations` has a UNIQUE (campaign_id, name) constraint, so a
// collision there is not a cosmetic problem, it is a failed transaction.
//
// Pure by design: no "@/" imports and no I/O, so
// scripts/test-workshop-import.mjs can drive the whole decision table
// without a database. The rim that actually writes rows is
// src/lib/db/content-import.ts.

// The kinds a workshop can hand to a campaign. Each one already has a
// campaign-side table to become, which is the test for whether a kind
// belongs here at all.
export const IMPORT_KINDS = [
  "lore",
  "locations",
  "overworld",
  "encounters",
  "tables",
  "npcs",
  "maps",
  "storyboard",
  "houseRules",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  lore: "World lore",
  locations: "Places",
  overworld: "Region map",
  encounters: "Prepared encounters",
  tables: "Roll tables",
  npcs: "NPCs",
  maps: "Battle maps",
  storyboard: "The storyboard",
  houseRules: "House rules and variant rules",
};

// Kinds that are one-per-campaign rather than a list. Importing one of these
// does not add, it replaces, and that is worth saying before the button is
// pressed rather than after.
export const SINGULAR_KINDS: ReadonlySet<ImportKind> = new Set([
  "overworld",
  "houseRules",
  // The storyboard is not copied, it is COMPILED: one board becomes lore,
  // quests, prepared encounters, DM notes and an arc
  // (src/lib/workshop/board-compile.ts). One row in, many rows out, which
  // makes it singular for planning purposes even though it creates plenty.
  "storyboard",
]);

// Only encounter rows carry `monsters`: the roster's monster references, so
// the planner can warn when one is a homebrew slug (`homebrew:<id>`), which
// is user-scoped and does not travel with an import. A homebrew referenced by
// its typed display name is indistinguishable from any unknown name at plan
// time; the warning covers the slug form the pickers write.
export type NamedRow = { id: string; name: string; monsters?: string[] };

// What the workshop holds, per kind. The singular kinds carry a single
// row-or-nothing, expressed as a list of length 0 or 1 so the planner has
// one shape to walk.
export type ImportSource = Record<ImportKind, NamedRow[]>;

// The names already present at the target, per kind, lowercased by the
// caller or not: the planner compares case-insensitively either way, because
// the locations constraint is COLLATE NOCASE.
export type ImportExisting = Record<ImportKind, string[]>;

export type ImportPlanItem = {
  kind: ImportKind;
  sourceId: string;
  name: string;
  // What it will be called at the target, after collisions are resolved.
  finalName: string;
  renamed: boolean;
};

export type ImportWarning = { kind: ImportKind; message: string };

export type ImportPlan = {
  items: ImportPlanItem[];
  counts: Record<ImportKind, number>;
  warnings: ImportWarning[];
  // Nothing selected, or everything selected was empty.
  empty: boolean;
};

export function emptySource(): ImportSource {
  return Object.fromEntries(
    IMPORT_KINDS.map((kind) => [kind, [] as NamedRow[]]),
  ) as ImportSource;
}

export function emptyExisting(): ImportExisting {
  return Object.fromEntries(
    IMPORT_KINDS.map((kind) => [kind, [] as string[]]),
  ) as ImportExisting;
}

// "Rusted Anchor Inn" against a target that already has one becomes
// "Rusted Anchor Inn (2)". Suffixing rather than refusing keeps an import
// from failing on one collision out of forty, and keeps the DM's own name
// recognisable, which a uuid suffix would not.
//
// `taken` is consulted and extended case-insensitively, so two workshop rows
// that differ only in case cannot both land on a table whose constraint is
// COLLATE NOCASE.
export function dedupeName(name: string, taken: Set<string>): string {
  const trimmed = name.trim() || "Untitled";
  if (!taken.has(trimmed.toLowerCase())) {
    taken.add(trimmed.toLowerCase());
    return trimmed;
  }
  for (let attempt = 2; attempt < 1000; attempt += 1) {
    const candidate = `${trimmed} (${attempt})`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
  // A thousand copies of one name is not a real table; fall back to
  // something unique rather than looping or throwing.
  const fallback = `${trimmed} (${Date.now()})`;
  taken.add(fallback.toLowerCase());
  return fallback;
}

export function planImport(input: {
  selection: readonly ImportKind[];
  source: ImportSource;
  existing: ImportExisting;
  // Whether the target already has house-rules prose. Only consulted for the
  // houseRules kind, which has no name to collide on.
  targetHasHouseRules?: boolean;
  // Whether the target already has a story arc. Only consulted for the
  // storyboard kind, and only to warn: an arc the table has been playing is
  // never written over.
  targetHasArc?: boolean;
}): ImportPlan {
  const selected = new Set(input.selection);
  const items: ImportPlanItem[] = [];
  const warnings: ImportWarning[] = [];
  const counts = Object.fromEntries(IMPORT_KINDS.map((kind) => [kind, 0])) as Record<
    ImportKind,
    number
  >;

  for (const kind of IMPORT_KINDS) {
    if (!selected.has(kind)) {
      continue;
    }
    const rows = input.source[kind] ?? [];
    if (!rows.length) {
      continue;
    }
    counts[kind] = rows.length;

    if (kind === "houseRules") {
      if (input.targetHasHouseRules) {
        warnings.push({
          kind,
          message:
            "This campaign already has house rules. Importing replaces them unless you choose to add.",
        });
      }
      items.push({
        kind,
        sourceId: rows[0].id,
        name: rows[0].name,
        finalName: rows[0].name,
        renamed: false,
      });
      continue;
    }

    if (kind === "storyboard") {
      if (input.targetHasArc) {
        warnings.push({
          kind,
          message:
            "This campaign already has a story arc. The board's places, quests, fights and notes still land; its beats do not overwrite the spine the table has been playing.",
        });
      }
      items.push({
        kind,
        sourceId: rows[0].id,
        name: rows[0].name,
        finalName: rows[0].name,
        renamed: false,
      });
      continue;
    }

    if (kind === "overworld") {
      if (input.existing.overworld.length) {
        warnings.push({
          kind,
          message: "This campaign already has a region map. Importing replaces it.",
        });
      }
      items.push({
        kind,
        sourceId: rows[0].id,
        name: rows[0].name,
        finalName: rows[0].name,
        renamed: false,
      });
      continue;
    }

    const taken = new Set((input.existing[kind] ?? []).map((name) => name.trim().toLowerCase()));
    let renamedCount = 0;
    for (const row of rows) {
      const finalName = dedupeName(row.name, taken);
      const renamed = finalName !== (row.name.trim() || "Untitled");
      if (renamed) {
        renamedCount += 1;
      }
      items.push({ kind, sourceId: row.id, name: row.name, finalName, renamed });
    }
    if (renamedCount) {
      warnings.push({
        kind,
        message: `${renamedCount} ${IMPORT_KIND_LABELS[kind].toLowerCase()} entr${renamedCount === 1 ? "y" : "ies"} already exist here by name and will be numbered.`,
      });
    }

    if (kind === "encounters") {
      const homebrewCount = rows.filter((row) =>
        row.monsters?.some((ref) => ref.trim().startsWith("homebrew:")),
      ).length;
      if (homebrewCount) {
        warnings.push({
          kind,
          message: `${homebrewCount} prepared encounter${homebrewCount === 1 ? "" : "s"} name${homebrewCount === 1 ? "s" : ""} hand-built monsters. Those live in their builder's bestiary rather than travelling, so the roster only resolves where the campaign owner is the same builder.`,
        });
      }
    }
  }

  // The region map anchors places by id. Bringing the map without the places
  // it points at would land a map whose markers reference nothing, so the
  // anchors are dropped and the map re-places them as the party travels.
  if (selected.has("overworld") && !selected.has("locations") && input.source.locations.length) {
    warnings.push({
      kind: "overworld",
      message:
        "Places are not included, so the region map arrives without its markers. It will place them again as the party travels.",
    });
  }

  return {
    items,
    counts,
    warnings,
    empty: items.length === 0,
  };
}

// Whether the planned import should carry the region map's anchors across.
// Anchors are keyed by location id, so they only survive when the locations
// they name are travelling with them.
export function keepsOverworldAnchors(selection: readonly ImportKind[]): boolean {
  return selection.includes("overworld") && selection.includes("locations");
}

export function planSummary(plan: ImportPlan): string {
  const parts = IMPORT_KINDS.filter((kind) => plan.counts[kind] > 0).map((kind) =>
    SINGULAR_KINDS.has(kind)
      ? IMPORT_KIND_LABELS[kind].toLowerCase()
      : `${plan.counts[kind]} ${IMPORT_KIND_LABELS[kind].toLowerCase()}`,
  );
  return parts.length ? parts.join(", ") : "nothing";
}
