"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Ability } from "@/lib/schemas/sheet";
import { useLowEffects } from "@/lib/effects-mode";
import { cn } from "@/lib/cn";
import { buildMathSections, createChangeAnnouncer } from "./buildMath";
import type { BuilderDerived } from "./useBuilderDerived";

// The build math table (backlog F10): every number the sheet will carry,
// with the parts each is made of, beside the picks on every step. Where the
// builder is wide (a 56rem container, which creator.css gives the page on a
// desktop) it is a column of its own, always open; where it is narrow, a
// phone or the companion dialog, it sits under the steps, folded until
// opened. The rows are buildMath.ts's, read
// from the calculations the save uses.
export function BuildMathPanel({
  derived,
  scores,
  klass,
  atTable,
}: {
  derived: BuilderDerived;
  scores: Record<Ability, number | null>;
  klass: { name: string; hitDie: number } | undefined;
  atTable: boolean;
}) {
  const headingId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const low = useLowEffects();
  const sections = useMemo(
    () => buildMathSections({ derived, scores, klass, atTable }),
    [derived, scores, klass, atTable],
  );

  // One short polite line per burst of changes (buildMath.ts).
  const [spoken, setSpoken] = useState("");
  const announcer = useRef<ReturnType<typeof createChangeAnnouncer> | null>(null);
  useEffect(() => {
    const made = createChangeAnnouncer({ say: setSpoken });
    announcer.current = made;
    return () => made.dispose();
  }, []);
  useEffect(() => {
    announcer.current?.update(sections);
  }, [sections]);

  // A row is keyed by its number, so one whose number moves is a new row
  // and its flash plays once, where the device plays effects. The rows of
  // the first full table are where things started, not changes.
  const [first, setFirst] = useState<Set<string> | null>(null);
  if (first === null && sections.length) {
    setFirst(new Set(sections.flatMap((section) => section.rows.map((row) => rowKey(row)))));
  }
  const changed = (row: { id: string; value: string }) => !low && first !== null && !first.has(rowKey(row));

  const cell = "border-t border-stone-800 px-2 py-1.5 align-top text-base";
  return (
    <aside
      aria-labelledby={headingId}
      data-build-math=""
      className={cn(
        "flex min-h-0 shrink-0 flex-col rounded-xl border border-stone-800 bg-stone-950/60",
        open ? "max-h-[55%]" : "",
        "@4xl:h-full @4xl:max-h-none @4xl:w-[24rem] @6xl:w-[28rem]",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-1">
        <h2 id={headingId} className="min-w-0 flex-1 font-display text-base tracking-wide text-amber-100">
          Build math
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((was) => !was)}
          className="flex min-h-11 items-center gap-1 rounded-md px-2 text-base text-sky-300 transition-colors hover:bg-stone-800 @4xl:hidden"
        >
          {open ? "Hide the numbers" : "Show the numbers"}
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {spoken}
      </p>
      {/* Scrolls on its own, so it takes a tab stop and is named for it. */}
      <div
        id={bodyId}
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto rounded-b-xl px-3 pb-3 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70",
          open ? "block" : "hidden",
          "@4xl:block",
        )}
      >
        {sections.length ? (
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">Every number on the sheet and how it is made</caption>
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[26%]" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="px-2 pb-1 text-sm font-semibold text-stone-400">
                  Number
                </th>
                <th scope="col" className="px-2 pb-1 text-sm font-semibold text-stone-400">
                  Value
                </th>
                <th scope="col" className="px-2 pb-1 text-sm font-semibold text-stone-400">
                  How it is made
                </th>
              </tr>
            </thead>
            {sections.map((section) => (
              <tbody key={section.id} data-build-math-section={section.id}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="px-2 pb-1 pt-3 font-display text-base font-semibold text-amber-200/90"
                  >
                    {section.title}
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    data-row={row.id}
                    className={changed(row) ? "flash-changed" : undefined}
                  >
                    <th scope="row" className={cn(cell, "font-normal text-stone-200")}>
                      {row.label}
                    </th>
                    <td className={cn(cell, "break-words font-mono text-amber-100")}>{row.value}</td>
                    <td className={cn(cell, "break-words text-stone-400")}>{row.working}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        ) : (
          <p className="text-base text-stone-400">
            The numbers appear here once your hero has a class, an ancestry, a background and six scores.
          </p>
        )}
      </div>
    </aside>
  );
}

function rowKey(row: { id: string; value: string }) {
  return `${row.id}:${row.value}`;
}
