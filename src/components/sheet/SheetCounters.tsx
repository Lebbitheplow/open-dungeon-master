"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { InfoButton } from "@/components/ui/InfoDialog";
import { counterView } from "@/components/sheet/sheet-state";

// The character sheet's counters: a spell slot level as marks, and a class
// resource's row with the engine's reading of it. Split from
// CharacterSheetDialog.tsx, which posts the spends and the corrections.

export const STEP_BUTTON =
  "flex items-center justify-center rounded border border-stone-700 p-0.5 text-stone-300 hover:bg-stone-800 disabled:opacity-40";

// One spell slot level: a mark per slot, filled while it is still there.
export function SlotRow({
  label,
  left,
  max,
  spends,
  corrects,
  busy,
  onSpend,
  onRecover,
}: {
  label: string;
  left: number;
  max: number;
  // May mark a slot spent: the sheet's owner, and whoever corrects.
  spends: boolean;
  // May hand a slot back: the DM and the party lead only.
  corrects: boolean;
  busy: boolean;
  onSpend?: () => void;
  onRecover?: () => void;
}) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-lg border border-stone-800 px-2 py-1"
      title={`${left} of ${max} ${label.toLowerCase()} slots left`}
    >
      <span className="font-display text-[11px] tracking-wide text-stone-400">{label}</span>
      <span className="flex gap-0.5" aria-label={`${left} of ${max} left`}>
        {Array.from({ length: max }, (_, index) => (
          <span
            key={index}
            className={cn(
              "size-2.5 rounded-full border",
              index < left
                ? "border-amber-400 bg-amber-400/80 shadow-[0_0_6px_rgba(212,171,58,0.5)]"
                : "border-stone-600",
            )}
          />
        ))}
      </span>
      {spends ? (
        <button
          type="button"
          className={STEP_BUTTON}
          disabled={busy || left <= 0}
          title="Mark one slot as spent"
          aria-label={`Spend a ${label} slot`}
          onClick={onSpend}
        >
          <Minus className="size-3" />
        </button>
      ) : null}
      {corrects ? (
        <button
          type="button"
          className={STEP_BUTTON}
          disabled={busy || left >= max}
          title="Correction: give one slot back"
          aria-label={`Give back a ${label} slot`}
          onClick={onRecover}
        >
          <Plus className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

// One class resource. The engine's reading of the counter: an uncapped one
// counts uses (Overchannel), a passive one is spent by the cast.
export function ResourceRow({
  id,
  pool,
  name,
  help,
  spends,
  corrects,
  busy,
  deadNote,
  onSpend,
  onRecover,
}: {
  id: string;
  pool: { max: number; used: number };
  name: string;
  help?: string;
  // May mark a use spent: the sheet's owner, and whoever corrects.
  spends: boolean;
  // May hand a use back: the DM and the party lead only.
  corrects: boolean;
  busy: boolean;
  // The usage route's refusal for a dead character's spend.
  deadNote: string | null;
  onSpend: () => void;
  onRecover: () => void;
}) {
  const counter = counterView(id, pool);
  return (
  <div className="flex items-center gap-2">
    <span className="flex w-36 shrink-0 items-center gap-1 text-stone-400">
      {name}
        <InfoButton label={name} text={help} />
    </span>
    {spends && counter.spendable ? (
      <button
        type="button"
        className={STEP_BUTTON}
        disabled={busy || pool.used >= pool.max || Boolean(deadNote)}
        title={deadNote ?? "Spend a use"}
        onClick={onSpend}
      >
        <Minus className="size-3" />
      </button>
    ) : null}
    <span key={pool.used} className="motion-pop inline-block" title={counter.note ?? undefined}>
      {counter.line}
    </span>
    {/* Relentless Rage's DC climbs with each use since the
        last rest (the engine's count). */}
    {id === "relentless_rage" ? (
      <span className="text-[11px] text-stone-500">next DC {10 + 5 * pool.used}</span>
    ) : null}
    {corrects ? (
      <button
        type="button"
        className={STEP_BUTTON}
        disabled={busy || pool.used <= 0}
        title="Correction: give a use back"
        onClick={onRecover}
      >
        <Plus className="size-3" />
      </button>
    ) : null}
  </div>
  );
}
