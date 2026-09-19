"use client";

import { useState } from "react";
import { EyeOff, Flag, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { SectionHead } from "@/components/ui/SectionHead";
import { Field, OptionalStepper, addChip, chip, chipOn, rowIcon } from "@/app/workshop/kit";
import {
  EXTRAS_LIMITS,
  expandRoster,
  parseRoster,
  type TemplateExtras,
} from "@/lib/dm/encounter-template-logic";
import { TerrainCanvas } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import type { MapOption } from "@/app/workshop/encounters/types";
import { RefPicker } from "@/app/workshop/tables/RefPicker";

// The rest of a prepared fight (docs/workshop-parity-audit.md phase 13):
// where each enemy starts on the linked map, where the party comes in, who
// is hidden when it opens, which goblin is called Snik with three hit
// points, what the fight is worth, and what happens when. Everything here
// is indexed by slot into the expanded roster, so retyping the roster in
// the same order keeps the plan.

const field = ui.input;

export function EncounterExtras({
  campaignId,
  roster,
  map,
  value,
  onChange,
}: {
  campaignId: string;
  // The roster as typed; expanded here so the slots follow the text.
  roster: string;
  map: MapOption | null;
  value: TemplateExtras;
  onChange: (next: TemplateExtras) => void;
}) {
  const slots = expandRoster(parseRoster(roster));
  // Which slot the next tap on the map places; -1 is the party's entry.
  const [placing, setPlacing] = useState<number | null>(null);
  const set = (patch: Partial<TemplateExtras>) => onChange({ ...value, ...patch });
  const canPlace = Boolean(map?.terrain && map.width && map.height);

  const overrideFor = (slot: number) => value.overrides.find((entry) => entry.slot === slot);
  const setOverride = (slot: number, patch: { name?: string; hp?: number }) => {
    const rest = value.overrides.filter((entry) => entry.slot !== slot);
    const merged = { ...(overrideFor(slot) ?? { slot }), ...patch };
    const keep = (merged.name && merged.name.trim()) || (merged.hp && merged.hp > 0);
    set({ overrides: keep ? [...rest, merged] : rest });
  };

  function place(x: number, y: number) {
    if (placing === null) {
      return;
    }
    if (placing === -1) {
      set({ entry: value.entry && value.entry.x === x && value.entry.y === y ? null : { x, y } });
      return;
    }
    const rest = value.placements.filter((entry) => entry.slot !== placing);
    const existing = value.placements.find((entry) => entry.slot === placing);
    set({
      placements:
        existing && existing.x === x && existing.y === y ? rest : [...rest, { slot: placing, x, y }],
    });
  }

  // The plan drawn on the map as labels, and the entry as a prop, so no
  // new drawing code is needed to see it.
  const labels = value.placements
    .map((placement) => {
      const slot = slots.find((entry) => entry.slot === placement.slot);
      return slot
        ? { x: placement.x, y: placement.y, text: slot.label, dmOnly: value.hidden.includes(slot.slot) }
        : null;
    })
    .filter((label): label is NonNullable<typeof label> => label !== null);
  const props = value.entry ? [{ x: value.entry.x, y: value.entry.y, name: "Party enters", kind: "npc" as const }] : [];

  return (
    <div className="panel space-y-3 rounded-xl p-3">
      <SectionHead title="The plan" glyph="tab-battle" className="mb-0" />

      {slots.length ? (
        <ul className="stagger space-y-1">
          {slots.map((slot) => {
            const override = overrideFor(slot.slot);
            const placed = value.placements.find((entry) => entry.slot === slot.slot);
            const hidden = value.hidden.includes(slot.slot);
            return (
              <li key={slot.slot} className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  disabled={!canPlace}
                  aria-pressed={placing === slot.slot}
                  title={canPlace ? "Then tap the map where it starts" : "Link a prepared map to place it"}
                  onClick={() => setPlacing(placing === slot.slot ? null : slot.slot)}
                  className={cn(ui.btnSmall, chip, "min-w-28 text-left", placing === slot.slot && chipOn)}
                >
                  {slot.label}
                  {placed ? <span className="ml-1 text-stone-500">({placed.x},{placed.y})</span> : null}
                </button>
                <input
                  value={override?.name ?? ""}
                  placeholder="name"
                  maxLength={EXTRAS_LIMITS.name}
                  aria-label={`${slot.label} name`}
                  onChange={(event) => setOverride(slot.slot, { name: event.target.value })}
                  className={cn(field, "w-32 py-1.5")}
                />
                <OptionalStepper
                  value={override?.hp}
                  fallback={1}
                  min={1}
                  max={EXTRAS_LIMITS.hp}
                  suffix="hp"
                  label={`${slot.label} hit points`}
                  onChange={(next) => setOverride(slot.slot, { hp: next === "" ? undefined : next })}
                />
                <button
                  type="button"
                  aria-pressed={hidden}
                  title="Hidden when the fight opens"
                  onClick={() =>
                    set({ hidden: hidden ? value.hidden.filter((entry) => entry !== slot.slot) : [...value.hidden, slot.slot] })
                  }
                  className={cn(ui.btnSmall, addChip, hidden && "border-violet-700 bg-violet-950/40 text-violet-200")}
                >
                  <EyeOff className="size-3" /> {hidden ? "Hidden" : "Seen"}
                </button>
              </li>
            );
          })}
          <li className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              disabled={!canPlace}
              aria-pressed={placing === -1}
              onClick={() => setPlacing(placing === -1 ? null : -1)}
              className={cn(ui.btnSmall, addChip, placing === -1 && chipOn)}
            >
              <Flag className="size-3" /> Where the party comes in
              {value.entry ? <span className="text-stone-500">({value.entry.x},{value.entry.y})</span> : null}
            </button>
          </li>
        </ul>
      ) : (
        <p className="text-[11px] text-stone-500">Write the roster above and each creature gets a line here.</p>
      )}

      {canPlace && map?.terrain && map.width && map.height ? (
        <>
          <TerrainCanvas
            terrain={map.terrain}
            width={map.width}
            height={map.height}
            labels={labels}
            props={props}
            tool={placing === null ? null : { kind: "label" }}
            zoomable
            onLabel={place}
          />
          <p className="text-[11px] text-stone-500">
            {placing === null
              ? "Pick a creature above, then tap where it starts. The party goes where the flag says."
              : "Tap the tile. Tap the same tile again to clear it."}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-stone-500">
          Link a prepared map above to place each creature on it. Without one the generator seats them.
        </p>
      )}

      <SectionHead title="What the fight is worth" glyph="coin-purse" className="mb-0" />
      <Field as="label" label="Rewards">
        <textarea
          value={value.rewards}
          maxLength={EXTRAS_LIMITS.rewards}
          rows={2}
          placeholder="120 gp in a locked chest, the captain's signet ring, roll once on Marsh treasure."
          onChange={(event) => set({ rewards: event.target.value })}
          className={field}
        />
      </Field>
      {/* Pick the loot rather than spell it: a roll on one of this world's
          tables or an item from the catalogue lands as a line the deploy
          step resolves, the same @table: and @item: rows the tables use. */}
      <RefPicker
        campaignId={campaignId}
        editingId=""
        onInsert={(line) =>
          set({
            rewards: value.rewards.trim() ? `${value.rewards.replace(/\s+$/, "")}\n${line}` : line,
          })
        }
      />

      <div className="space-y-1.5 text-sm">
        <SectionHead title="What happens when" glyph="tab-timeline" className="mb-1" />
        {value.phases.map((phase, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              value={phase}
              maxLength={EXTRAS_LIMITS.phaseText}
              placeholder="When the shaman drops, the wolves flee."
              aria-label={`Phase ${index + 1}`}
              onChange={(event) =>
                set({ phases: value.phases.map((line, at) => (at === index ? event.target.value : line)) })
              }
              className={cn(field, "flex-1")}
            />
            <button
              type="button"
              aria-label="Remove phase"
              onClick={() => set({ phases: value.phases.filter((_, at) => at !== index) })}
              className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {value.phases.length < EXTRAS_LIMITS.phases ? (
          <button
            type="button"
            onClick={() => set({ phases: [...value.phases, ""] })}
            className={cn(ui.btnSmall, addChip)}
          >
            <Plus className="size-3" /> Add a phase
          </button>
        ) : null}
        <p className="text-[11px] text-stone-500">
          Rewards and phases land as a note only you can read when the fight is deployed.
        </p>
      </div>
    </div>
  );
}
