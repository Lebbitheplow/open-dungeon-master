"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Minus, Plus, Redo2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CanvasControls } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import { MapRail } from "@/app/campaigns/[campaignId]/MapRail";
import { hasDials } from "@/app/campaigns/[campaignId]/MapOptions";
import { MODES, type MapTools, type SurfaceCaps, type UndoControls } from "@/app/campaigns/[campaignId]/MapToolbox";
import { MapToastStack, type MapToast } from "@/app/campaigns/[campaignId]/MapToasts";

// The shape of the map editor (docs/visual-overhaul-plan.md 4.2 and 4.7): a
// top bar, then rail, options, canvas, layers. Shared by the workshop's editor
// and the live board's studio, which differ in what they edit and not in how
// the tools are laid out.
//
// One state, two arrangements. With 56 rem of its own width to work in it is
// the four columns; with less (a phone, or the DM console's drawer) the canvas
// takes the width, the rail lies along the bottom as a strip, and the options
// and the layers become two sheets that rise over the canvas. The switch is on
// the editor's OWN width, not the window's, because the same editor is mounted
// full screen in the workshop and in a narrow drawer beside the chat.

const WIDE_PX = 896;

function ToggleChip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-md border px-2.5 motion-press",
        active ? "border-amber-500/60 bg-amber-400/10 text-amber-200" : "border-stone-700 text-stone-500 hover:text-stone-300",
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-wide">{children}</span>
    </button>
  );
}

