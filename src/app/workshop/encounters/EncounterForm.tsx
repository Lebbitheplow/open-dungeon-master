"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { TEMPLATE_NAME_MAX } from "@/lib/dm/encounter-template-logic";
import { MonsterRosterPicker } from "@/app/campaigns/[campaignId]/MonsterRosterPicker";
import type { EncounterDraft, MapOption } from "@/app/workshop/encounters/types";

// The prepared-encounter form: a name, the roster (picked or typed), where it
// happens, which map, and the notes. Split out of DmEncounterPrepPanel so
// the workshop can show the same fields in a sheet over a row; the "card"
// variant is byte-for-byte what the DM console has always shown under its
// list, and the "sheet" variant is the same fields without the frame,
// because the sheet is the frame.

const field =
  "w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200";

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
          ? "space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2"
          : "space-y-2",
      )}
    >
      <input
        value={value.name}
        maxLength={TEMPLATE_NAME_MAX}
        onChange={(event) => set({ name: event.target.value })}
        placeholder="Ambush at the ford"
        aria-label="Encounter name"
        className={field}
      />
      <MonsterRosterPicker
        campaignId={campaignId}
        roster={value.enemies}
        onChange={(enemies) => set({ enemies })}
      />
      <textarea
        value={value.enemies}
        onChange={(event) => set({ enemies: event.target.value })}
        rows={3}
        placeholder={"goblin x4\nhobgoblin"}
        aria-label="Roster"
        className={field}
      />
      <p className="text-[10px] text-stone-600">
        One per line, name or slug, optional xN. The same shorthand Start a fight takes, so
        picking above and typing here are the same thing.
      </p>
      <input
        value={value.battlefield}
        onChange={(event) => set({ battlefield: event.target.value })}
        placeholder="a rope bridge over a gorge"
        aria-label="Battlefield"
        className={field}
      />
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">On which map</span>
        <select
          value={value.mapId}
          onChange={(event) => set({ mapId: event.target.value })}
          className={cn(field, "mt-0.5")}
        >
          <option value="">Generator&apos;s choice</option>
          {maps.map((map) => (
            <option key={map.id} value={map.id}>
              {map.name}
            </option>
          ))}
        </select>
      </label>
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
        className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {submitLabel}
      </button>
    </section>
  );
}
