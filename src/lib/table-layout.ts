// The play table's arrangement, kept per browser (client issue 46): where
// the table, the party portraits, the side panel and any side-panel tab
// given a pane of its own sit, how wide and tall each is, which are out of
// sight, and whether the whole is locked. Nothing here is campaign data: it
// only says where this browser draws what it already draws, so a layout can
// never change what anyone sees, may do, or has written.
//
// The model is a row of columns, left to right, each a stack of panes, top
// to bottom, each pane a share of its column's height. The column holding
// the table (the transcript and the composer, or the fight stage) takes the
// width the others leave; every other column keeps its own width in pixels.
// A pane can also float over the row, placed in fractions of it, so a
// smaller window cannot leave it outside. A saved arrangement that does not
// read back as one of these (an older version, a hand edit, a missing
// table) is the default again.
//
// Pure by design (no React, no runtime "@/" imports) so
// scripts/test-table-layout.mjs can import it directly. The store is
// src/app/campaigns/[campaignId]/table-layout-store.ts, where things land
// in pixels table-layout-geometry.ts, and the drawing TableLayout.tsx.

import type { TableTabId } from "./dm/table-tabs";

export const TABLE_LAYOUT_VERSION = 1;

// Every side-panel tab, in the rail's order (src/lib/dm/table-tabs.ts
// TABLE_TAB_IDS; scripts/test-table-tabs.mjs keeps the two the same).
export const TAB_IDS: readonly TableTabId[] = [
  "dm",
  "lead",
  "party",
  "battle",
  "map",
  "story",
  "notes",
  "chat",
  "world",
  "context",
  "settings",
];

export type TabPaneId = `tab:${TableTabId}`;
export type PaneId = "table" | "rail" | "panel" | TabPaneId;

export type DockedPane = {
  id: PaneId;
  // Share of the column's height among the panes showing in it.
  size: number;
  // Out of the arrangement but still mounted, so a draft, a scroll or a
  // map's camera is where it was when the pane is shown again. The party
  // portraits alone read undefined as the table's own rule: shown where the
  // row is wide enough for them (world.css, .cine-party).
  hidden?: boolean;
};

export type LayoutColumn = { width: number | null; panes: DockedPane[] };

// Fractions of the row, so the pane keeps its place as the window changes.
export type FloatingPane = { id: PaneId; x: number; y: number; w: number; h: number; hidden?: boolean };

export type TableLayout = {
  version: typeof TABLE_LAYOUT_VERSION;
  locked: boolean;
  columns: LayoutColumn[];
  floating: FloatingPane[];
  // The fight stage's scroll, in pixels; null keeps the stage's own width.
  chronicle: number | null;
};

// The widths the table has always had (world.css .cine-party, SidePanel's
// 24rem and 30rem).
export const RAIL_WIDTH = 236;
export const PANEL_WIDTH = 384;
export const PANEL_WIDE = 480;
// A new column, and a column that stops holding the table.
export const PANE_WIDTH = 340;
export const MIN_COLUMN = 200;
export const MAX_COLUMN = 1400;
// The table keeps room for the transcript and the composer.
export const MIN_TABLE = 360;
export const MIN_PANE_HEIGHT = 120;
export const MIN_FLOAT_WIDTH = 280;
export const MIN_FLOAT_HEIGHT = 180;
export const MAX_COLUMNS = 4;
export const MAX_STACK = 4;
export const MAX_FLOATING = 4;
export const CHRONICLE_MIN = 200;
export const CHRONICLE_MAX = 720;
// world.css: the portraits show from a 1300px row up.
export const RAIL_AUTO_WIDTH = 1300;

export function defaultTableLayout(wide = false): TableLayout {
  return {
    version: TABLE_LAYOUT_VERSION,
    locked: false,
    columns: [
      { width: RAIL_WIDTH, panes: [{ id: "rail", size: 1 }] },
      { width: null, panes: [{ id: "table", size: 1 }] },
      { width: wide ? PANEL_WIDE : PANEL_WIDTH, panes: [{ id: "panel", size: 1 }] },
    ],
    floating: [],
    chronicle: null,
  };
}

export function tabPane(tab: TableTabId): TabPaneId {
  return `tab:${tab}`;
}

