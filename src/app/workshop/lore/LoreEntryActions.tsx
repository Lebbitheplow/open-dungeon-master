"use client";

import { Copy, Pencil, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
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
    <div className="flex items-center gap-2.5">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300"
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
        className={cn(
          "flex items-center gap-1 text-[11px]",
          entry.pinned ? "text-amber-300" : "text-stone-500 hover:text-stone-300",
        )}
      >
        <Pin className="size-3" /> {entry.pinned ? "Pinned" : "Pin"}
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        aria-label={`Duplicate ${entry.title}`}
        className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300"
      >
        <Copy className="size-3" /> Duplicate
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-red-400"
      >
        <Trash2 className="size-3" /> Delete
      </button>
    </div>
  );
}
