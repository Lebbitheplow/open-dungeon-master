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

import {
  IMPORT_KINDS,
  IMPORT_KIND_LABELS,
  SINGULAR_KINDS,
  WORLD_RECORD_KINDS,
  withRequired,
  type AgainMode,
  type ArcMode,
  type BoardFacts,
  type ImportExisting,
  type ImportKind,
  type ImportPlan,
  type ImportPlanItem,
  type ImportSource,
  type ImportWarning,
  type LinkKind,
  type TargetArc,
  type WorldRecordFacts,
  type WorldRecordKind,
} from "./import-kinds.ts";
import { planBoard } from "./import-board.ts";
import { textKey } from "../language/text-logic.ts";

export * from "./import-kinds.ts";

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
  if (!taken.has(textKey(trimmed))) {
    taken.add(textKey(trimmed));
    return trimmed;
  }
  for (let attempt = 2; attempt < 1000; attempt += 1) {
    const candidate = `${trimmed} (${attempt})`;
    if (!taken.has(textKey(candidate))) {
      taken.add(textKey(candidate));
      return candidate;
    }
  }
  // A thousand copies of one name is not a real table; fall back to
  // something unique rather than looping or throwing.
  const fallback = `${trimmed} (${Date.now()})`;
  taken.add(textKey(fallback));
  return fallback;
}

export type PlanInput = {
  selection: readonly ImportKind[];
  source: ImportSource;
  existing: ImportExisting;
  // Whether the target already has house-rules prose. Only consulted for the
  // houseRules kind, which has no name to collide on.
  targetHasHouseRules?: boolean;
  // Whether the target already has a story arc. Only consulted for the
  // storyboard kind: an arc the table has been playing is never written
  // over, only added to as a new act when the DM asks for that. `targetArc`
  // carries the detail; `targetHasArc` alone is the older, coarser input.
  targetHasArc?: boolean;
  targetArc?: TargetArc | null;
  arcMode?: ArcMode;
  // Source rows an earlier import already brought into the target, per
  // kind (src/lib/db/content-origins.ts), and what to do with them.
  alreadyHere?: Partial<Record<ImportKind, string[]>>;
  again?: AgainMode;
  // The shared-workshop rows the target already holds a copy of.
  commonHere?: Partial<Record<LinkKind, string[]>>;
  // The board, when the source has one.
  board?: BoardFacts | null;
  // Kinds WorldForge needs that the DM chose to leave behind (WF-07), and
  // what the world says about each, so the exclusion names its losses.
  exclude?: readonly ImportKind[];
  worldFacts?: Partial<Record<WorldRecordKind, WorldRecordFacts>>;
  // Hand-built monsters the copied NPCs and fights name that this table's
  // authors do not have: copied into its bestiary on import (WF-07). Absent
  // when the caller did not look, and the old warning stands.
  foreignMonsters?: string[];
  // Hand-built items the travelling World entries link to that this table's
  // authors do not have: copied into its Homebrew on import.
  foreignItems?: string[];
};

