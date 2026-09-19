"use client";

import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { Field, chip, chipOn, chipRow } from "@/app/workshop/kit";
import {
  BEAT_KINDS,
  BEAT_LABELS,
  TITLE_MAX,
  type Beat,
  type BeatKind,
  type BoardInventory,
  type BoardNode,
} from "@/lib/workshop/board";
import { KIND_GLYPH, LINK_FIELDS, LINK_GLYPH } from "@/app/workshop/storyboard/beat-fields";

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
      className={cn(ui.btnPrimary, "w-fit")}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
      Save the card
    </button>
  );

  return (
    <>
      <SectionHead title="The card" glyph={KIND_GLYPH[edit.kind]} className="mb-0" />
      <div className="flex flex-wrap gap-2">
        <span className="w-full sm:w-52">
          <Select<BeatKind>
            label="Kind of card"
            value={edit.kind}
            onChange={(kind) => onChange({ ...edit, kind })}
            options={BEAT_KINDS.map((kind) => ({ value: kind, label: BEAT_LABELS[kind], icon: { kind: "glyph" as const, key: KIND_GLYPH[kind] } }))}
          />
        </span>
        <input
          value={edit.title}
          aria-label="Title"
          onChange={(event) =>
            onChange({ ...edit, title: event.target.value.slice(0, TITLE_MAX) })
          }
          className={cn(ui.input, "min-w-40 flex-1")}
        />
      </div>
      <textarea
        value={edit.body}
        onChange={(event) => onChange({ ...edit, body: event.target.value })}
        rows={3}
        placeholder="What actually happens, and what it means if the party is not there."
        aria-label="What happens"
        className={cn(ui.input, "resize-y")}
      />

      <SectionHead title="Who and where" glyph="system-cast" className="mb-0 pt-1" />
      <div className="stagger-up grid gap-2 sm:grid-cols-2">
        {LINK_FIELDS.map(([field, bucket, label]) => (
          <Field key={field} label={label}>
            <Select
              label={label}
              value={edit.links[field] ?? ""}
              onChange={(next) =>
                onChange({
                  ...edit,
                  links: { ...edit.links, [field]: next || undefined },
                })
              }
              options={[
                { value: "", label: "nobody in particular" },
                ...inventory[bucket].map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                  icon: { kind: "glyph" as const, key: LINK_GLYPH[field] },
                })),
              ]}
            />
          </Field>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <SectionHead title="Leads to" glyph="pace-normal" className="mb-1 pt-1" />
        <div className={cn("stagger-pop", chipRow)}>
          {others.map((other) => {
            const on = edit.edges.includes(other.id);
            return (
              <button
                key={other.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...edit,
                    edges: on
                      ? edit.edges.filter((edge) => edge !== other.id)
                      : [...edit.edges, other.id],
                  })
                }
                className={cn(ui.btnSmall, chip, "normal-case", on && chipOn)}
              >
                {other.title}
              </button>
            );
          })}
        </div>
      </div>

      {onDelete ? (
        <div className="reveal flex flex-wrap items-center gap-2 text-sm">
          {saveButton}
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            aria-label={`Delete ${edit.title}`}
            className={cn(ui.btnSmall, "ml-auto hover:border-red-500/50 hover:text-red-300")}
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      ) : (
        saveButton
      )}
    </>
  );
}
