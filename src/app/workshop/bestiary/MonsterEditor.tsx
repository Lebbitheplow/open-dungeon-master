"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { MONSTER_NAME_MAX, type MonsterDraft, type MonsterReadout } from "@/lib/bestiary/monster-draft";
import { crLabel } from "@/lib/bestiary/derive-cr";
import {
  AttackEditor,
  NumberField,
  RatingLine,
  SaveEditor,
  SizeAndDefences,
  TraitEditor,
  Working,
} from "@/app/campaigns/[campaignId]/MonsterFields";
import { MonsterKitPanel } from "@/app/campaigns/[campaignId]/MonsterKitFields";
import { CR_CHOICES, input } from "@/app/workshop/bestiary/types";

// One built monster, open for editing: the block's numbers, the catalogue
// over them, its attacks, saves, traits and defences, what it is, and the
// rating the numbers support with the working shown. Split out of
// DmBestiaryPanel so the workshop can show the same editor inside a sheet;
// the console still renders it inline under the monster's row, unchanged.
//
// "inline" is that console layout: fields wrap in a row under a border.
// "sheet" is the workshop's: the six core stats in a grid so a phone shows
// them two abreast, and from lg up two columns, the numbers and what they
// produce on the left and the catalogue and the defences on the right. The
// attack list stays under the stats rather than beside them so a phone,
// which reads the columns top to bottom, still meets the attacks before the
// catalogue that adds to them.

export function MonsterEditor({
  draft,
  desc,
  readout,
  busy,
  error,
  onDraft,
  onDesc,
  onSave,
  layout = "inline",
}: {
  draft: MonsterDraft;
  desc: string;
  readout: MonsterReadout | null;
  busy: boolean;
  error: string;
  onDraft: (draft: MonsterDraft) => void;
  onDesc: (desc: string) => void;
  onSave: () => void;
  layout?: "inline" | "sheet";
}) {
  const sheet = layout === "sheet";
  const setStats = (patch: Partial<MonsterDraft["stats"]>) =>
    onDraft({ ...draft, stats: { ...draft.stats, ...patch } });

  const coreStats = (
    <div
      className={cn(
        sheet ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "flex flex-wrap items-end gap-2",
      )}
    >
      <label className={cn("flex flex-col gap-0.5", sheet && "col-span-2 sm:col-span-3")}>
        <span className="text-[10px] uppercase tracking-wide text-stone-500">Name</span>
        <input
          value={draft.name}
          onChange={(event) =>
            onDraft({ ...draft, name: event.target.value.slice(0, MONSTER_NAME_MAX) })
          }
          className={cn(input, sheet ? "w-full" : "w-48")}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">Challenge</span>
        <select
          value={draft.stats.cr}
          onChange={(event) => setStats({ cr: Number(event.target.value) })}
          className={cn(input, sheet ? "w-full" : "w-24")}
        >
          {CR_CHOICES.map((cr) => (
            <option key={cr} value={cr}>
              {crLabel(cr)}
            </option>
          ))}
        </select>
      </label>
      <NumberField label="AC" value={draft.stats.ac} min={1} max={30} onChange={(ac) => setStats({ ac })} />
      <NumberField
        label="Hit points"
        value={draft.stats.maxHp}
        min={1}
        max={1000}
        onChange={(maxHp) => setStats({ maxHp })}
      />
      <NumberField
        label="Swings"
        value={draft.stats.attacksPerTurn ?? 1}
        min={1}
        max={3}
        onChange={(attacksPerTurn) => setStats({ attacksPerTurn })}
      />
      <NumberField
        label="Dex mod"
        value={draft.stats.dexMod}
        min={-5}
        max={10}
        onChange={(dexMod) => setStats({ dexMod })}
      />
    </div>
  );

  const extraDamage = (
    <NumberField
      label="Extra damage a round"
      value={draft.extraDamagePerRound}
      min={0}
      max={400}
      onChange={(extraDamagePerRound) => onDraft({ ...draft, extraDamagePerRound })}
      hint="A breath weapon or a round of spellcasting, averaged. The rating cannot see it otherwise."
    />
  );

  const description = (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">What it is</span>
      <textarea
        value={desc}
        onChange={(event) => onDesc(event.target.value)}
        rows={2}
        placeholder="A knight's armour walking with nobody inside it."
        className={cn(input, "w-full resize-y")}
      />
    </label>
  );

  const rating = readout ? (
    <>
      <RatingLine readout={readout} />
      <Working parts={readout.derived.parts} notes={readout.derived.notes} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {readout.against.map((row) => (
          <span key={row.label} className="text-stone-500">
            {row.label}{" "}
            <span
              className={cn(row.verdict === "as expected" ? "text-stone-400" : "text-amber-300/80")}
            >
              {row.stat}
            </span>{" "}
            <span className="text-stone-600">
              ({row.verdict}, CR {crLabel(readout.statedCr)} wants {row.expected})
            </span>
          </span>
        ))}
      </div>
    </>
  ) : null;

  const footer = (
    <>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 px-3 py-1 text-xs text-amber-100 hover:bg-stone-800 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save the block
        </button>
        <span className="text-[10px] text-stone-600">
          Saving recalculates the rating from what is on screen.
        </span>
      </div>
    </>
  );

  if (sheet) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6">
          <div className="flex flex-col gap-3">
            {coreStats}
            <AttackEditor draft={draft} onChange={onDraft} />
            <SaveEditor draft={draft} onChange={onDraft} />
            <TraitEditor draft={draft} onChange={onDraft} />
          </div>
          <div className="flex flex-col gap-3">
            <MonsterKitPanel draft={draft} onChange={onDraft} />
            <SizeAndDefences draft={draft} onChange={onDraft} />
            {extraDamage}
            {description}
          </div>
        </div>
        {rating}
        {footer}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-stone-800 p-3">
      {coreStats}
      <MonsterKitPanel draft={draft} onChange={onDraft} />
      <AttackEditor draft={draft} onChange={onDraft} />
      <SaveEditor draft={draft} onChange={onDraft} />
      <TraitEditor draft={draft} onChange={onDraft} />
      <SizeAndDefences draft={draft} onChange={onDraft} />
      {extraDamage}
      {description}
      {rating}
      {footer}
    </div>
  );
}
