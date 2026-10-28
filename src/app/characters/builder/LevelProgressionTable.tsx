"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { formatModifier } from "@/lib/srd";
import { FIGHTING_STYLES } from "@/lib/srd/feature-effects";
import { levelProgressionRows, progressionColumns, slotWords, type ProgressionInput, type ProgressionRow } from "./levelProgression";
import type { ClassOption } from "./useBuilderOptions";
import type { BuilderDerived } from "./useBuilderDerived";
import type { BuilderState } from "./useBuilderState";
import { StepPanel } from "./steps/shared";

// The level progression table (backlog F8): a real table, with a header
// row and each level as a row header, so a screen reader moves across a
// level's columns and down a column's levels. It never widens the page: on
// a phone the table scrolls sideways inside its own box, which takes focus
// so the keyboard can scroll it too, and the level column stays in view.
//
// Folded until asked for: it is reference, not a choice, and open it put up
// to twenty wide rows between the picks and the button that saves them.
export function LevelProgressionTable({
  rows,
  who,
  className,
  defaultOpen = false,
}: {
  rows: ProgressionRow[];
  // Whose levels these are, for the caption ("Brann's levels").
  who: string;
  className?: string;
  defaultOpen?: boolean;
}) {
  const captionId = useId();
  const boxId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const columns = progressionColumns(rows);
  const last = rows[rows.length - 1]?.level ?? 1;
  const cell = "border-t border-stone-800/70 px-2.5 py-2 align-top";
  const head = "px-2.5 py-2 text-left font-medium text-stone-400";
  const none = (
    <>
      <span aria-hidden="true" className="text-stone-600">
        -
      </span>
      <span className="sr-only">None</span>
    </>
  );
  const toChoose = <span className="text-amber-300">Still to choose</span>;
  return (
    <StepPanel title="Level by level" className={cn("border-amber-500/20", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 text-xs text-stone-500">
          What each level from 1 to {last} grants, with {who}&apos;s pick where there is one.
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={boxId}
          onClick={() => setOpen((was) => !was)}
          data-level-table-toggle=""
          className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-sky-300 transition-colors hover:bg-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          {open ? "Hide the levels" : "Show each level"}
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <div
        id={boxId}
        hidden={!open}
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
        data-level-table-scroll=""
        // Relative, so the screen-reader-only words in the cells (absolute)
        // are held inside the box and never widen the page.
        className="relative reveal mt-2 max-w-full overflow-x-auto rounded-lg border border-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
      >
        <table data-level-table="" className="w-full min-w-[36rem] border-collapse text-xs text-stone-300">
          <caption id={captionId} className="sr-only">
            {who}&apos;s levels, 1 to {last}
          </caption>
          <thead className="bg-stone-950/60">
            <tr>
              <th scope="col" className={cn(head, "sticky left-0 bg-stone-950")}>
                Level
              </th>
              <th scope="col" className={head}>
                Proficiency bonus
              </th>
              <th scope="col" className={head}>
                Features
              </th>
              {columns.subclass ? (
                <th scope="col" className={head}>
                  Subclass
                </th>
              ) : null}
              <th scope="col" className={head}>
                Ability score improvement or feat
              </th>
              {columns.casting ? (
                <>
                  <th scope="col" className={head}>
                    Cantrips
                  </th>
                  <th scope="col" className={head}>
                    Spells
                  </th>
                  <th scope="col" className={head}>
                    Spell slots
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.level}
                data-level-row={row.level}
                data-mark={row.mark ?? undefined}
                aria-current={row.mark === "current" ? "true" : undefined}
                className={cn(
                  row.mark === "next" && "bg-amber-500/10",
                  row.mark === "current" && "bg-stone-800/40",
                )}
              >
                <th
                  scope="row"
                  className={cn(
                    cell,
                    "sticky left-0 whitespace-nowrap font-mono text-sm text-amber-100",
                    // Opaque, from the theme's own ramps, so the column reads by day
                    // as well as by night as the rows slide under it.
                    row.mark === "next" ? "bg-amber-950" : row.mark === "current" ? "bg-stone-900" : "bg-stone-950",
                  )}
                >
                  {row.level}
                  {row.mark ? (
                    <span
                      className={cn(
                        "ml-1.5 rounded-full border px-1.5 py-0.5 font-sans text-[0.875rem]",
                        row.mark === "next" ? "border-amber-500/50 text-amber-200" : "border-stone-600 text-stone-300",
                      )}
                    >
                      {row.mark === "next" ? "New" : "Now"}
                    </span>
                  ) : null}
                </th>
                <td className={cn(cell, "font-mono")}>{formatModifier(row.proficiency)}</td>
                <td className={cell}>{row.features.length ? row.features.join(", ") : none}</td>
                {columns.subclass ? (
                  <td className={cell}>{row.subclass ? (row.subclass.pick ?? toChoose) : none}</td>
                ) : null}
                <td className={cell}>
                  {row.improvement
                    ? (row.improvement.pick ?? (row.improvement.takenInPlay ? "Taken in play, already in the scores" : toChoose))
                    : none}
                </td>
                {columns.casting ? (
                  <>
                    <td className={cn(cell, "font-mono")}>{row.cantrips ?? none}</td>
                    <td className={cell}>
                      {row.spells ? (
                        <>
                          {row.spells.count} {row.spells.label}
                          {row.spells.spellbook ? `, ${row.spells.spellbook} in the spellbook` : ""}
                        </>
                      ) : (
                        none
                      )}
                    </td>
                    <td className={cn(cell, "whitespace-nowrap")}>{row.slots.length ? slotWords(row.slots) : none}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StepPanel>
  );
}

// The table as the builder holds the character: its class, subclass and
// level, its improvement cards and its fighting styles.
export function builderProgressionInput(
  state: Pick<BuilderState, "subclass" | "stylePicks">,
  derived: Pick<BuilderDerived, "effectiveLevel" | "asiBaseAbilities" | "asiSlotLevels" | "activeAsiChoices" | "asiTakenInPlay" | "styleSlots">,
  klass: Pick<ClassOption, "id">,
  marks: Pick<ProgressionInput, "current" | "next"> = {},
): ProgressionInput {
  return {
    classId: klass.id,
    subclass: state.subclass,
    level: derived.effectiveLevel,
    baseAbilities: derived.asiBaseAbilities,
    asiSlotLevels: derived.asiSlotLevels,
    asiChoices: derived.activeAsiChoices,
    asiTakenInPlay: derived.asiTakenInPlay,
    styles: state.stylePicks
      .slice(0, derived.styleSlots)
      .map((id) => FIGHTING_STYLES.find((style) => style.id === id)?.name ?? id),
    ...marks,
  };
}

// The summary's table (backlog F3's page): every level up to the build's.
export function BuilderLevelTable({
  state,
  derived,
  klass,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  klass: ClassOption | undefined;
}) {
  // A first-level build is one row, with nothing yet to compare it to.
  if (!klass || derived.effectiveLevel <= 1) {
    return null;
  }
  return (
    <LevelProgressionTable
      rows={levelProgressionRows(builderProgressionInput(state, derived, klass))}
      who={state.name.trim() || "your hero"}
    />
  );
}
