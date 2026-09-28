"use client";

import type { Ability } from "@/lib/schemas/sheet";
import { hpBonusPerLevel } from "@/lib/srd/race-id";
import AbilityEditor from "../AbilityEditor";
import type { HpExplainerInput } from "../AbilityExplainers";
import AsiFeatEditor from "../AsiFeatEditor";
import type { ClassOption, RaceOption } from "../useBuilderOptions";
import type { BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";

// What the health explainer works from, shared with the Max HP field on the
// last step. Null until the class and all six scores are known. The Max HP
// field is computed by the same hpBreakdown (useBuilderDerived.ts).
export function hpExplainerInput(
  state: BuilderState,
  derived: BuilderDerived,
  race: RaceOption | undefined,
  klass: ClassOption | undefined,
): HpExplainerInput | null {
  if (!klass || !derived.shownAbilities) {
    return null;
  }
  return {
    className: klass.name,
    hitDie: klass.hitDie,
    // The Constitution the sheet will hold, a half-feat's point included.
    con: derived.shownAbilities.con,
    level: derived.effectiveLevel,
    bonusPerLevel: race ? hpBonusPerLevel(race.id) : 0,
    override: state.hpOverride,
  };
}

// Step 4: the six scores by standard array, point buy or 4d6, then one card
// per ability score improvement the level has earned. Hit points are derived
// on the last step (with a Max HP override); the explainer under the summary
// only shows how that number comes about.
export function AbilitiesStep({
  state,
  derived,
  race,
  klass,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
}) {
  const { asiSlotLevels, activeAsiChoices, asiTakenInPlay, baseAbilities, effectiveLevel } = derived;
  const asiToPick = asiTakenInPlay.filter((taken) => !taken).length;
  // The fixed bumps plus the ones the player chose on the ancestry step
  // (half-elf), so "Final" here is the number the sheet will carry.
  const racialBonus: Partial<Record<Ability, number>> = { ...(race?.asi ?? {}) };
  if (race?.asiChoice) {
    for (const ability of state.racialAsi) {
      if (ability) {
        racialBonus[ability] = (racialBonus[ability] ?? 0) + race.asiChoice.amount;
      }
    }
  }
  return (
    <div className="space-y-4">
      <AbilityEditor
        method={state.method}
        onMethodChange={state.setMethod}
        scores={state.scores}
        onScoresChange={state.setScores}
        pool={state.rollPool}
        onPoolChange={state.setRollPool}
        slots={state.rollSlots}
        onSlotsChange={state.setRollSlots}
        racialBonus={racialBonus}
        asiCount={asiToPick}
        who={race && klass ? `${race.name} ${klass.name}`.toLowerCase() : ""}
        hp={hpExplainerInput(state, derived, race, klass)}
      />
      {asiSlotLevels.length ? (
        <AsiFeatEditor
          level={effectiveLevel}
          slotLevels={asiSlotLevels}
          baseScores={baseAbilities}
          choices={activeAsiChoices}
          takenInPlay={asiTakenInPlay}
          onChange={(next) =>
            state.setAsiChoices((current) => {
              const merged = [...current];
              next.forEach((choice, index) => {
                merged[index] = choice;
              });
              return merged;
            })
          }
        />
      ) : null}
    </div>
  );
}
