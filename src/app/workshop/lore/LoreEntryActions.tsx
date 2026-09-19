"use client";

import { Copy, Pencil, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

const action = "px-2.5 py-1.5";
import type { LoreEntryView } from "@/app/workshop/lore/types";

// What the lead can do to one lore entry: edit it, pin it into every DM
// turn, copy it, delete it. Split out of LorePanel so the workshop's editor
// sheet can offer the same buttons; the campaign list still shows them under
// an expanded entry, unchanged.
//
// Edit is optional because inside the editor it would be a button that opens
// what is already open.

export function LoreEntryActions({
  entry,
  onEdit,
  onPin,
  onDuplicate,
  onDelete,
}: {
  entry: LoreEntryView;
  onEdit?: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className={cn(ui.btnSmall, action)}
        >
          <Pencil className="size-3" /> Edit
        </button>
      ) : null}
      <button
        type="button"
        onClick={onPin}
        title={
          entry.pinned ? "Unpin: retrieved only when relevant" : "Pin: included in every DM turn"
        }
        aria-pressed={entry.pinned}
        className={cn(ui.btnSmall, action, entry.pinned && "border-amber-500/60 bg-amber-400/10 text-amber-200")}
      >
        <Pin className="size-3" /> {entry.pinned ? "Pinned" : "Pin"}
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        aria-label={`Duplicate ${entry.title}`}
        className={cn(ui.btnSmall, action)}
      >
        <Copy className="size-3" /> Duplicate
      </button>
      <button
        type="button"
        onClick={onDelete}
        className={cn(ui.btnSmall, action, "hover:border-red-500/50 hover:text-red-300")}
      >
        <Trash2 className="size-3" /> Delete
      </button>
    </div>
  );
}
