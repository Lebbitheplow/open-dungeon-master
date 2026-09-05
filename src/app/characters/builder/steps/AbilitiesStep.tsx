"use client";

import AbilityEditor from "../AbilityEditor";
import AsiFeatEditor from "../AsiFeatEditor";
import type { RaceOption } from "../useBuilderOptions";
import type { BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";

// Step 4: the six scores by standard array, point buy or 4d6, then one card
// per ability score improvement the level has earned. Hit points are derived
// on the last step (with a Max HP override), so nothing about them lives here.
export function AbilitiesStep({
  state,
  derived,
  race,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
}) {
  const { asiSlotLevels, activeAsiChoices, baseAbilities, effectiveLevel } = derived;
  return (
    <div className="space-y-4">
      <AbilityEditor
        method={state.method}
        onMethodChange={state.setMethod}
        scores={state.scores}
        onScoresChange={state.setScores}
        racialBonus={race?.asi ?? {}}
        asiCount={asiSlotLevels.length}
      />
      {asiSlotLevels.length ? (
        <AsiFeatEditor
          level={effectiveLevel}
          slotLevels={asiSlotLevels}
          baseScores={baseAbilities}
          choices={activeAsiChoices}
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
