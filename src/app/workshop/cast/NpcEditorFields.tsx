"use client";

import type { ReactNode } from "react";
import {
  ATTITUDES,
  type GeneratableField,
  type NpcDraft,
  type RelationGraph,
} from "@/lib/npcs/forge";
import {
  GOAL_FIELDS,
  PersonalitySliders,
  RelationEditor,
  goalText,
  setGoal,
} from "@/app/campaigns/[campaignId]/NpcFields";

// The four sections of the NPC form: who they are on the surface, who they
// are underneath, what they want, and how they feel about everyone else.
// Moved here unchanged from DmNpcForgePanel, which keeps the requests and
// the buttons; the panel renders these inline in the console and inside a
// sheet in the workshop.
//
// `suggest` renders the per-field Suggest button, or nothing on a server
// with no text model. The panel owns it because it owns the request.

export function NpcEditorFields({
  draft,
  onChange,
  graph,
  others,
  suggest,
}: {
  draft: NpcDraft;
  onChange: (draft: NpcDraft) => void;
  graph: RelationGraph;
  others: string[];
  suggest: (field: GeneratableField) => ReactNode;
}) {
  return (
    <>
      <section className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder="Their name"
            className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
          />
          <select
            value={draft.attitude}
            onChange={(event) =>
              onChange({ ...draft, attitude: event.target.value as NpcDraft["attitude"] })
            }
            className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
          >
            {ATTITUDES.map((attitude) => (
              <option key={attitude} value={attitude}>
                {attitude === "hostile"
                  ? "Hostile to the party"
                  : attitude === "friendly"
                    ? "Friendly to the party"
                    : "Indifferent"}
              </option>
            ))}
          </select>
        </div>

        <input
          value={draft.location}
          onChange={(event) => onChange({ ...draft, location: event.target.value })}
          placeholder="Where they are usually found"
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
        />

        <input
          value={draft.aliases.join(", ")}
          onChange={(event) =>
            onChange({
              ...draft,
              aliases: event.target.value.split(",").map((alias) => alias.trim()).filter(Boolean),
            })
          }
          placeholder="Other names they answer to, separated by commas"
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
        />

        <div className="flex items-start gap-1.5">
          <textarea
            value={draft.trait}
            onChange={(event) => onChange({ ...draft, trait: event.target.value })}
            rows={2}
            placeholder="What a player notices about them first"
            className="flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
          />
          {suggest("trait")}
        </div>
      </section>

      <section className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-stone-500">Who they are</p>
          {suggest("personality")}
        </div>
        <PersonalitySliders draft={draft} onChange={onChange} />
      </section>

      <section className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <p className="text-[11px] uppercase tracking-wide text-stone-500">What they want</p>
        {GOAL_FIELDS.map(([field, placeholder]) => (
          <div key={field} className="flex items-center gap-1.5">
            <input
              value={goalText(draft, field)}
              onChange={(event) => onChange(setGoal(draft, field, event.target.value))}
              placeholder={placeholder}
              className="flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
            />
            {field === "session" && draft.goals.session ? (
              <span className="shrink-0 text-[10px] text-stone-600">
                {draft.goals.session.progress}/{draft.goals.session.target}
              </span>
            ) : null}
            {suggest(field)}
          </div>
        ))}
        <p className="text-[10px] text-stone-600">
          The middle one advances on background dice at the end of a chapter, so its progress is
          the engine&apos;s to move, not yours.
        </p>
      </section>

      <section className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <p className="text-[11px] uppercase tracking-wide text-stone-500">
          How they feel about other people
        </p>
        <RelationEditor draft={draft} graph={graph} others={others} onChange={onChange} />
      </section>
    </>
  );
}
