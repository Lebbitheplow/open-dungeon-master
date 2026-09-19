"use client";

import { useEffect } from "react";
import { BRUSH_KEYS, MODES, type MapTools, type SurfaceCaps } from "@/app/campaigns/[campaignId]/mapToolState";

// The toolbox's keys, while an editor is on screen. Everything else about the
// toolbox (its state, the fifteen modes and Roll, what each means to the
// canvas) is mapToolState.ts, re-exported here so callers keep one import.

export * from "@/app/campaigns/[campaignId]/mapToolState";

export type UndoControls = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

function typingSomewhere(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

// The keys, while an editor is on screen. With on-screen equivalents for
// every one, because the phone has no keys.
export function useMapHotkeys({
  enabled,
  tools,
  onTools,
  caps,
  undo,
  onHelp,
  onDelete,
}: {
  enabled: boolean;
  tools: MapTools;
  onTools: (next: MapTools) => void;
  caps: SurfaceCaps;
  undo?: UndoControls;
  onHelp?: () => void;
  onDelete?: () => void;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (typingSomewhere(event.target)) {
        return;
      }
      const meta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "?" && onHelp) {
        event.preventDefault();
        onHelp();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && onDelete && !meta) {
        event.preventDefault();
        onDelete();
        return;
      }
      if (meta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          undo?.onRedo();
        } else {
          undo?.onUndo();
        }
        return;
      }
      if (meta && key === "y") {
        event.preventDefault();
        undo?.onRedo();
        return;
      }
      if (meta || event.altKey) {
        return;
      }
      if (event.key === "Escape") {
        onTools({ ...tools, mode: "" });
        return;
      }
      const brush = BRUSH_KEYS[event.key];
      if (brush) {
        const painting = ["brush", "line", "rect", "box", "fill"].includes(tools.mode);
        onTools({ ...tools, brush, mode: painting ? tools.mode : "brush" });
        return;
      }
      const chip = MODES.find((entry) => entry.key.toLowerCase() === key);
      if (chip && (!chip.needs || caps[chip.needs])) {
        onTools({ ...tools, mode: tools.mode === chip.mode ? "" : chip.mode });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, tools, onTools, caps, undo, onHelp, onDelete]);
}
