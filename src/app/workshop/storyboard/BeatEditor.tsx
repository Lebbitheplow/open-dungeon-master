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
  ROUTE_KINDS,
  ROUTE_LABELS,
  ROUTE_LABEL_MAX,
  TITLE_MAX,
  type Beat,
  type BeatKind,
  type BeatLinks,
  type BoardInventory,
  type BoardNode,
  type RouteKind,
} from "@/lib/workshop/board";
import { KIND_GLYPH, LINK_FIELDS, LINK_GLYPH } from "@/app/workshop/storyboard/beat-fields";
import { DictateField } from "@/components/DictateField";
import { appendDictation } from "@/lib/dictation";

// One card, open for editing: its kind and title, what happens, who and
// where it involves, and which cards it leads to and how. Split out of
// DmStoryboardPanel so the workshop board can show the same editor in a
// sheet; the list still renders it inline under the card, unchanged.
//
// The pickers list this workshop's rows first and its shared workshop's
// after them under that workshop's name (#159). A link whose row has gone
// (deleted, or the shared workshop detached) says so in the picker rather
// than reading as "nobody in particular".
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
  broken = [],
}: {
  edit: Beat;
  onChange: (beat: Beat) => void;
  inventory: BoardInventory;
  // Links this card holds that no longer resolve.
  broken?: Array<keyof BeatLinks>;
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
      <DictateField label="What happens" onTranscript={(text) => onChange({ ...edit, body: appendDictation(edit.body, text) })}>
        <textarea
          value={edit.body}
          onChange={(event) => onChange({ ...edit, body: event.target.value })}
          rows={3}
          placeholder="What actually happens, and what it means if the party is not there."
          aria-label="What happens"
          className={cn(ui.input, "resize-y")}
        />
      </DictateField>

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
                ...(broken.includes(field) && edit.links[field]
                  ? [{ value: edit.links[field] as string, label: "Missing: no longer in this workshop or its shared one", disabled: true }]
                  : []),
                ...inventory[bucket].map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                  icon: { kind: "glyph" as const, key: LINK_GLYPH[field] },
                  ...(entry.from ? { group: `From ${entry.from}` } : {}),
                })),
              ]}
            />
            {broken.includes(field) ? (
              <p className="reveal mt-1 text-[11px] text-amber-300/80">
                What this card picked is gone. Pick again, or clear it.
              </p>
            ) : null}
          </Field>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <SectionHead title="Leads to" glyph="pace-normal" className="mb-1 pt-1" />
        <p className="text-[11px] leading-snug text-stone-500">
          An arrow is &quot;then&quot; unless you say otherwise. Mark the routes the party chooses
          between, or a scene that only happens if something holds; those arrive in a campaign
          as moments the storyteller can run or drop, not as beats it waits on.
        </p>
        <div className={cn("stagger-pop", chipRow)}>
          {others.map((other) => {
            const on = edit.edges.includes(other.id);
            return (
              <button
                key={other.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const routes = { ...(edit.routes ?? {}) };
                  delete routes[other.id];
                  onChange({
                    ...edit,
                    edges: on
                      ? edit.edges.filter((edge) => edge !== other.id)
                      : [...edit.edges, other.id],
                    routes,
                  });
                }}
                className={cn(ui.btnSmall, chip, "normal-case", on && chipOn)}
              >
                {other.title}
              </button>
            );
          })}
        </div>
        {edit.edges.length ? (
          <ul className="stagger-up mt-1 flex flex-col gap-1.5">
            {edit.edges.map((edge) => {
              const target = others.find((other) => other.id === edge);
              if (!target) {
                return null;
              }
              const route = edit.routes?.[edge];
              const setRoute = (kind: "then" | RouteKind, label = route?.label ?? "") => {
                const routes = { ...(edit.routes ?? {}) };
                if (kind === "then") {
                  delete routes[edge];
                } else {
                  routes[edge] = { kind, label: label.slice(0, ROUTE_LABEL_MAX) };
                }
                onChange({ ...edit, routes });
              };
              return (
                <li key={edge} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="min-w-28 flex-1 truncate text-stone-300">{target.title}</span>
                  <span className="w-full sm:w-48">
                    <Select<"then" | RouteKind>
                      label={`How "${target.title}" follows`}
                      value={route?.kind ?? "then"}
                      onChange={(kind) => setRoute(kind)}
                      options={(["then", ...ROUTE_KINDS] as const).map((kind) => ({
                        value: kind,
                        label: ROUTE_LABELS[kind],
                      }))}
                    />
                  </span>
                  {route ? (
                    <input
                      value={route.label}
                      onChange={(event) => setRoute(route.kind, event.target.value)}
                      placeholder={route.kind === "choice" ? "if they side with the guild" : "if they search the cellar"}
                      aria-label={`When the party takes the route to "${target.title}"`}
                      className={cn(ui.input, "reveal min-w-40 flex-1 py-1 text-xs")}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
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