export function MapEditorShell({
  title,
  save,
  undo,
  back,
  grid,
  onGrid,
  dmView,
  onDmView,
  zoom,
  controls,
  primary,
  tools,
  onTools,
  caps,
  onHelp,
  options,
  canvas,
  status,
  side,
  toasts,
  closeGap = false,
  className,
}: {
  // The map's name: an input in the workshop, a heading on the live board.
  title: ReactNode;
  save?: ReactNode;
  undo?: UndoControls;
  // How many edits can be taken back, printed beside the arrows.
  back?: number;
  grid: boolean;
  onGrid: (on: boolean) => void;
  dmView: boolean;
  onDmView: (on: boolean) => void;
  zoom: number;
  controls: RefObject<CanvasControls | null>;
  // "Put it on the table" and the menu beside it.
  primary?: ReactNode;
  tools: MapTools;
  onTools: (next: MapTools) => void;
  caps: SurfaceCaps;
  onHelp?: () => void;
  options: ReactNode;
  canvas: ReactNode;
  status?: ReactNode;
  side: ReactNode;
  toasts: MapToast[];
  // Leave room at the top right for a dialog's own close button.
  closeGap?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [sheet, setSheet] = useState<"tool" | "layers" | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const measure = () => setWide(root.clientWidth >= WIDE_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const held = MODES.find((entry) => entry.mode === tools.mode);
  const undoSize = wide ? "size-8" : "size-11";
  const undoButtons = undo ? (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={!undo.canUndo}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={undo.onUndo}
        className={cn("flex items-center justify-center rounded-md border border-stone-700 text-stone-300 hover:text-amber-200 disabled:opacity-35 motion-press", undoSize)}
      >
        <Undo2 className="size-4" />
      </button>
      <button
        type="button"
        disabled={!undo.canRedo}
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        onClick={undo.onRedo}
        className={cn("flex items-center justify-center rounded-md border border-stone-700 text-stone-300 hover:text-amber-200 disabled:opacity-35 motion-press", undoSize)}
      >
        <Redo2 className="size-4" />
      </button>
      {wide && back !== undefined ? <span className="ml-1 font-mono text-[10px] text-stone-500">{back} back</span> : null}
    </span>
  ) : null;

  const switches = (
    <>
      <ToggleChip active={grid} onClick={() => onGrid(!grid)} title="The grid lines over the map">
        Grid
      </ToggleChip>
      <ToggleChip active={dmView} onClick={() => onDmView(!dmView)} title="Off shows the map as a player finds it: no DM-only labels, door states or overlay">
        DM view
      </ToggleChip>
    </>
  );
  const zoomer = (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" aria-label="Zoom out" onClick={() => controls.current?.zoomOut()} className="flex size-8 items-center justify-center rounded-md border border-stone-700 text-stone-400 hover:text-amber-200">
        <Minus className="size-3.5" />
      </button>
      <button type="button" aria-label="Zoom in" onClick={() => controls.current?.zoomIn()} className="flex size-8 items-center justify-center rounded-md border border-stone-700 text-stone-400 hover:text-amber-200">
        <Plus className="size-3.5" />
      </button>
      <button
        type="button"
        title="Fit the whole map"
        onClick={() => controls.current?.fit()}
        className="h-8 min-w-12 rounded-md px-1 text-stone-300 hover:text-amber-200"
      >
        <span className="font-mono text-[11px] tabular-nums">{Math.round(zoom * 100)}%</span>
      </button>
    </span>
  );

  return (
    <div
      ref={rootRef}
      data-map-editor={wide ? "wide" : "narrow"}
      // Buttons and fields inherit their type from here (the app resets `font`
      // on them), so this is the editor's base size.
      className={cn("relative flex h-full min-h-[32rem] flex-col overflow-hidden rounded-xl border border-stone-800 bg-stone-950/70 text-[12px]", className)}
    >
      {/* Top bar */}
      <header className={cn("flex shrink-0 items-center gap-2 border-b border-stone-800 px-3 py-2", closeGap && "pr-12")}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {title}
          {save}
        </div>
        {undoButtons}
        {wide ? (
          <>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-stone-800" />
            {switches}
            <span className="flex-1" />
            {zoomer}
            {primary ? <span aria-hidden="true" className="mx-1 h-5 w-px bg-stone-800" /> : null}
            {primary}
          </>
        ) : null}
      </header>
      {wide ? null : (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-stone-800 px-3 py-1.5 [scrollbar-width:none]">
          {switches}
          {zoomer}
          <span className="flex-1" />
          {primary}
        </div>
      )}

      {/* Body */}
      {wide ? (
        <div className="flex min-h-0 flex-1">
          <MapRail tools={tools} onTools={onTools} caps={caps} onHelp={onHelp} orientation="upright" />
          <aside className="w-[232px] shrink-0 overflow-y-auto border-r border-stone-800 px-3 py-3">{options}</aside>
          <main className="relative flex min-w-0 flex-1 flex-col">
            <div className="map-well relative min-h-0 flex-1 p-4">
              {canvas}
              <MapToastStack toasts={toasts} />
            </div>
            {status}
          </main>
          <aside className="w-[228px] shrink-0 space-y-4 overflow-y-auto border-l border-stone-800 px-3 py-3">{side}</aside>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="map-well relative min-h-0 flex-1 p-2">
            {canvas}
            {held ? (
              <span className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-stone-950/85 px-2.5 py-1 text-[11px] text-amber-100 shadow-elev-1 backdrop-blur">
                <held.icon className="size-3" /> {held.label}
              </span>
            ) : null}
            <MapToastStack toasts={toasts} />
          </div>
          <MapRail
            tools={tools}
            onTools={onTools}
            caps={caps}
            onHelp={onHelp}
            orientation="strip"
            onPicked={(mode) => (hasDials(mode) ? setSheet("tool") : undefined)}
          />
          <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-stone-800 p-2">
            <button
              type="button"
              aria-expanded={sheet === "tool"}
              onClick={() => setSheet(sheet === "tool" ? null : "tool")}
              className="h-11 rounded-lg border border-amber-500/40 bg-amber-400/5 text-amber-100 motion-press"
            >
              <span className="font-display text-[11px] uppercase tracking-[0.16em]">{held ? held.label : "Tool"}</span>
            </button>
            <button
              type="button"
              aria-expanded={sheet === "layers"}
              onClick={() => setSheet(sheet === "layers" ? null : "layers")}
              className="h-11 rounded-lg border border-stone-700 bg-stone-900/50 text-stone-200 motion-press"
            >
              <span className="font-display text-[11px] uppercase tracking-[0.16em]">Layers</span>
            </button>
          </div>

          {sheet ? (
            <>
              <button
                type="button"
                aria-label="Close the sheet"
                onClick={() => setSheet(null)}
                className="map-scrim absolute inset-0 z-30 bg-[#05030d]/55"
              />
              <section
                role="dialog"
                aria-label={sheet === "tool" ? "Tool options" : "Layers"}
                className="map-sheet absolute inset-x-0 bottom-0 z-40 flex max-h-[78%] flex-col rounded-t-2xl border border-b-0 border-stone-600/60 bg-stone-950 shadow-elev-2"
              >
                <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-2">
                  <span aria-hidden="true" className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-stone-600/70" />
                  <span className="pt-2 font-display text-[11px] uppercase tracking-[0.18em] text-amber-300">
                    {sheet === "tool" ? "Options" : "The map"}
                  </span>
                  <button type="button" aria-label="Close" onClick={() => setSheet(null)} className="flex size-10 items-center justify-center rounded-md text-stone-400 hover:text-stone-200">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  {sheet === "tool" ? options : side}
                </div>
              </section>
            </>
          ) : null}
          {status}
        </div>
      )}
    </div>
  );
}
