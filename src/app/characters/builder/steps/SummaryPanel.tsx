"use client";

import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { BlockerTarget } from "../submit";
import { summaryOwedCount, type SummaryRow, type SummaryRowKey } from "../summary";
import { StepPanel } from "./shared";

// The summary an edit opens on and a new build ends on (backlog F3): one
// row per step with its picks in plain words and an Edit that goes there.
// A pick still owed is said in words beside a warning mark, never by
// colour alone, with a Fix that goes to its step and its field.
export function SummaryPanel({
  rows,
  onEdit,
  onFix,
}: {
  rows: SummaryRow[];
  onEdit: (key: SummaryRowKey) => void;
  onFix: (target: BlockerTarget) => void;
}) {
  const owed = summaryOwedCount(rows);
  return (
    <StepPanel title="Your hero" ornate className="border-amber-500/30">
      <p className="text-xs text-stone-400" data-summary-owed={owed}>
        {owed
          ? `${owed === 1 ? "One pick is" : `${owed} picks are`} still to choose. Fix goes straight to each one.`
          : "Every step is complete. Edit any row to change it."}
      </p>
      <ul className="mt-2 divide-y divide-stone-800/70 text-sm" data-finish-summary>
        {rows.map((row) => (
          <li
            key={row.key}
            data-summary-row={row.key}
            data-owed={row.owed.length || undefined}
            className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-3"
          >
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-medium tracking-wide text-stone-400">{row.label}</h4>
              <ul className="mt-0.5 space-y-0.5 text-stone-200">
                {row.lines.map((line) => (
                  <li key={line} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
              {row.owed.length ? (
                <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-950/20 px-2.5 py-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-100">
                    <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                    Still to choose:
                  </p>
                  <ul className="mt-1 space-y-1">
                    {row.owed.map((pick) => (
                      <li key={pick.target} className="flex flex-wrap items-center gap-x-2 text-xs text-amber-100/90">
                        <span className="min-w-0 flex-1">{pick.message}</span>
                        <button
                          type="button"
                          onClick={() => onFix(pick.target)}
                          data-summary-fix={pick.target}
                          aria-label={`Fix ${pick.label}`}
                          className="-my-1 min-h-10 shrink-0 px-2 font-mono text-xs text-amber-300 underline underline-offset-2 hover:text-amber-200"
                        >
                          Fix
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onEdit(row.key)}
              data-summary-edit={row.key}
              aria-label={`Edit ${row.label}`}
              className={cn(ui.btnSmall, "min-h-10 shrink-0 self-start px-3 text-xs")}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
    </StepPanel>
  );
}
