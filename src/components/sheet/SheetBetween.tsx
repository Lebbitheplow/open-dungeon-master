"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Life between adventures on the sheet (SRD 5.1, Between Adventures, and the
// diseases, madness and poisons of Running the Game): the lifestyle paid at
// each dawn, crafting, training, research and recuperating progress, and the
// afflictions the engine holds. The lines are the engine's own
// (GET /sheet/between, src/lib/dm/between-lines.ts), asked again whenever the
// sheet changes (a dawn charges the purse, a rest moves a disease). A line
// only the DM sees (a disease still incubating) is marked as such. Rows
// arrive on the sheet's stagger (motion-app.css .stagger-up).

type BetweenLine = { text: string; kind: "affliction" | "between"; secret?: boolean };

export function SheetBetween({ sheet, className }: { sheet: CharacterSheet; className?: string }) {
  const [lines, setLines] = useState<BetweenLine[]>([]);
  // The purse, the conditions and the edit stamp change when the engine
  // charges a lifestyle, moves a disease or finishes a craft.
  const stamp = `${sheet.updatedAt}|${sheet.gold}|${sheet.conditions.join(",")}`;

  useEffect(() => {
    let live = true;
    fetch(`/api/campaigns/${sheet.campaignId}/sheet/between?characterId=${encodeURIComponent(sheet.id)}`)
      .then((response): Promise<{ lines?: BetweenLine[] }> | { lines?: BetweenLine[] } =>
        response.ok ? (response.json() as Promise<{ lines?: BetweenLine[] }>) : {},
      )
      .then((data) => {
        if (live) setLines(Array.isArray(data.lines) ? data.lines : []);
      })
      .catch(() => {
        if (live) setLines([]);
      });
    return () => {
      live = false;
    };
  }, [sheet.campaignId, sheet.id, stamp]);

  if (!lines.length) return null;
  return (
    <div className={cn("reveal rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2", className)}>
      <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-stone-500">Between adventures</p>
      <ul className="stagger-up space-y-0.5 text-xs">
        {lines.map((line) => (
          <li
            key={line.text}
            className={cn(
              "flex items-start gap-1.5",
              line.kind === "affliction" ? "text-red-200/90" : "text-stone-300",
            )}
          >
            <span aria-hidden="true" className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", line.kind === "affliction" ? "bg-red-400/80" : "bg-amber-400/70")} />
            <span>
              {line.text}
              {line.secret ? <span className="ml-1 text-[10px] uppercase tracking-wide text-stone-500">(DM only)</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
