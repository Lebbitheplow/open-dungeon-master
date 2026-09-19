"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { TTS_VOICES } from "@/lib/tts-voices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import {
  ATTITUDES,
  type GeneratableField,
  type NpcDraft,
  type RelationGraph,
} from "@/lib/npcs/forge";
import { npcRoleOptions } from "@/lib/placeholders";
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
//
// `genre` orders the role picker: the setting's own roles (a fixer, a street
// doc) come before the twelve every table gets. The picker is a datalist, so
// a role the catalog does not know can still be typed and kept.

export function NpcEditorFields({
  draft,
  onChange,
  graph,
  others,
  suggest,
  genre,
  places = [],
  factions = [],
}: {
  draft: NpcDraft;
  onChange: (draft: NpcDraft) => void;
  graph: RelationGraph;
  others: string[];
  suggest: (field: GeneratableField) => ReactNode;
  genre?: string | null;
  // The named places this world already has (the overworld's locations and
  // the geography lore), offered under the location field.
  places?: readonly string[];
  // The world's factions, for the membership picker.
  factions?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const roleListId = useId();
  const placeListId = useId();
  const roles = npcRoleOptions(genre);
  return (
    <>
      <section
        className="panel space-y-2 rounded-xl p-3"
        data-tour="cast-fields"
      >
        <SectionHead title="On the surface" glyph="system-cast" className="mb-0" />
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder="Their name"
            className={cn(ui.input, "min-w-32 flex-1")}
          />
          <input
            list={roleListId}
            value={draft.role}
            onChange={(event) => onChange({ ...draft, role: event.target.value })}
            placeholder="What they do"
            aria-label="Role: pick one or type your own"
            title="Pick a role or type your own. It chooses their stand-in face until a portrait exists."
            className={cn(ui.input, "w-full sm:w-40")}
          />
          <datalist id={roleListId}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </datalist>
          <span className="w-full sm:w-60">
          <Select<NpcDraft["attitude"]>
            label="Attitude to the party"
            value={draft.attitude}
            onChange={(attitude) => onChange({ ...draft, attitude })}
            options={ATTITUDES.map((attitude) => ({
              value: attitude,
              label:
                attitude === "hostile"
                  ? "Hostile to the party"
                  : attitude === "friendly"
                    ? "Friendly to the party"
                    : "Indifferent",
              icon: {
                kind: "glyph" as const,
                key: attitude === "hostile" ? "attitude-hostile" : attitude === "friendly" ? "attitude-friendly" : "attitude-neutral",
              },
            }))}
          />
          </span>
        </div>

        <input
          value={draft.location}
          list={places.length ? placeListId : undefined}
          onChange={(event) => onChange({ ...draft, location: event.target.value })}
          placeholder="Where they are usually found"
          aria-label="Location: pick a place on the map or type your own"
          className={ui.input}
        />
        {places.length ? (
          <datalist id={placeListId}>
            {places.map((place) => (
              <option key={place} value={place} />
            ))}
          </datalist>
        ) : null}

        <input
          value={draft.aliases.join(", ")}
          onChange={(event) =>
            onChange({
              ...draft,
              aliases: event.target.value.split(",").map((alias) => alias.trim()).filter(Boolean),
            })
          }
          placeholder="Other names they answer to, separated by commas"
          className={ui.input}
        />

        <div className="flex items-start gap-1.5">
          <textarea
            value={draft.trait}
            onChange={(event) => onChange({ ...draft, trait: event.target.value })}
            rows={2}
            placeholder="What a player notices about them first"
            className={cn(ui.input, "min-w-0 flex-1")}
          />
          {suggest("trait")}
        </div>

        {factions.length ? (
          <Select
            label="Faction"
            value={draft.factionId}
            onChange={(factionId) => onChange({ ...draft, factionId })}
            options={[
              { value: "", label: "No faction" },
              ...factions.map((faction) => ({ value: faction.id, label: faction.name, icon: { kind: "glyph" as const, key: "system-factions" } })),
            ]}
          />
        ) : null}

        {/* Their own read-aloud voice (docs/vtt-parity-implementation-plan.md
            8.2): a Kokoro voice and a pace, previewed here, heard on every
            line attributed to them. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <GameIcon icon={{ kind: "glyph", key: "tab-ambience" }} size="size-7" />
          <span className="min-w-0 flex-1 sm:max-w-72">
          <Select
            label="Voice"
            value={draft.voice?.voiceId ?? ""}
            onChange={(voiceId) =>
              onChange({
                ...draft,
                voice: voiceId ? { voiceId, speed: draft.voice?.speed ?? 1 } : null,
              })
            }
            options={[
              { value: "", label: "The narrator's voice" },
              ...TTS_VOICES.map((voice) => ({ value: voice.id as string, label: voice.label })),
            ]}
          />
          </span>
          {draft.voice ? (
            <>
              <VoicePreviewButton voice={draft.voice.voiceId} />
              <span className="flex items-center gap-2 text-xs text-stone-400">
                Pace
                <span className="w-28">
                <Slider
                  label="Pace"
                  min={0.7}
                  max={1.4}
                  step={0.05}
                  value={draft.voice.speed}
                  onChange={(speed) => onChange({ ...draft, voice: { voiceId: draft.voice!.voiceId, speed } })}
                  bubble={(speed) => speed.toFixed(2)}
                />
                </span>
                <span className="w-8 text-stone-500">{draft.voice.speed.toFixed(2)}</span>
              </span>
            </>
          ) : null}
        </div>
      </section>

      <section className="panel space-y-2 rounded-xl p-3">
        <SectionHead title="Who they are" glyph="tab-bonds" className="mb-0" aside={suggest("personality")} />
        <PersonalitySliders draft={draft} onChange={onChange} />
      </section>

      <section className="panel space-y-2 rounded-xl p-3">
        <SectionHead title="What they want" glyph="quest-active" className="mb-0" />
        {GOAL_FIELDS.map(([field, placeholder]) => (
          <div key={field} className="flex items-center gap-1.5">
            <input
              value={goalText(draft, field)}
              onChange={(event) => onChange(setGoal(draft, field, event.target.value))}
              placeholder={placeholder}
              className={cn(ui.input, "min-w-0 flex-1")}
            />
            {field === "session" && draft.goals.session ? (
              <span className="shrink-0 text-[11px] text-stone-500">
                {draft.goals.session.progress}/{draft.goals.session.target}
              </span>
            ) : null}
            {suggest(field)}
          </div>
        ))}
        <p className="text-[11px] text-stone-500">
          The middle one advances on background dice at the end of a chapter, so its progress is
          the engine&apos;s to move, not yours.
        </p>
      </section>

      <section className="panel space-y-2 rounded-xl p-3">
        <SectionHead title="How they feel about other people" glyph="attitude-wary" className="mb-0" />
        <RelationEditor draft={draft} graph={graph} others={others} onChange={onChange} />
      </section>
    </>
  );
}
