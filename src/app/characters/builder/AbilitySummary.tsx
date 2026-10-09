"use client";

import type { CSSProperties } from "react";
import { CountPop } from "@/components/ui/Reveal";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { abilityMod, formatModifier } from "@/lib/srd";
import type { Ability } from "@/lib/schemas/sheet";
import { rollTier, summaryLine } from "./abilityDice";
import { HpExplainerButton, type HpExplainerInput } from "./AbilityExplainers";

// The read-back under the six rows, cascading in once every ability has a
// number: base, racial bonus, what improvements and feats added (a column
// only when something did), final and modifier, the standout score named in
// a sentence, and the door to the health explainer. It never moves the wizard
// on by itself: the improvement cards below may still need an answer.
export function AbilitySummary({
  method,
  rows,
  who,
  hp,
}: {
  method: "standard" | "pointbuy" | "roll";
  // `added` is everything after the racial bonus (abilityGains.ts).
  rows: Array<{ ability: Ability; label: string; base: number; bonus: number; added: number }>;
  // "half-orc paladin", for the sentence. Empty when either is unknown.
  who: string;
  hp?: HpExplainerInput | null;
}) {
  const anyAdded = rows.some((row) => row.added !== 0);
  const head = anyAdded ? ["Ability", "Base", "Racial", "Added", "Final", "Mod"] : ["Ability", "Base", "Racial", "Final", "Mod"];
  let best: { label: string; final: number } | null = null;
  for (const row of rows) {
    const final = row.base + row.bonus + row.added;
    if (!best || final > best.final) {
      best = { label: row.label, final };
    }
  }
  const cell = "border-t border-stone-700/50 py-[5px] creator-cascade";
  return (
    <div className="creator-panel-in mt-4 rounded-xl border border-amber-500/30 bg-gradient-to-b from-stone-800/60 to-stone-950/75 p-3.5 sm:p-4">
      <Ribbon className="mb-1.5">Your scores</Ribbon>
      <p className="mb-3 font-serif text-sm leading-relaxed text-stone-300">{summaryLine({ method, best, who })}</p>
      <div
        className={cn(
          "grid items-center gap-x-2.5",
          // A phone names the abilities as the rows above do (STR, DEX), so
          // the numbers keep their columns; the full names from sm up.
          anyAdded
            ? "grid-cols-[minmax(0,40px)_repeat(5,minmax(0,1fr))] sm:grid-cols-[minmax(0,96px)_repeat(5,minmax(0,1fr))]"
            : "grid-cols-[minmax(0,40px)_repeat(4,minmax(0,1fr))] sm:grid-cols-[minmax(0,106px)_repeat(4,minmax(0,1fr))]",
        )}
      >
        {head.map((label, index) => (
          <span
            key={label}
            className={cn(
              "pb-1.5 font-display text-[8.5px] font-semibold uppercase tracking-[0.12em] text-stone-500 sm:tracking-[0.2em]",
              index === 0 ? "text-left" : "text-center",
            )}
          >
            {label}
          </span>
        ))}
        {rows.map((row, index) => {
          const final = row.base + row.bonus + row.added;
          const style = { "--i": index } as CSSProperties;
          return (
            <div key={row.ability} className="contents">
              <span style={style} className={cn(cell, "truncate font-display text-[12.5px] font-semibold text-stone-100")}>
                <span className="font-mono text-[11px] sm:hidden" aria-hidden="true">
                  {row.ability.toUpperCase()}
                </span>
                <span className="sr-only sm:not-sr-only">{row.label}</span>
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
              {anyAdded ? (
                <span
                  style={style}
                  className={cn(cell, "text-center font-mono text-xs", row.added ? "text-amber-200" : "text-stone-600")}
                >
                  {row.added ? <CountPop value={row.added}>+{row.added}</CountPop> : "·"}
                </span>
              ) : null}
              <span
                style={style}
                className={cn(cell, "text-center font-display text-[17px] font-bold", `roll-tier-${rollTier(row.base)}`)}
              >
                <CountPop value={final} />
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
