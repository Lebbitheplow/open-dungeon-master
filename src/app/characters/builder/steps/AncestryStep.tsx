"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { describeRace } from "@/lib/help";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { RacialChoicesSection } from "../RacialChoicesSection";
import type { BackgroundOption, RaceOption } from "../useBuilderOptions";
import type { BuilderState } from "../useBuilderState";
import { Field, StepPanel, inputClass } from "./shared";

// Step 2: where they are from. The race picker, then every choice the race
// leaves to the player: bonus languages, ability bumps, skills, tool, cantrip.
export function AncestryStep({
  state,
  race,
  background,
  raceGroups,
}: {
  state: BuilderState;
  race: RaceOption | undefined;
  background: BackgroundOption | undefined;
  raceGroups: PickerGroup[];
}) {
  return (
    <div className="space-y-4">
      <StepPanel title="Where are they from?" ornate>
        <Field label="Race">
          <OptionPicker
            value={race?.id ?? ""}
            groups={raceGroups}
            className={inputClass}
            onChange={state.changeRace}
          />
          {race?.note ? (
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              <span className="line-clamp-2 grow">{race.note}</span>
              <InfoButton
                label={race.name}
                text={describeRace(race.id) ?? race.note}
                reference={{ kind: "races", slug: race.id }}
              />
            </span>
          ) : null}
        </Field>
      </StepPanel>

      {race && race.bonusLanguages > 0 ? (
        <StepPanel
          title={`Bonus ${race.bonusLanguages === 1 ? "language" : "languages"}`}
          help={`${race.name} speaks ${race.languages.join(" and ")} plus ${race.bonusLanguages} of your choice.`}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: race.bonusLanguages }, (_, index) => (
              <select
                key={index}
                value={state.bonusLanguages[index] ?? ""}
                onChange={(event) =>
                  state.setBonusLanguages((current) => {
                    const next = [...current];
                    next[index] = event.target.value;
                    return next;
                  })
                }
                className={inputClass}
                aria-label={`Bonus language ${index + 1}`}
              >
                <option value="">Choose a language...</option>
                {STANDARD_LANGUAGES.filter(
                  (language) =>
                    !race.languages.includes(language) &&
                    (state.bonusLanguages[index] === language ||
                      !state.bonusLanguages.includes(language)),
                ).map((language) => (
                  <option key={language} value={language}>{language}</option>
                ))}
              </select>
            ))}
          </div>
        </StepPanel>
      ) : null}

      {race ? (
        <RacialChoicesSection
          race={race}
          grantedSkills={[
            ...state.chosenSkills,
            ...(background?.skills ?? []),
            ...(race.skills ?? []),
          ]}
          asi={state.racialAsi}
          onAsiChange={(index, ability) =>
            state.setRacialAsi((current) => {
              const next = [...current];
              next[index] = ability;
              return next;
            })
          }
          skills={state.racialSkills}
          onSkillsChange={(index, skill) =>
            state.setRacialSkills((current) => {
              const next = [...current];
              next[index] = skill;
              return next;
            })
          }
          cantrip={state.racialCantrip}
          onCantripChange={state.setRacialCantrip}
          tool={state.racialTool}
          onToolChange={state.setRacialTool}
          inputClass={inputClass}
        />
      ) : null}
    </div>
  );
}