export function paneTab(id: PaneId): TableTabId | null {
  return id.startsWith("tab:") ? (id.slice(4) as TableTabId) : null;
}

export function isPaneId(value: unknown): value is PaneId {
  if (value === "table" || value === "rail" || value === "panel") return true;
  return typeof value === "string" && value.startsWith("tab:") && TAB_IDS.includes(value.slice(4) as TableTabId);
}

// The table's own shape: the portraits, the table and the side panel side
// by side, nothing floating, hidden or given a pane of its own. The table
// draws that with the flex row it always had (only the widths are the
// reader's), so a table nobody rearranged looks exactly as it did.
export function isDefaultShape(layout: TableLayout): boolean {
  const [rail, table, panel] = layout.columns;
  return (
    layout.columns.length === 3 &&
    layout.floating.length === 0 &&
    rail.panes.length === 1 &&
    rail.panes[0].id === "rail" &&
    rail.panes[0].hidden === undefined &&
    table.panes.length === 1 &&
    table.panes[0].id === "table" &&
    panel.panes.length === 1 &&
    panel.panes[0].id === "panel" &&
    !panel.panes[0].hidden
  );
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Every rule the drawing relies on, made true: the table docked exactly
// once and never hidden, the portraits and the side panel present, no pane
// twice, no empty column, no more columns, stacked panes or floating panes
// than the limits, sizes that add up, widths and fractions in range. A
// value that cannot be repaired that way is the fallback.
export function normalizeTableLayout(raw: unknown, fallback: TableLayout = defaultTableLayout()): TableLayout {
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Record<string, unknown>;
  if (value.version !== TABLE_LAYOUT_VERSION || !Array.isArray(value.columns)) return fallback;
  const seen = new Set<PaneId>();
  const columns: LayoutColumn[] = [];
  for (const entry of value.columns) {
    if (!entry || typeof entry !== "object" || columns.length >= MAX_COLUMNS) continue;
    const column = entry as Record<string, unknown>;
    const panes: DockedPane[] = [];
    for (const item of Array.isArray(column.panes) ? column.panes : []) {
      if (!item || typeof item !== "object" || panes.length >= MAX_STACK) continue;
      const pane = item as Record<string, unknown>;
      if (!isPaneId(pane.id) || seen.has(pane.id)) continue;
      seen.add(pane.id);
      const docked: DockedPane = { id: pane.id, size: finite(pane.size) && pane.size > 0 ? pane.size : 1 };
      if (typeof pane.hidden === "boolean" && pane.id !== "table") docked.hidden = pane.hidden;
      panes.push(docked);
    }
    if (panes.length) {
      columns.push({ width: finite(column.width) ? column.width : null, panes });
    }
  }
  if (!seen.has("table")) return fallback;
  const floating: FloatingPane[] = [];
  for (const item of Array.isArray(value.floating) ? value.floating : []) {
    if (!item || typeof item !== "object" || floating.length >= MAX_FLOATING) continue;
    const pane = item as Record<string, unknown>;
    if (!isPaneId(pane.id) || pane.id === "table" || seen.has(pane.id)) continue;
    if (![pane.x, pane.y, pane.w, pane.h].every(finite)) continue;
    seen.add(pane.id);
    const placed: FloatingPane = {
      id: pane.id,
      x: pane.x as number,
      y: pane.y as number,
      w: pane.w as number,
      h: pane.h as number,
    };
    if (pane.hidden === true) placed.hidden = true;
    floating.push(placed);
  }
  if (!seen.has("rail") || !seen.has("panel")) return fallback;
  return tidyLayout({
    version: TABLE_LAYOUT_VERSION,
    locked: value.locked === true,
    columns,
    floating,
    chronicle: finite(value.chronicle) ? value.chronicle : null,
  });
}

// What every edit ends with: empty columns gone, the table's column the
// flexible one, widths, sizes and fractions in range.
export function tidyLayout(layout: TableLayout): TableLayout {
  const columns = layout.columns
    .filter((column) => column.panes.length > 0)
    .map((column) => {
      const holdsTable = column.panes.some((pane) => pane.id === "table");
      const total = column.panes.reduce((sum, pane) => sum + pane.size, 0);
      return {
        width: holdsTable ? null : clamp(Math.round(column.width ?? PANE_WIDTH), MIN_COLUMN, MAX_COLUMN),
        panes: column.panes.map((pane) => {
          const next: DockedPane = { ...pane, size: total > 0 ? pane.size / total : 1 / column.panes.length };
          if (pane.id === "table") delete next.hidden;
          return next;
        }),
      };
    });
  const floating = layout.floating.map((pane) => {
    const w = clamp(pane.w, 0.1, 1);
    const h = clamp(pane.h, 0.1, 1);
    return { ...pane, w, h, x: clamp(pane.x, 0, 1 - w), y: clamp(pane.y, 0, 1 - h) };
  });
  return {
    ...layout,
    columns,
    floating,
    chronicle: layout.chronicle === null ? null : clamp(Math.round(layout.chronicle), CHRONICLE_MIN, CHRONICLE_MAX),
  };
}

type Where = { column: number; index: number } | { floating: number };

export function locatePane(layout: TableLayout, id: PaneId): Where | null {
  for (let column = 0; column < layout.columns.length; column += 1) {
    const index = layout.columns[column].panes.findIndex((pane) => pane.id === id);
    if (index >= 0) return { column, index };
  }
  const floating = layout.floating.findIndex((pane) => pane.id === id);
  return floating >= 0 ? { floating } : null;
}

// The side-panel tabs that have a pane of their own, shown or not.
export function poppedTabs(layout: TableLayout): TableTabId[] {
  const tabs: TableTabId[] = [];
  for (const column of layout.columns) {
    for (const pane of column.panes) {
      const tab = paneTab(pane.id);
      if (tab) tabs.push(tab);
    }
  }
  for (const pane of layout.floating) {
    const tab = paneTab(pane.id);
    if (tab) tabs.push(tab);
  }
  return tabs;
}

export function isPaneHidden(layout: TableLayout, id: PaneId): boolean {
  const where = locatePane(layout, id);
  if (!where) return false;
  return "floating" in where
    ? layout.floating[where.floating].hidden === true
    : layout.columns[where.column].panes[where.index].hidden === true;
}

// Every pane set aside with Hide, for the way to show it again.
export function hiddenPanes(layout: TableLayout): PaneId[] {
  return [
    ...layout.columns.flatMap((column) => column.panes.filter((pane) => pane.hidden === true).map((pane) => pane.id)),
    ...layout.floating.filter((pane) => pane.hidden === true).map((pane) => pane.id),
  ];
}

export function copyLayout(layout: TableLayout): TableLayout {
  return {
    ...layout,
    columns: layout.columns.map((column) => ({ ...column, panes: column.panes.map((pane) => ({ ...pane })) })),
    floating: layout.floating.map((pane) => ({ ...pane })),
  };
}

// Takes a pane out of wherever it is (its column closes if it was alone
// there), returning what it carried: whether it was hidden, and its width
// when it was a column of its own.
function lift(layout: TableLayout, id: PaneId): { rest: TableLayout; hidden?: boolean; width: number | null } {
  const next = copyLayout(layout);
  const where = locatePane(next, id);
  if (!where) return { rest: next, width: null };
  if ("floating" in where) {
    const [pane] = next.floating.splice(where.floating, 1);
    return { rest: next, hidden: pane.hidden, width: null };
  }
  const column = next.columns[where.column];
  const [pane] = column.panes.splice(where.index, 1);
  const alone = column.panes.length === 0;
  if (alone) next.columns.splice(where.column, 1);
  return { rest: next, hidden: pane.hidden, width: alone ? column.width : null };
}

export type DockEdge = "top" | "bottom" | "left" | "right" | "center";
export type DockTarget = { pane: PaneId; edge: DockEdge } | { edge: "start" | "end" };

// Docks a pane against another (above it, below it, in a new column on
// either side of its column, or swapping places with it) or in a new
// column at either end of the row. Null when the move is not possible: a
// full column or row, the table set afloat, a pane against itself.
export function dockPane(layout: TableLayout, id: PaneId, target: DockTarget): TableLayout | null {
  if ("pane" in target && target.pane === id) return null;
  const from = locatePane(layout, id);
  if (!from) return null;
  if ("pane" in target && target.edge === "center") {
    const other = locatePane(layout, target.pane);
    if (!other || "floating" in other || "floating" in from) return null;
    const next = copyLayout(layout);
    const a = next.columns[from.column].panes[from.index];
    const b = next.columns[other.column].panes[other.index];
    next.columns[from.column].panes[from.index] = { ...b, size: a.size };
    next.columns[other.column].panes[other.index] = { ...a, size: b.size };
    return tidyLayout(next);
  }
  const { rest, hidden, width } = lift(layout, id);
  const moved: DockedPane = { id, size: 1 };
  if (hidden !== undefined && id !== "table") moved.hidden = hidden;
  if ("pane" in target) {
    const at = locatePane(rest, target.pane);
    if (!at || "floating" in at) return null;
    const column = rest.columns[at.column];
    if (target.edge === "top" || target.edge === "bottom") {
      if (column.panes.length >= MAX_STACK) return null;
      const anchor = column.panes[at.index];
      anchor.size /= 2;
      moved.size = anchor.size;
      column.panes.splice(target.edge === "top" ? at.index : at.index + 1, 0, moved);
      return tidyLayout(rest);
    }
    if (rest.columns.length >= MAX_COLUMNS) return null;
    rest.columns.splice(target.edge === "left" ? at.column : at.column + 1, 0, { width: width ?? PANE_WIDTH, panes: [moved] });
    return tidyLayout(rest);
  }
  if (rest.columns.length >= MAX_COLUMNS) return null;
  const column = { width: width ?? PANE_WIDTH, panes: [moved] };
  if (target.edge === "start") rest.columns.unshift(column);
  else rest.columns.push(column);
  return tidyLayout(rest);
}

// One step with the arrow keys: up and down trade places in the stack;
// left and right join the next column that way, or open a new column at
// the end of the row when there is none. A floating pane moves by a small
// step instead (shift for a larger one).
export function stepPane(layout: TableLayout, id: PaneId, dir: "left" | "right" | "up" | "down", large = false): TableLayout {
  const where = locatePane(layout, id);
  if (!where) return layout;
  if ("floating" in where) {
    const pane = layout.floating[where.floating];
    const step = large ? 0.1 : 0.02;
    const dx = dir === "left" ? -step : dir === "right" ? step : 0;
    const dy = dir === "up" ? -step : dir === "down" ? step : 0;
    return moveFloating(layout, id, { x: pane.x + dx, y: pane.y + dy, w: pane.w, h: pane.h });
  }
  const column = layout.columns[where.column];
  if (dir === "up" || dir === "down") {
    const other = where.index + (dir === "up" ? -1 : 1);
    if (other < 0 || other >= column.panes.length) return layout;
    const next = copyLayout(layout);
    const panes = next.columns[where.column].panes;
    [panes[where.index], panes[other]] = [panes[other], panes[where.index]];
    return tidyLayout(next);
  }
  const neighbour = where.column + (dir === "left" ? -1 : 1);
  if (neighbour < 0 || neighbour >= layout.columns.length) {
    if (column.panes.length === 1) return layout;
    return dockPane(layout, id, { edge: dir === "left" ? "start" : "end" }) ?? layout;
  }
  const target = layout.columns[neighbour];
  if (target.panes.length >= MAX_STACK) return layout;
  const anchor = target.panes[Math.min(where.index, target.panes.length - 1)];
  return dockPane(layout, id, { pane: anchor.id, edge: where.index >= target.panes.length ? "bottom" : "top" }) ?? layout;
}

// The side-panel tab gets a pane of its own: at the foot of the side
// panel's column when it has room, else in a new column beside it, else at
// the end of the row, else afloat. A tab that already has one is shown again.
export function popOutTab(layout: TableLayout, tab: TableTabId): TableLayout {
  const id = tabPane(tab);
  if (locatePane(layout, id)) return setPaneHidden(layout, id, false);
  const offset = 0.04 * layout.floating.length;
  const afloat: TableLayout = {
    ...copyLayout(layout),
    floating: [...layout.floating, { id, x: 0.3 + offset, y: 0.12 + offset, w: 0.36, h: 0.6 }],
  };
  const panel = locatePane(layout, "panel");
  if (panel && !("floating" in panel)) {
    const stack = layout.columns[panel.column].panes;
    const below = dockPane(afloat, id, { pane: stack[stack.length - 1].id, edge: "bottom" });
    if (below) return below;
    const beside = dockPane(afloat, id, { pane: "panel", edge: "left" });
    if (beside) return beside;
  }
  const end = dockPane(afloat, id, { edge: "end" });
  if (end) return end;
  return layout.floating.length >= MAX_FLOATING ? layout : tidyLayout(afloat);
}

// A tab's own pane closes and the tab goes back to the side panel's rail.
export function returnTab(layout: TableLayout, id: PaneId): TableLayout {
  if (!paneTab(id)) return layout;
  return tidyLayout(lift(layout, id).rest);
}

export function setPaneHidden(layout: TableLayout, id: PaneId, hidden: boolean): TableLayout {
  if (id === "table") return layout;
  const where = locatePane(layout, id);
  if (!where) return layout;
  const next = copyLayout(layout);
  const pane = "floating" in where ? next.floating[where.floating] : next.columns[where.column].panes[where.index];
  if (hidden) pane.hidden = true;
  else if (id === "rail") pane.hidden = false;
  else delete pane.hidden;
  return tidyLayout(next);
}

// Afloat over the row, a little apart from the others. The table stays
// docked: it holds the composer, and the row needs something to fill it.
export function floatPane(layout: TableLayout, id: PaneId): TableLayout | null {
  if (id === "table") return null;
  const where = locatePane(layout, id);
  if (!where) return null;
  if ("floating" in where) return layout;
  if (layout.floating.length >= MAX_FLOATING) return null;
  const { rest, hidden } = lift(layout, id);
  const offset = 0.04 * rest.floating.length;
  const pane: FloatingPane = { id, x: 0.3 + offset, y: 0.12 + offset, w: 0.36, h: 0.6 };
  if (hidden) pane.hidden = true;
  rest.floating.push(pane);
  return tidyLayout(rest);
}

export function moveFloating(layout: TableLayout, id: PaneId, rect: { x: number; y: number; w: number; h: number }): TableLayout {
  const where = locatePane(layout, id);
  if (!where || !("floating" in where) || ![rect.x, rect.y, rect.w, rect.h].every(finite)) return layout;
  const next = copyLayout(layout);
  next.floating[where.floating] = { ...next.floating[where.floating], ...rect };
  return tidyLayout(next);
}

// A floating pane comes back into the row: under the side panel when
// there is room there, else in a column at the end of the row.
export function dockFloating(layout: TableLayout, id: PaneId): TableLayout {
  const where = locatePane(layout, id);
  if (!where || !("floating" in where)) return layout;
  const panel = locatePane(layout, "panel");
  const targets: DockTarget[] = [];
  if (panel && !("floating" in panel)) targets.push({ pane: "panel", edge: "bottom" });
  targets.push({ edge: "end" }, { pane: "table", edge: "bottom" });
  for (const target of targets) {
    const next = dockPane(layout, id, target);
    if (next) return next;
  }
  return layout;
}

// Brings a floating pane above the others.
export function raiseFloating(layout: TableLayout, id: PaneId): TableLayout {
  const where = locatePane(layout, id);
  if (!where || !("floating" in where) || where.floating === layout.floating.length - 1) return layout;
  const next = copyLayout(layout);
  const [pane] = next.floating.splice(where.floating, 1);
  next.floating.push(pane);
  return next;
}

export function setLocked(layout: TableLayout, locked: boolean): TableLayout {
  return { ...layout, locked };
}

export function setChronicle(layout: TableLayout, width: number | null): TableLayout {
  return tidyLayout({ ...layout, chronicle: width });
}

// The side panel's column width (the widen button), or null where the side
// panel is not a column of its own width (afloat, or beside the table).
export function panelWidth(layout: TableLayout): number | null {
  const where = locatePane(layout, "panel");
  if (!where || "floating" in where) return null;
  return layout.columns[where.column].width;
}

export function setPanelWidth(layout: TableLayout, width: number): TableLayout {
  const where = locatePane(layout, "panel");
  if (!where || "floating" in where || layout.columns[where.column].width === null) return layout;
  const next = copyLayout(layout);
  next.columns[where.column].width = width;
  return tidyLayout(next);
}
