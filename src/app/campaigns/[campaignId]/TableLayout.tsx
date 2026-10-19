"use client";

import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { TableTabId } from "@/lib/dm/table-tabs";
import { TAB_GLYPHS, TABLE_GLYPH } from "@/app/campaigns/[campaignId]/sessionGlyphs";
import {
  dockFloating,
  dockPane,
  floatPane,
  isDefaultShape,
  moveFloating,
  PANEL_WIDE,
  PANEL_WIDTH,
  panelWidth,
  paneTab,
  popOutTab,
  poppedTabs,
  raiseFloating,
  returnTab,
  setChronicle,
  setPaneHidden,
  setPanelWidth,
  stepPane,
  TAB_IDS,
  tabPane,
  type DockTarget,
  type PaneId,
  type TableLayout,
} from "@/lib/table-layout";
import {
  applySplit,
  box,
  dropRect,
  dropTarget,
  idsKey,
  NO_RECTS,
  placedRects,
  tableGeometry,
  type Split,
  type TableGeometry,
} from "@/lib/table-layout-geometry";
import {
  resetTableLayout,
  saveTableLayout,
  setArranging,
  setLayoutSession,
  useLayoutSession,
  useLayoutSessionEffects,
  useTableLayout,
  type LayoutSeat,
} from "@/app/campaigns/[campaignId]/table-layout-store";
import {
  ArrangeBar,
  FloatCorner,
  onRelease,
  PaneBar,
  released,
  Splitter,
  type GripHandlers,
  type PaneActions,
} from "@/app/campaigns/[campaignId]/TableLayoutParts";
import { LayoutApiContext, ShownContext, useBoxSize, type LayoutApi } from "@/app/campaigns/[campaignId]/table-layout-context";

// The table's row, laid out the way this browser arranged it (client issue
// 46, src/lib/table-layout.ts). Every panel sits in a slot of its own, keyed
// by what it is and always in the same order, so moving, resizing, hiding,
// floating or maximizing one never remounts what it holds: the composer's
// draft, a scroll, the board's camera, a call, a narration mid-sentence all
// carry on; a hidden or covered panel stays mounted, only out of sight. The
// table's own arrangement is the flex row it always was (each slot steps
// aside with display: contents), only its widths the reader's; anything
// else, and the row while arranged, places each slot where tableGeometry
// says.

export type TablePane = { id: PaneId; node: ReactNode; available?: boolean };

const FIXED_PANES: Record<"table" | "rail" | "panel", { label: string; glyph: string }> = {
  table: { label: "Table", glyph: TABLE_GLYPH },
  rail: { label: "Party portraits", glyph: "tab-party" },
  panel: { label: "Side panel", glyph: "tab-journal" },
};

const ORDER: PaneId[] = ["rail", "table", "panel", ...TAB_IDS.map(tabPane)];

const ARROWS: Record<string, "left" | "right" | "up" | "down"> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

// A pane in hand: docked by its grip, or a floating one moved or resized.
// `stop` stops listening for the release (onRelease).
type Gesture =
  | { kind: "dock"; id: PaneId; target: DockTarget | null; stop: () => void }
  | {
      kind: "move" | "size";
      id: PaneId;
      x: number;
      y: number;
      base: TableLayout;
      rect: { x: number; y: number; w: number; h: number };
      next: TableLayout | null;
      stop: () => void;
    };

