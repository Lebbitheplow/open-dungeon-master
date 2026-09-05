"use client";

import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  BEAT_KINDS,
  BEAT_LABELS,
  TITLE_MAX,
  type Beat,
  type BeatKind,
  type BoardInventory,
  type BoardNode,
} from "@/lib/workshop/board";
import { LINK_FIELDS, beatInput } from "@/app/workshop/storyboard/beat-fields";

// One card, open for editing: its kind and title, what happens, who and
// where it involves, and which cards it leads to. Split out of
// DmStoryboardPanel so the workshop board can show the same editor in a
// sheet; the list still renders it inline under the card, unchanged.
//
// The edits live with the caller, which is also where the save request is,
// so this is fields over a value and nothing else. Delete is only offered
// when the caller has nowhere else to put it (the list keeps it on the row).

export function BeatEditor({
  edit,
  onChange,
  inventory,
  others,
  busy,
  onSave,
  onDelete,
}: {
  edit: Beat;
  onChange: (beat: Beat) => void;
  inventory: BoardInventory;
  // Every other card on the board, as candidates for "leads to".
  others: BoardNode[];
  busy: boolean;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const saveButton = (
    <button
      type="button"
      disabled={busy}
      onClick={onSave}
      className="inline-flex w-fit items-center gap-1.5 rounded-md border border-amber-500/40 px-3 py-1 text-xs text-amber-100 hover:bg-stone-800 disabled:opacity-40"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
      Save the card
    </button>
  );

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <select
          value={edit.kind}
          onChange={(event) => onChange({ ...edit, kind: event.target.value as BeatKind })}
          className={cn(beatInput, "w-44")}
        >
          {BEAT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {BEAT_LABELS[kind]}
            </option>
          ))}
        </select>
        <input
          value={edit.title}
          onChange={(event) =>
            onChange({ ...edit, title: event.target.value.slice(0, TITLE_MAX) })
          }
          className={cn(beatInput, "flex-1")}
        />
      </div>
      <textarea
        value={edit.body}
        onChange={(event) => onChange({ ...edit, body: event.target.value })}
        rows={3}
        placeholder="What actually happens, and what it means if the party is not there."
        className={cn(beatInput, "w-full resize-y")}
      />

      <div className="grid gap-1.5 sm:grid-cols-2">
        {LINK_FIELDS.map(([field, bucket, label]) => (
          <label key={field} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-500">{label}</span>
            <select
              value={edit.links[field] ?? ""}
              onChange={(event) =>
                onChange({
                  ...edit,
                  links: { ...edit.links, [field]: event.target.value || undefined },
                })
              }
              className={cn(beatInput, "w-full")}
            >
              <option value="">nobody in particular</option>
              {inventory[bucket].map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">Leads to</span>
        <div className="flex flex-wrap gap-1">
          {others.map((other) => {
            const on = edit.edges.includes(other.id);
            return (
              <button
                key={other.id}
                type="button"
                onClick={() =>
                  onChange({
                    ...edit,
                    edges: on
                      ? edit.edges.filter((edge) => edge !== other.id)
                      : [...edit.edges, other.id],
                  })
                }
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[10px]",
                  on
                    ? "border-amber-500/50 text-amber-100"
                    : "border-stone-700 text-stone-500 hover:text-stone-300",
                )}
              >
                {other.title}
              </button>
            );
          })}
        </div>
      </div>

      {onDelete ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {saveButton}
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            aria-label={`Delete ${edit.title}`}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-500 hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 className="size-3" /> Delete
          </button>
        </div>
      ) : (
        saveButton
      )}
    </>
  );
}
