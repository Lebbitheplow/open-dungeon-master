"use client";

import { Heart, Shield } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived, formatModifier } from "@/lib/srd";

export function PartyPanel({
  sheets,
  meUserId,
  onAdjustHp,
}: {
  sheets: CharacterSheet[];
  meUserId: string;
  onAdjustHp: (delta: number) => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 space-y-3 overflow-y-auto border-l border-stone-800 p-3 lg:block">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-stone-500">Party</h2>
      {sheets.map((sheet) => {
        const derived = computeSheetDerived(sheet);
        const mine = sheet.userId === meUserId;
        const hpFraction = sheet.maxHp > 0 ? sheet.currentHp / sheet.maxHp : 0;
        return (
          <div
            key={sheet.id}
            className={cn(
              "rounded-lg border p-3",
              mine ? "border-amber-900 bg-amber-950/20" : "border-stone-800 bg-stone-950/40",
            )}
          >
            <p className="font-medium">{sheet.name}</p>
            <p className="text-xs text-stone-400">
              {sheet.race.replaceAll("_", " ")} {sheet.class} {sheet.level}
            </p>

            <div className="mt-2 flex items-center gap-2 text-sm">
              <Heart className="size-4 text-red-400" />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800">
                <div
                  className={cn(
                    "h-full rounded-full",
                    hpFraction > 0.5 ? "bg-emerald-600" : hpFraction > 0.25 ? "bg-amber-600" : "bg-red-600",
                  )}
                  style={{ width: `${Math.max(0, Math.min(1, hpFraction)) * 100}%` }}
                />
              </div>
              <span className="font-mono text-xs">
                {sheet.currentHp}
                {sheet.tempHp ? `+${sheet.tempHp}` : ""}/{sheet.maxHp}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-3 text-xs text-stone-400">
              <span className="flex items-center gap-1">
                <Shield className="size-3.5" /> AC {sheet.ac}
              </span>
              <span>PP {derived.passivePerception}</span>
              <span>Init {formatModifier(derived.initiative)}</span>
            </div>

            {sheet.conditions.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {sheet.conditions.map((condition) => (
                  <span
                    key={condition}
                    className="rounded-full bg-red-950 px-2 py-0.5 text-xs text-red-300"
                  >
                    {condition}
                  </span>
                ))}
              </div>
            ) : null}

            {mine ? (
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onAdjustHp(-1)}
                  className="flex-1 rounded border border-stone-700 py-1 text-xs hover:bg-stone-900"
                >
                  -1 HP
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustHp(1)}
                  className="flex-1 rounded border border-stone-700 py-1 text-xs hover:bg-stone-900"
                >
                  +1 HP
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </aside>
  );
}