export function TableRow({
  seat,
  active,
  panes,
  tabs,
  presentation,
}: {
  seat: LayoutSeat;
  active: boolean;
  presentation?: "stage";
  // Null has nothing to mount; available:false keeps content mounted but
  // out of the layout, so temporary absence never loses its state.
  panes: TablePane[];
  // The viewer's side-panel tabs (buildPanelTabs), to name a tab's pane and
  // to offer a pane to the others.
  tabs: Array<[TableTabId, string, LucideIcon, string]>;
}) {
  const saved = useTableLayout(seat);
  const session = useLayoutSession();
  // A drag in progress, drawn but not yet saved.
  const [draft, setDraft] = useState<TableLayout | null>(null);
  const layout = draft ?? saved;
  const locked = layout.locked;
  const editing = active && session.editing && !locked;

  const rowRef = useRef<HTMLDivElement | null>(null);
  const size = useBoxSize(rowRef);

  const availableKey = panes
    .filter((pane) => pane.available !== false && pane.node !== null && pane.node !== undefined && pane.node !== false)
    .map((pane) => pane.id)
    .join(" ");
  const available = useMemo(() => new Set(availableKey.split(" ").filter(Boolean) as PaneId[]), [availableKey]);
  const geometry = useMemo(
    () => tableGeometry(layout, { width: size.width, height: size.height, available: (id) => available.has(id) }),
    [layout, size.width, size.height, available],
  );
  const measured = size.width > 0 && size.height > 0;
  const onScreen = (id: PaneId | null) =>
    id !== null && (geometry.docked.some((pane) => pane.id === id) || geometry.floating.some((pane) => pane.id === id));
  const maximized = active && onScreen(session.maximized) ? session.maximized : null;
  const custom = active && measured && (editing || maximized !== null || !isDefaultShape(layout));

  const rects = custom ? placedRects(geometry, maximized) : NO_RECTS;
  const shownKey = idsKey(custom ? rects.keys() : active && measured ? geometry.docked.map((pane) => pane.id) : available);
  const shown = useMemo(() => new Set(shownKey.split(" ").filter(Boolean) as PaneId[]), [shownKey]);

  const tabInfo = useMemo(() => new Map(tabs.map(([id, label, icon]) => [id, { label, icon }])), [tabs]);
  const labelOf = (id: PaneId) => {
    const tab = paneTab(id);
    return tab ? (tabInfo.get(tab)?.label ?? tab) : FIXED_PANES[id as keyof typeof FIXED_PANES].label;
  };
  const glyphOf = (id: PaneId) => {
    const tab = paneTab(id);
    return tab ? TAB_GLYPHS[tab] : FIXED_PANES[id as keyof typeof FIXED_PANES].glyph;
  };
  const save = useCallback(
    (edit: (current: TableLayout) => TableLayout | null) => saveTableLayout(seat, (current) => edit(current) ?? current),
    [seat],
  );

  // ---- the fight stage's scroll and the widen button, for the panels ----
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  const previewChronicle = useCallback((width: number) => setDraft(setChronicle(savedRef.current, width)), []);
  const commitChronicle = useCallback(
    (width: number) => {
      setDraft(null);
      saveTableLayout(seat, (current) => setChronicle(current, width));
    },
    [seat],
  );
  const setPanelWide = useCallback(
    (wide: boolean) => saveTableLayout(seat, (current) => setPanelWidth(current, wide ? PANEL_WIDE : PANEL_WIDTH)),
    [seat],
  );
  const savedPanel = panelWidth(saved);
  const api = useMemo<LayoutApi>(
    () => ({
      active,
      locked: saved.locked,
      editing,
      canWiden: !presentation && savedPanel !== null && !saved.locked,
      panelWide: (savedPanel ?? PANEL_WIDTH) >= (PANEL_WIDTH + PANEL_WIDE) / 2,
      setPanelWide,
      chronicle: saved.chronicle,
      previewChronicle,
      commitChronicle,
    }),
    [active, presentation, saved.locked, saved.chronicle, editing, savedPanel, setPanelWide, previewChronicle, commitChronicle],
  );

  const flash = session.flash;
  useLayoutSessionEffects({ maximized, editing, flash });

  // ---- splitters ----
  const base = useRef<{ layout: TableLayout; geometry: TableGeometry } | null>(null);
  const [resizing, setResizing] = useState(false);
  const splitterFor = (split: Split) => {
    const leftFlex = split.kind === "columns" && geometry.columns.find((column) => column.index === split.left)?.flex;
    const moving =
      split.kind === "columns"
        ? geometry.docked.find((pane) => pane.column === (leftFlex ? split.right : split.left))
        : geometry.docked.find((pane) => pane.column === split.column && pane.index === split.above);
    const below = split.kind === "stack" ? geometry.docked.find((pane) => pane.column === split.column && pane.index === split.below) : null;
    const label = moving
      ? below
        ? `Resize ${labelOf(moving.id)} and ${labelOf(below.id)}`
        : `Resize ${labelOf(moving.id)}`
      : "Resize";
    const apply = (length: number) => {
      const start = base.current ?? { layout: saved, geometry };
      const from = start.geometry.splits.find((entry) => entry.key === split.key) ?? split;
      return applySplit(start.layout, start.geometry, from, length);
    };
    return {
      orientation: split.kind === "columns" ? ("vertical" as const) : ("horizontal" as const),
      label,
      value: split.value,
      min: split.min,
      max: split.max,
      sign: leftFlex ? (-1 as const) : (1 as const),
      focusable: editing,
      onStart: () => {
        base.current = { layout: saved, geometry };
        setResizing(true);
      },
      onPreview: (length: number) => setDraft(apply(length)),
      onCommit: (length: number) => {
        const next = apply(length);
        base.current = null;
        setResizing(false);
        setDraft(null);
        saveTableLayout(seat, next);
      },
    };
  };

  // ---- moving a pane: docking it by its grip, or a floating one freely ----
  const gesture = useRef<Gesture | null>(null);
  const [dropping, setDropping] = useState<{ id: PaneId; target: DockTarget | null } | null>(null);
  const finishGesture = (commit: boolean) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    current.stop();
    if (current.kind === "dock") {
      setDropping(null);
      const target = current.target;
      if (commit && target) save((layoutNow) => dockPane(layoutNow, current.id, target));
      return;
    }
    setDraft(null);
    if (commit) saveTableLayout(seat, current.next ?? current.base);
  };
  const startFloating = (kind: "move" | "size", id: PaneId, event: PointerEvent<HTMLElement>) => {
    const pane = saved.floating.find((entry) => entry.id === id);
    if (!pane) return;
    gesture.current = {
      kind,
      id,
      x: event.clientX,
      y: event.clientY,
      base: raiseFloating(saved, id),
      rect: { x: pane.x, y: pane.y, w: pane.w, h: pane.h },
      next: null,
      stop: onRelease(() => finishGesture(true)),
    };
  };
  const moveFloatingGesture = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.kind === "dock") return;
    if (released(event)) {
      finishGesture(true);
      return;
    }
    const dx = (event.clientX - current.x) / Math.max(1, geometry.width);
    const dy = (event.clientY - current.y) / Math.max(1, geometry.height);
    const rect =
      current.kind === "move"
        ? { ...current.rect, x: current.rect.x + dx, y: current.rect.y + dy }
        : { ...current.rect, w: current.rect.w + dx, h: current.rect.h + dy };
    current.next = moveFloating(current.base, current.id, rect);
    setDraft(current.next);
  };
  const gripFor = (id: PaneId, floating: boolean): GripHandlers | null => {
    if (locked || (!floating && !editing)) return null;
    return {
      onPointerDown: (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (floating) {
          startFloating("move", id, event);
        } else {
          gesture.current = { kind: "dock", id, target: null, stop: onRelease(() => finishGesture(true)) };
          setDropping({ id, target: null });
        }
      },
      onPointerMove: (event) => {
        const current = gesture.current;
        if (!current || current.id !== id) return;
        if (current.kind !== "dock") {
          moveFloatingGesture(event);
          return;
        }
        if (released(event)) {
          finishGesture(true);
          return;
        }
        const row = rowRef.current?.getBoundingClientRect();
        if (!row) return;
        const target = dropTarget(saved, geometry, id, event.clientX - row.left, event.clientY - row.top);
        if (JSON.stringify(target) !== JSON.stringify(current.target)) {
          current.target = target;
          setDropping({ id, target });
        }
      },
      onPointerUp: () => finishGesture(true),
      onPointerCancel: () => finishGesture(false),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Escape" && gesture.current) {
          event.preventDefault();
          finishGesture(false);
          return;
        }
        const dir = ARROWS[event.key];
        if (!dir) return;
        event.preventDefault();
        save((current) => stepPane(current, id, dir, event.shiftKey));
      },
    };
  };

  const actionsFor = (id: PaneId, floating: boolean): PaneActions => {
    const tab = paneTab(id);
    return {
      maximized: maximized === id,
      onMaximize: () => setLayoutSession({ maximized: maximized === id ? null : id }),
      onFloat: editing && !floating && id !== "table" ? () => save((current) => floatPane(current, id)) : undefined,
      onDock: !locked && floating ? () => save((current) => dockFloating(current, id)) : undefined,
      onHide:
        !locked && id !== "table" && (editing || floating || tab)
          ? () => {
              save((current) => setPaneHidden(current, id, true));
              if (maximized === id) setLayoutSession({ maximized: null });
            }
          : undefined,
      onReturn: !locked && tab ? () => save((current) => returnTab(current, id)) : undefined,
    };
  };

  // The corner a floating pane is resized by: dragged, or stepped with the
  // arrow keys (a small step, or a large one with shift).
  const cornerFor = (id: PaneId) => (
    <FloatCorner
      label={labelOf(id)}
      onPointerDown={(event) => startFloating("size", id, event)}
      onPointerMove={moveFloatingGesture}
      onPointerUp={() => finishGesture(true)}
      onPointerCancel={() => finishGesture(false)}
      onStep={(dir, large) =>
        save((current) => {
          const pane = current.floating.find((entry) => entry.id === id);
          if (!pane) return current;
          const step = large ? 0.1 : 0.02;
          const w = pane.w + (dir === "right" ? step : dir === "left" ? -step : 0);
          const h = pane.h + (dir === "down" ? step : dir === "up" ? -step : 0);
          return moveFloating(current, id, { x: pane.x, y: pane.y, w, h });
        })
      }
    />
  );

  // ---- what the arrange bar offers ----
  const popped = poppedTabs(layout);
  const addable = tabs.filter(([id]) => !popped.includes(id)).map(([id, label, icon]) => ({ id, label, icon }));
  const setAside = [...available].filter((id) => !onScreen(id)).map((id) => ({ id, label: labelOf(id) }));

  // The widths the flex row draws the table's own arrangement at.
  const style: Record<string, string> = {};
  if (active && measured && !custom) {
    for (const pane of geometry.docked) {
      if (pane.id === "rail") style["--tlay-rail-w"] = `${pane.rect.w}px`;
      if (pane.id === "panel") style["--tlay-panel-w"] = `${pane.rect.w}px`;
    }
  }
  // The board beside the scroll keeps 320px whatever the scroll is set to.
  if (layout.chronicle !== null) style["--tlay-chronicle-w"] = `clamp(12.5rem, ${layout.chronicle}px, calc(100% - 320px))`;

  const nodes = new Map(panes.map((pane) => [pane.id, pane.node]));
  // Detached tabs keep their owners; the preset stacks them beside the table.
  const sidePanes = presentation ? ORDER.filter((id) => available.has(id) && id !== "rail" && id !== "table" && id !== "tab:battle") : [];
  const legacySplits = active && measured && !custom && !locked;
  const drop = dropping?.target ? dropRect(geometry, dropping.target) : null;

  return (
    <LayoutApiContext.Provider value={api}>
      <ShownContext.Provider value={shown}>
        {editing ? (
          <ArrangeBar
            tabs={addable}
            setAside={setAside}
            onAdd={(tab) => {
              save((current) => popOutTab(current, tab));
              setLayoutSession({ flash: { id: tabPane(tab), at: Date.now() } });
            }}
            onShow={(id) => save((current) => setPaneHidden(current, id, false))}
            onReset={() => resetTableLayout(seat)}
            onDone={() => setArranging(false)}
          />
        ) : null}
        <div
          ref={rowRef}
          className="cine-row flex min-h-0 flex-1"
          data-tlay={custom ? "custom" : undefined}
          data-presentation={presentation}
          data-tlay-edit={editing ? "" : undefined}
          data-resizing={resizing ? "" : undefined}
          style={style as CSSProperties}
        >
          {ORDER.map((id) => {
            const node = nodes.get(id);
            if (node === undefined || node === null || node === false) return null;
            const rect = rects.get(id);
            const floatingIndex = layout.floating.findIndex((pane) => pane.id === id);
            const floating = floatingIndex >= 0 && maximized !== id;
            const tab = paneTab(id);
            const barred = custom && Boolean(rect) && (editing || floating || tab !== null || maximized === id);
            const column = geometry.docked.find((pane) => pane.id === id)?.column;
            const after = legacySplits
              ? geometry.splits.find((split) => split.kind === "columns" && split.left === column)
              : undefined;
            return (
              <div
                key={id}
                className="tlay-slot"
                data-pane={id}
                data-floating={custom && floating ? "" : undefined}
                data-flash={flash?.id === id ? "" : undefined}
                data-dragging={dropping?.id === id ? "" : undefined}
                hidden={!available.has(id) || (custom && !rect)}
                style={presentation && sidePanes.includes(id) ? { "--session-pane-top": `${100 * sidePanes.indexOf(id) / sidePanes.length}%`, "--session-pane-height": `${100 / sidePanes.length}%` } as CSSProperties : custom && rect ? { ...box(rect), zIndex: floating ? 10 + floatingIndex : undefined } : undefined}
                onPointerDownCapture={
                  custom && floating && floatingIndex !== layout.floating.length - 1
                    ? () => save((current) => raiseFloating(current, id))
                    : undefined
                }
              >
                {barred ? (
                  <PaneBar
                    label={labelOf(id)}
                    glyph={glyphOf(id)}
                    tour={tab ? `tab-${tab}` : undefined}
                    grip={gripFor(id, floating)}
                    actions={actionsFor(id, floating)}
                  />
                ) : null}
                {node}
                {after ? <Splitter key={after.key} {...splitterFor(after)} /> : null}
                {custom && floating && !locked ? cornerFor(id) : null}
              </div>
            );
          })}
          {custom && !maximized && !locked
            ? geometry.splits.map((split) => (
                <Splitter
                  key={split.key}
                  className="tlay-split-abs"
                  style={
                    // 10px boxes centred on the seam (table-layout.css).
                    split.kind === "columns"
                      ? { left: split.x - 5, top: split.y, height: split.h }
                      : { left: split.x, top: split.y - 5, width: split.w }
                  }
                  {...splitterFor(split)}
                />
              ))
            : null}
          {drop ? <div className="tlay-drop" style={box(drop)} aria-hidden /> : null}
        </div>
      </ShownContext.Provider>
    </LayoutApiContext.Provider>
  );
}
