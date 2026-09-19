"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { Field } from "@/app/workshop/kit";
import { TEMPLATE_NAME_MAX } from "@/lib/dm/encounter-template-logic";
import { MonsterRosterPicker } from "@/app/campaigns/[campaignId]/MonsterRosterPicker";
import { EncounterExtras } from "@/app/workshop/encounters/EncounterExtras";
import type { EncounterDraft, MapOption } from "@/app/workshop/encounters/types";

// The prepared-encounter form: a name, the roster (picked or typed), where it
// happens, which map, and the notes. Split out of DmEncounterPrepPanel so
// the workshop can show the same fields in a sheet over a row; the "card"
// variant is byte-for-byte what the DM console has always shown under its
// list, and the "sheet" variant is the same fields without the frame,
// because the sheet is the frame.

const field = ui.input;

export function EncounterForm({
  campaignId,
  value,
  onChange,
  maps,
  busy,
  submitLabel,
  onSubmit,
  variant = "card",
}: {
  campaignId: string;
  value: EncounterDraft;
  onChange: (next: EncounterDraft) => void;
  maps: MapOption[];
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  variant?: "card" | "sheet";
}) {
  const set = (patch: Partial<EncounterDraft>) => onChange({ ...value, ...patch });
  return (
    <section
      className={cn(
        variant === "card"
          ? "panel space-y-2 rounded-xl p-3"
          : "space-y-2",
      )}
    >
      <SectionHead title="The fight" glyph="system-encounters" className="mb-1" />
      <input
        value={value.name}
        maxLength={TEMPLATE_NAME_MAX}
        onChange={(event) => set({ name: event.target.value })}
        placeholder="Ambush at the ford"
        aria-label="Encounter name"
        className={field}
      />
      <SectionHead title="Who is in it" glyph="system-bestiary" className="mb-1 pt-1" />
      <div data-tour="encounters-picker">
        <MonsterRosterPicker
          campaignId={campaignId}
          roster={value.enemies}
          onChange={(enemies) => set({ enemies })}
        />
      </div>
      <textarea
        value={value.enemies}
        onChange={(event) => set({ enemies: event.target.value })}
        rows={3}
        placeholder={"goblin x4\nhobgoblin"}
        aria-label="Roster"
        className={field}
      />
      <p className="text-[11px] text-stone-500">
        One per line, name or slug, optional xN. The same shorthand Start a fight takes, so
        picking above and typing here are the same thing.
      </p>
      <SectionHead title="Where it happens" glyph="system-maps" className="mb-1 pt-1" />
      <input
        value={value.battlefield}
        onChange={(event) => set({ battlefield: event.target.value })}
        placeholder="a rope bridge over a gorge"
        aria-label="Battlefield"
        className={field}
      />
      <div data-tour="encounters-map">
        <Field label="On which map">
          <Select
            label="On which map"
            value={value.mapId}
            onChange={(mapId) => set({ mapId })}
            options={[
              { value: "", label: "Generator's choice", icon: { kind: "glyph", key: "die-d20" } },
              ...maps.map((map) => ({ value: map.id, label: map.name, icon: { kind: "glyph" as const, key: "system-maps" } })),
            ]}
          />
        </Field>
      </div>
      <EncounterExtras
        campaignId={campaignId}
        roster={value.enemies}
        map={maps.find((map) => map.id === value.mapId) ?? null}
        value={value.extras}
        onChange={(extras) => set({ extras })}
      />
      <SectionHead title="Notes" glyph="tab-notes" className="mb-1 pt-1" />
      <textarea
        value={value.notes}
        onChange={(event) => set({ notes: event.target.value })}
        rows={2}
        placeholder="Tactics, what they want, when they run."
        aria-label="Notes"
        className={field}
      />
      <button
        type="button"
        disabled={busy || !value.name.trim() || !value.enemies.trim()}
        onClick={onSubmit}
        data-tour="encounters-save"
        className={ui.btnPrimary}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {submitLabel}
      </button>
    </section>
  );
}
