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
  // An empty bonus cell shows a dot and reads as "none".
  const none = (
    <>
      <span aria-hidden="true">·</span>
      <span className="sr-only">none</span>
    </>
  );
  const cell = "border-t border-stone-700/50 px-1 py-[5px] align-middle creator-cascade";
  return (
    <div className="creator-panel-in mt-4 rounded-xl border border-amber-500/30 bg-gradient-to-b from-stone-800/60 to-stone-950/75 p-3.5 sm:p-4">
      <Ribbon className="mb-1.5">Your scores</Ribbon>
      <p className="mb-3 font-serif text-sm leading-relaxed text-stone-300">{summaryLine({ method, best, who })}</p>
      {/* A real table, so a screen reader can read each score against its
          column (Base, Racial, Final). The fixed layout keeps the columns the
          old grid gave: a narrow name column on a phone, wider from sm up. */}
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Your scores</caption>
        <colgroup>
          <col className={anyAdded ? "w-10 sm:w-24" : "w-10 sm:w-[106px]"} />
          {head.slice(1).map((label) => (
            <col key={label} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {head.map((label, index) => (
              <th
                key={label}
                scope="col"
                className={cn(
                  "px-1 pb-1.5 font-display text-[0.875rem] font-semibold uppercase tracking-[0.12em] text-stone-500 sm:tracking-[0.2em]",
                  index === 0 ? "pl-0 text-left" : "text-center",
                )}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const final = row.base + row.bonus + row.added;
            const style = { "--i": index } as CSSProperties;
            return (
              <tr key={row.ability}>
                <th
                  scope="row"
                  style={style}
                  className={cn(cell, "truncate pl-0 text-left font-display text-base font-semibold text-stone-100")}
                >
                  <span className="font-mono text-[0.875rem] sm:hidden" aria-hidden="true">
                    {row.ability.toUpperCase()}
                  </span>
                  <span className="sr-only sm:not-sr-only">{row.label}</span>
                </th>
                <td style={style} className={cn(cell, "text-center font-mono text-xs text-stone-400")}>
                  {row.base}
                </td>
                <td
                  style={style}
                  className={cn(cell, "text-center font-mono text-xs", row.bonus ? "text-amber-300" : "text-stone-500")}
                >
                  {row.bonus ? `+${row.bonus}` : none}
                </td>
                {anyAdded ? (
                  <td
                    style={style}
                    className={cn(cell, "text-center font-mono text-xs", row.added ? "text-amber-200" : "text-stone-500")}
                  >
                    {row.added ? <CountPop value={row.added}>+{row.added}</CountPop> : none}
                  </td>
                ) : null}
                <td
                  style={style}
                  className={cn(cell, "text-center font-display text-[1.0625rem] font-bold", `roll-tier-${rollTier(row.base)}`)}
                >
                  <CountPop value={final} />
                </td>
                <td style={style} className={cn(cell, "text-center font-mono text-xs text-stone-400")}>
                  {formatModifier(abilityMod(final))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hp ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <HpExplainerButton hp={hp} />
        </div>
      ) : null}
    </div>
  );
}
