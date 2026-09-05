"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { SRD_SKILLS } from "@/lib/srd";
import { expertiseSlotsFor } from "@/lib/srd/features";
import { FIGHTING_STYLES } from "@/lib/srd/feature-effects";
import type { ClassOption } from "../useBuilderOptions";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { PickPill, StepPanel } from "./shared";

const optionCard = (selected: boolean) =>
  cn(
    "rounded-lg border px-3 py-2 text-left transition-colors duration-150",
    selected
      ? "border-amber-500/60 bg-amber-400/10 text-amber-100"
      : "border-stone-600/60 text-stone-300 hover:border-amber-500/40 hover:bg-stone-900/70",
  );

// The class-specific pick lists that only appear when the class and level
// earn them: expertise, fighting styles, and the option slots (invocations,
// maneuvers, metamagic, pact boons, infusions, runes, disciplines).
export function ClassChoices({
  state,
  derived,
  actions,
  klass,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  actions: BuilderActions;
  klass: ClassOption | undefined;
}) {
  const { effectiveLevel, preview, styleSlots, optionSlots } = derived;
  const expertiseSlots = klass ? expertiseSlotsFor(klass.id, effectiveLevel) : 0;
  return (
    <>
      {klass && expertiseSlots > 0 && preview ? (
        <StepPanel
          title={`Expertise (pick ${expertiseSlots})`}
          help="Doubled proficiency bonus on the chosen skills."
        >
          <div className="flex flex-wrap gap-2">
            {preview.proficiencies.skills.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const selected = state.expertisePicks.includes(skillId);
              return (
                <PickPill
                  key={skillId}
                  selected={selected}
                  onClick={() =>
                    state.setExpertisePicks((current) =>
                      selected
                        ? current.filter((entry) => entry !== skillId)
                        : current.length < expertiseSlots
                          ? [...current, skillId]
                          : current,
                    )
                  }
                >
                  {skill?.name ?? skillId}
                </PickPill>
              );
            })}
          </div>
        </StepPanel>
      ) : null}

      {styleSlots > 0 ? (
        <StepPanel title={`Fighting style (pick ${styleSlots})`}>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {FIGHTING_STYLES.map((style) => {
              const selected = state.stylePicks.includes(style.id);
              return (
                <button
                  key={style.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    state.setStylePicks((current) =>
                      selected
                        ? current.filter((entry) => entry !== style.id)
                        : current.length < styleSlots
                          ? [...current, style.id]
                          : current,
                    )
                  }
                  className={optionCard(selected)}
                >
                  <span className="block text-xs">{style.name}</span>
                  <span className="block text-[11px] text-stone-500">{style.description}</span>
                </button>
              );
            })}
          </div>
        </StepPanel>
      ) : null}

      {optionSlots.map((slot) => (
        <StepPanel
          key={slot.kind}
          title={`${slot.label} (pick ${slot.total})`}
          help={
            <>
              {slot.remaining > 0 ? (
                <span className="text-amber-300">{slot.remaining} still to choose. </span>
              ) : null}
              These are real abilities your character gets. Tap the info button on any one to
              read what it does.
            </>
          }
        >
          <div className="grid gap-1.5 sm:grid-cols-2">
            {slot.options.map((option) => {
              const selected = slot.chosen.some(
                (chosenName) => chosenName.toLowerCase() === option.n.toLowerCase(),
              );
              return (
                <div key={option.n} className={cn(optionCard(selected), "flex items-start gap-1")}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => actions.toggleOption(slot, option.n)}
                    className="grow text-left"
                  >
                    <span className="block text-xs">{option.n}</span>
                    <span className="block text-[11px] text-stone-500">
                      {option.req ? `Requires ${option.req}. ` : ""}
                      {option.d}
                    </span>
                  </button>
                  <InfoButton
                    label={option.n}
                    meta={option.req ? `Requires ${option.req}` : undefined}
                    text={option.d}
                  />
                </div>
              );
            })}
          </div>
        </StepPanel>
      ))}
    </>
  );
}
