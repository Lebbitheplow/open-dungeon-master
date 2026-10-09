// The vocabulary of a content import: the kinds a workshop can hand to a
// campaign, what the planner is told about the source, the target and the
// board, and the plan it hands back. Split from src/lib/workshop/import.ts
// (which re-exports all of it) to keep the planner under the project's
// 500-line cap. Pure, like the planner: no "@/" imports and no I/O.

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
  // Shops with their place, keeper, policy and shelf (#171).
  "shops",
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
  shops: "Market",
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
//
// Encounters and places carry `mapId`, the prepared map they are bound to,
// so the planner can say before the button which of them will arrive
// without it (#153).
//
// Shops carry the place they stand at, their keeper and how many lines
// their shelf holds, so the planner can say which shops arrive unplaced or
// unkept and what stock comes with them (#171).
export type NamedRow = {
  id: string;
  name: string;
  monsters?: string[];
  mapId?: string;
  placeId?: string;
  keeperId?: string;
  lines?: number;
};

// What a storyboard card can point at, as the import kinds those rows are.
export const LINK_KINDS = ["npcs", "maps", "encounters", "locations"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_WORDS: Record<LinkKind, string> = {
  npcs: "people (Who)",
  maps: "battle maps (On which map)",
  encounters: "prepared fights",
  locations: "places (Where)",
};

// What the source's storyboard will need, worked out by the rim from the
// compiled board (src/lib/db/content-import.ts) so this module can stay
// pure. Every id is a row in the source workshop, or in its shared workshop.
export type BoardFacts = {
  // Every row a card links to, by kind.
  links: Record<LinkKind, string[]>;
  // The links that point into the source's shared workshop rather than the
  // source itself (#159), and what that workshop is called.
  common: { title: string; links: Record<LinkKind, string[]> } | null;
  // The arc beats the board compiles to, in reading order.
  beats: string[];
  // Scenes on an alternative or optional route, which arrive as planned
  // moments rather than required beats (#157).
  moments: number;
  // Why the board cannot make an arc of its own, or "" when it can.
  arcProblem: string;
};

// The arc a campaign already has, for a board joining it as a new act.
export type TargetArc = {
  beats: string[];
  acts: number;
  // How many more beats and whether another act fit under the arc's caps
  // (src/lib/dm/arc-logic.ts).
  room: number;
  actRoom: boolean;
};

// What happens to a board's beats when the campaign already has an arc:
// left alone (the only behaviour before #157), or added as the next act.
export type ArcMode = "leave" | "append";

// What happens to a row an earlier import already brought in from the same
// source: kept as the campaign has it, or copied again under a number.
export type AgainMode = "skip" | "copy";

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
  // Already brought in by an earlier import and kept as the campaign has it.
  kept?: boolean;
};

export type ImportWarning = { kind: ImportKind; message: string };

export type ImportPlan = {
  items: ImportPlanItem[];
  counts: Record<ImportKind, number>;
  // What the import will lose or cannot carry, said before the button.
  warnings: ImportWarning[];
  // What it will do that is worth knowing but loses nothing: rows kept from
  // an earlier import, shared records reused, routes becoming moments.
  notes: ImportWarning[];
  // Rows an earlier import already brought, across every kind.
  kept: number;
  // How the board meets the campaign's arc, for the picker's arc control.
  board: { targetHasArc: boolean; arcMode: ArcMode; beats: number; newBeats: number; act: number } | null;
  // Nothing selected, or everything selected was empty or already here.
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