export function planImport(input: PlanInput): ImportPlan {
  const selected = new Set(withRequired(input.selection, input.exclude));
  const items: ImportPlanItem[] = [];
  const warnings: ImportWarning[] = [];
  const notes: ImportWarning[] = [];
  const counts = Object.fromEntries(IMPORT_KINDS.map((kind) => [kind, 0])) as Record<
    ImportKind,
    number
  >;
  const again = input.again ?? "skip";
  const here = (kind: ImportKind, id: string | undefined) =>
    Boolean(id) && (input.alreadyHere?.[kind] ?? []).includes(id as string);
  // Whether a source row will exist at the target once this import is done:
  // travelling now, or brought by an earlier import.
  const arrives = (kind: ImportKind, id: string | undefined) =>
    Boolean(id) &&
    ((selected.has(kind) && (input.source[kind] ?? []).some((row) => row.id === id)) || here(kind, id));
  let kept = 0;
  let boardPlan: ImportPlan["board"] = null;

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
      if (input.board) {
        boardPlan = planBoard(input, input.board, arrives, warnings, notes);
      } else if (input.targetHasArc || input.targetArc) {
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

    if (kind === "world") {
      // WorldForge describes the records, and brings them unless the DM
      // leaves one kind out on purpose. A link, a secret or a pin whose
      // record stays behind is dropped rather than left pointing at the
      // workshop's row, and the exclusion says exactly what goes.
      const brought = WORLD_RECORD_KINDS.filter((other) => !input.selection.includes(other) && selected.has(other) && (input.source[other] ?? []).length);
      if (brought.length) {
        notes.push({
          kind,
          message: `WorldForge brings what it describes: ${brought.map((other) => IMPORT_KIND_LABELS[other].toLowerCase()).join(", ")} come with it.`,
        });
      }
      for (const other of WORLD_RECORD_KINDS) {
        if (selected.has(other) || !(input.source[other] ?? []).length) continue;
        const facts = input.worldFacts?.[other];
        warnings.push({ kind, message: facts ? leftOut(IMPORT_KIND_LABELS[other], facts) : `WorldForge's links, secrets and pins for ${IMPORT_KIND_LABELS[other].toLowerCase()} stay behind with them.` });
      }
      items.push({ kind, sourceId: rows[0].id, name: rows[0].name, finalName: rows[0].name, renamed: false });
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

    const taken = new Set((input.existing[kind] ?? []).map((name) => textKey(name)));
    let renamedCount = 0;
    let keptCount = 0;
    for (const row of rows) {
      // A row an earlier import brought is kept as the campaign has it, edits
      // and all, rather than arriving again as "(2)" (#157, #159).
      if (again === "skip" && here(kind, row.id)) {
        keptCount += 1;
        items.push({ kind, sourceId: row.id, name: row.name, finalName: row.name, renamed: false, kept: true });
        continue;
      }
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
    if (keptCount) {
      kept += keptCount;
      notes.push({
        kind,
        message: `${keptCount} ${IMPORT_KIND_LABELS[kind].toLowerCase()} entr${keptCount === 1 ? "y" : "ies"} came in from here before and stay${keptCount === 1 ? "s" : ""} as this campaign has ${keptCount === 1 ? "it" : "them"}.`,
      });
    } else if (again === "copy" && rows.some((row) => here(kind, row.id))) {
      notes.push({
        kind,
        message: `${IMPORT_KIND_LABELS[kind]} that came in from here before arrive again as second copies.`,
      });
    }

    // A fight or a place bound to a battle map that will not be here: the
    // copy is unbound rather than left pointing at the source's map (#153).
    if (kind === "encounters" || kind === "locations") {
      const unbound = rows.filter(
        (row) => row.mapId && !(again === "skip" && here(kind, row.id)) && !arrives("maps", row.mapId),
      ).length;
      if (unbound) {
        warnings.push({
          kind,
          message:
            kind === "encounters"
              ? `${unbound} prepared encounter${unbound === 1 ? " is" : "s are"} drawn on a battle map that is not coming along. ${unbound === 1 ? "It arrives" : "They arrive"} without it and deploy${unbound === 1 ? "s" : ""} on a map made from ${unbound === 1 ? "its" : "their"} own settings; tick Battle maps to keep ${unbound === 1 ? "it" : "them"} bound.`
              : `${unbound} place${unbound === 1 ? " stands" : "s stand"} on a battle map that is not coming along, and arrive${unbound === 1 ? "s" : ""} without it; tick Battle maps to keep ${unbound === 1 ? "it" : "them"}.`,
        });
      }
    }

    if (kind === "shops") {
      planShops(rows, (row) => !(again === "skip" && here(kind, row.id)), arrives, warnings, notes);
    }

    if (kind === "encounters" && !input.foreignMonsters) {
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
  // Places an earlier import brought still count as here.
  if (
    selected.has("overworld") &&
    !selected.has("locations") &&
    input.source.locations.some((location) => !here("locations", location.id))
  ) {
    warnings.push({
      kind: "overworld",
      message:
        "Places are not included, so the region map arrives without its markers. It will place them again as the party travels.",
    });
  }

  // Hand-built monsters this table's authors do not have travel with the
  // NPCs and fights that name them (WF-07): said before, so nothing about
  // the bestiary changes unannounced.
  if (input.foreignItems?.length) {
    const names = [...new Set(input.foreignItems)];
    notes.push({
      kind: "world",
      message: `${names.length} hand-built item${names.length === 1 ? "" : "s"} (${names.join(", ")}) ${names.length === 1 ? "is" : "are"} copied into this table's Homebrew, so the World entries that link to ${names.length === 1 ? "it" : "them"} keep their links.`,
    });
  }
  if (input.foreignMonsters?.length) {
    const names = [...new Set(input.foreignMonsters)];
    notes.push({
      kind: selected.has("encounters") ? "encounters" : "npcs",
      message: `${names.length} hand-built monster${names.length === 1 ? "" : "s"} (${names.join(", ")}) ${names.length === 1 ? "is" : "are"} copied into this table's bestiary, so the NPCs and fights that name ${names.length === 1 ? "it" : "them"} fight here as they did there.`,
    });
  }

  return {
    items,
    counts,
    warnings,
    notes,
    kept,
    board: boardPlan,
    empty: items.every((item) => item.kept),
  };
}

// What the Market's shops lean on and bring (#171): a shop whose place is
// not coming along arrives unplaced, and opens wherever a place of that
// name is; a shop whose keeper is not coming arrives with nobody behind
// the counter. Only the shops this import will actually copy are counted.
function planShops(
  rows: ImportSource["shops"],
  copies: (row: ImportSource["shops"][number]) => boolean,
  arrives: (kind: ImportKind, id: string | undefined) => boolean,
  warnings: ImportWarning[],
  notes: ImportWarning[],
) {
  const copied = rows.filter(copies);
  const unplaced = copied.filter((row) => row.placeId && !arrives("locations", row.placeId)).length;
  const unkept = copied.filter((row) => row.keeperId && !arrives("npcs", row.keeperId)).length;
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
  if (unplaced) {
    warnings.push({
      kind: "shops",
      message: `${unplaced} shop${plural(unplaced, " stands", "s stand")} at a place that is not coming along. ${plural(unplaced, "It arrives", "They arrive")} unplaced and open${plural(unplaced, "s", "")} wherever a place of that name is; tick Places to keep ${plural(unplaced, "it", "them")} where ${plural(unplaced, "it stands", "they stand")}.`,
    });
  }
  if (unkept) {
    warnings.push({
      kind: "shops",
      message: `${unkept} shop${plural(unkept, "'s keeper is", "s' keepers are")} not coming along, so ${plural(unkept, "it arrives", "they arrive")} with nobody behind the counter; tick NPCs to bring ${plural(unkept, "the keeper", "them")}.`,
    });
  }
  const lines = copied.reduce((sum, row) => sum + (row.lines ?? 0), 0);
  if (copied.length) {
    notes.push({
      kind: "shops",
      message: `${copied.length} shop${plural(copied.length, "", "s")} with ${lines} stock line${plural(lines, "", "s")} arrive${plural(copied.length, "s", "")} as authored. Purchases, sales and haggles at a shop already here are never reset by an import.`,
    });
  }
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

// What leaving one kind of record out of a world import loses, counted.
function leftOut(label: string, facts: WorldRecordFacts): string {
  const parts = [
    [facts.entries, "World entry", "World entries"],
    [facts.links, "link", "links"],
    [facts.pins, "map pin", "map pins"],
    [facts.secrets, "secret's subject or knower", "secrets' subjects or knowers"],
    [facts.events, "mention in the timeline", "mentions in the timeline"],
  ] as const;
  const lost = parts.filter(([count]) => count > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  const list = lost.length > 1 ? `${lost.slice(0, -1).join(", ")} and ${lost[lost.length - 1]}` : lost[0] ?? "nothing more";
  return `Leaving out ${label.toLowerCase()}: WorldForge drops ${list} with them.`;
}
