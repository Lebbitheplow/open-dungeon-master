"use client";

import { Copy, Link2, Move, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";

// The compact action bar above a selected object (docs/vtt-parity-
// implementation-plan.md section 10.1): Edit, Move, Duplicate, Delete, and
// Link for labels, at 40 px targets, scaling in over --dur-quick. Several
// selected: Delete and Move as a group. Escape clears through the parent.

export type SelectionAction = "edit" | "move" | "duplicate" | "delete" | "link" | "dmOnly";

export function SelectionBar({
  title,
  count,
  actions,
  moving,
  onAction,
  onClear,
  className,
}: {
  title: string;
  count: number;
  actions: SelectionAction[];
  // A move is armed: the next tap on the surface is the destination.
  moving?: boolean;
  onAction: (action: SelectionAction) => void;
  onClear: () => void;
  className?: string;
}) {
  const buttons: Array<{ action: SelectionAction; label: string; icon: typeof Move; tone?: "danger" }> = [
    { action: "edit", label: "Edit", icon: Pencil },
    { action: "move", label: moving ? "Tap the new tile" : "Move", icon: Move },
    { action: "duplicate", label: "Duplicate", icon: Copy },
    { action: "link", label: "Link", icon: Link2 },
    { action: "dmOnly", label: "DM only", icon: Link2 },
    { action: "delete", label: "Delete", icon: Trash2, tone: "danger" },
  ];
  return (
    <div
      role="toolbar"
      aria-label={`Selected: ${title}`}
      className={cn(
        "fx-pop flex flex-wrap items-center gap-1 rounded-lg border border-amber-700/60 bg-stone-950/95 px-2 py-1 shadow-elev-2",
        className,
      )}
    >
      <span className="mr-1 max-w-[12rem] truncate text-[11px] text-amber-200">
        {count > 1 ? `${count} selected` : title}
      </span>
      {buttons
        .filter((button) => actions.includes(button.action))
        .map((button) => {
          const Icon = button.icon;
          return (
            <button
              key={button.action}
              type="button"
              onClick={() => onAction(button.action)}
              aria-pressed={button.action === "move" ? moving : undefined}
              className={cn(
                "flex h-10 min-w-10 items-center justify-center gap-1 rounded-md border px-2 text-[11px]",
                button.tone === "danger"
                  ? "border-red-900/60 text-red-300 hover:bg-red-950/40"
                  : button.action === "move" && moving
                    ? "border-amber-600 bg-amber-950/60 text-amber-100"
                    : "border-stone-700 text-stone-300 hover:bg-stone-800",
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{button.label}</span>
            </button>
          );
        })}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-auto flex size-10 items-center justify-center rounded-md text-stone-500 hover:text-stone-200"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
