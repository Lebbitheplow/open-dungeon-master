"use client";

import type { CSSProperties } from "react";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { abilityMod, formatModifier } from "@/lib/srd";
import type { Ability } from "@/lib/schemas/sheet";
import { rollTier, summaryLine } from "./abilityDice";
import { HpExplainerButton, type HpExplainerInput } from "./AbilityExplainers";

const HEAD = ["Ability", "Base", "Racial", "Final", "Mod"];

// The read-back under the six rows, cascading in once every ability has a
// number: base, racial bonus, final and modifier, the standout score named in
// a sentence, and the door to the health explainer. It never moves the wizard
// on by itself: the improvement cards below may still need an answer.
export function AbilitySummary({
  method,
  rows,
  who,
  hp,
}: {
  method: "standard" | "pointbuy" | "roll";
  rows: Array<{ ability: Ability; label: string; base: number; bonus: number }>;
  // "half-orc paladin", for the sentence. Empty when either is unknown.
  who: string;
  hp?: HpExplainerInput | null;
}) {
  let best: { label: string; final: number } | null = null;
  for (const row of rows) {
    const final = row.base + row.bonus;
    if (!best || final > best.final) {
      best = { label: row.label, final };
    }
  }
  const cell = "border-t border-stone-700/50 py-[5px] creator-cascade";
  return (
    <div className="creator-panel-in mt-4 rounded-xl border border-amber-500/30 bg-gradient-to-b from-stone-800/60 to-stone-950/75 p-3.5 sm:p-4">
      <Ribbon className="mb-1.5">Your scores</Ribbon>
      <p className="mb-3 font-serif text-sm leading-relaxed text-stone-300">{summaryLine({ method, best, who })}</p>
      <div className="grid grid-cols-[minmax(0,106px)_repeat(4,minmax(0,1fr))] items-center gap-x-2.5">
        {HEAD.map((label, index) => (
          <span
            key={label}
            className={cn(
              "pb-1.5 font-display text-[8.5px] font-semibold uppercase tracking-[0.2em] text-stone-500",
              index === 0 ? "text-left" : "text-center",
            )}
          >
            {label}
          </span>
        ))}
        {rows.map((row, index) => {
          const final = row.base + row.bonus;
          const style = { "--i": index } as CSSProperties;
          return (
            <div key={row.ability} className="contents">
              <span style={style} className={cn(cell, "truncate font-display text-[12.5px] font-semibold text-stone-100")}>
                {row.label}
              </span>
              <span style={style} className={cn(cell, "text-center font-mono text-xs text-stone-400")}>
                {row.base}
              </span>
              <span
                style={style}
                className={cn(cell, "text-center font-mono text-xs", row.bonus ? "text-amber-300" : "text-stone-600")}
              >
                {row.bonus ? `+${row.bonus}` : "·"}
              </span>
              <span
                style={style}
                className={cn(cell, "text-center font-display text-[17px] font-bold", `roll-tier-${rollTier(row.base)}`)}
              >
                {final}
              </span>
              <span style={style} className={cn(cell, "text-center font-mono text-xs text-stone-400")}>
                {formatModifier(abilityMod(final))}
              </span>
            </div>
          );
        })}
      </div>
      {hp ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <HpExplainerButton hp={hp} />
        </div>
      ) : null}
    </div>
  );
}
