"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Ability } from "@/lib/schemas/sheet";
import { useLowEffects } from "@/lib/effects-mode";
import { InfoBody } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { classRoles } from "@/lib/srd/class-roles";
import { buildMathSections, createChangeAnnouncer, knownSoFarRows, type BuildMathRow } from "./buildMath";
import { LineageDetails } from "./LineageCarousel";
import type { PickerGroup } from "./OptionPicker";
import { lineageSlidesFor } from "./steps/AncestryStep";
import { classDetailsMeta } from "./steps/CallingStep";
import { classInfoText } from "./usePickerGroups";
import type { ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderDerived } from "./useBuilderDerived";
import type { BuilderState } from "./useBuilderState";

// Character details, the build math table (backlog F10): every number the
// sheet will carry, with the parts each is made of, beside the picks on
// every step. Where the
// builder is wide (a 56rem container, which creator.css gives the page on a
// desktop) it is a column of its own, always open; where it is narrow, a
// phone or the companion dialog, it sits under the steps, folded until
// opened. The rows are buildMath.ts's, read
// from the calculations the save uses.
//
// Until there are a class, an ancestry, a background and six scores the
// table cannot be worked out, so the panel shows the picks so far instead:
// what is already settled, and the chosen class's and ancestry's write-ups,
// the same ones their cards' "?" opens.
export function BuildMathPanel({
  derived,
  scores,
  klass,
  atTable,
  race,
  races,
  raceGroups,
  gender,
}: {
  derived: BuilderDerived;
  scores: Record<Ability, number | null>;
  klass: ClassOption | undefined;
  atTable: boolean;
  race: RaceOption | undefined;
  races: RaceOption[];
  raceGroups: PickerGroup[];
  gender: BuilderState["gender"];
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
          Character details
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          // The heading beside it says what; the word on its face fits a
          // phone's row, and the name read aloud starts with that word.
          aria-label={open ? "Hide character details" : "Show character details"}
          onClick={() => setOpen((was) => !was)}
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-base text-sky-300 transition-colors hover:bg-stone-800 @4xl:hidden"
        >
          {open ? "Hide" : "Show"}
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
          <PicksSoFar
            known={knownSoFarRows({
              level: derived.effectiveLevel,
              klass,
              race,
              racialBonus: derived.racialBonus,
              proficientSkills: derived.proficientSkills,
            })}
            klass={klass}
            race={race}
            races={races}
            raceGroups={raceGroups}
            gender={gender}
          />
        )}
      </div>
    </aside>
  );
}

function rowKey(row: { id: string; value: string }) {
  return `${row.id}:${row.value}`;
}

// The panel before the table: what is settled, then the chosen class and
// ancestry read as their cards' details read them.
function PicksSoFar({
  known,
  klass,
  race,
  races,
  raceGroups,
  gender,
}: {
  known: BuildMathRow[];
  klass: ClassOption | undefined;
  race: RaceOption | undefined;
  races: RaceOption[];
  raceGroups: PickerGroup[];
  gender: BuilderState["gender"];
}) {
  const headingId = useId();
  const slide = useMemo(
    () => (race ? lineageSlidesFor(raceGroups, races, gender).find((entry) => entry.id === race.id) : undefined),
    [race, races, raceGroups, gender],
  );
  const cell = "border-t border-stone-800 px-2 py-1.5 align-top text-base";
  const title = "mt-4 mb-2 font-display text-base font-semibold text-amber-200/90";
  return (
    <section aria-labelledby={headingId} data-picks-so-far="">
      <h3 id={headingId} className="mb-1 font-display text-base font-semibold text-amber-200/90">
        Your picks so far
      </h3>
      <p className="mb-2 text-base text-stone-400">
        Every number and how it is made appears here once your hero has a class, an ancestry, a background and six
        scores.
      </p>
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">What is already settled</caption>
        <colgroup>
          <col className="w-[38%]" />
          <col className="w-[34%]" />
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
              From
            </th>
          </tr>
        </thead>
        <tbody>
          {known.map((row) => (
            <tr key={row.id} data-row={row.id}>
              <th scope="row" className={cn(cell, "font-normal text-stone-200")}>
                {row.label}
              </th>
              <td className={cn(cell, "break-words text-amber-100")}>{row.value}</td>
              <td className={cn(cell, "break-words text-stone-400")}>{row.working}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {klass ? (
        <div data-picked="class">
          <h3 className={title}>{klass.name}</h3>
          <InfoBody
            large
            meta={classDetailsMeta({ id: klass.id, saves: klass.saves, reading: classRoles(klass) }).join(" · ")}
            text={classInfoText(klass)}
            reference={{ kind: "classes", slug: klass.id, name: klass.name }}
          />
        </div>
      ) : null}
      {slide ? (
        <div data-picked="ancestry">
          <h3 className={title}>{slide.name}</h3>
          <div className="flex flex-wrap items-start gap-3.5">
            <LineageDetails slide={slide} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
