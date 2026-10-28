"use client";

import type { ReactNode } from "react";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { Select } from "@/components/ui/Select";
import { describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { backgroundInfoText } from "../usePickerGroups";
import type { BackgroundOption } from "../useBuilderOptions";
import type { BuilderState } from "../useBuilderState";
import { Field, StepPanel, inputClass } from "./shared";

// The background, asked beside the ancestry (backlog F4): where the hero
// comes from and what they did before adventuring are one step's question.
// Its picks follow it: the skills a content pack's background leaves open
// here, its languages in the ancestry's language list, its open tool grants
// in the tool panels after it.
export function BackgroundPanel({
  state,
  background,
  backgroundGroups,
  raceChosen,
  suggested = [],
  suggestedKey,
  note = null,
}: {
  state: BuilderState;
  background: BackgroundOption | undefined;
  backgroundGroups: PickerGroup[];
  // Whether the step's lineage is picked yet: the language list waits for it.
  raceChosen: boolean;
  // The offered backgrounds that suit the job picked on the first step
  // (playstyleBackgrounds), one tap each.
  suggested?: Array<{ id: string; name: string }>;
  suggestedKey?: string;
  // Why the list may be short (TableScopeNote).
  note?: ReactNode;
}) {
  return (
    <StepPanel title="What did they do before adventuring?" help="Their background: the skills and kit their past gave them.">
      <Field label="Background" anchor="background">
        <OptionPicker
          value={background?.id ?? ""}
          groups={backgroundGroups}
          className={inputClass}
          onChange={state.changeBackground}
        />
        {note}
        {suggested.length ? (
          // The playstyle's backgrounds, one tap each; the list above keeps
          // every other.
          <span key={suggestedKey} className="reveal mt-1.5 flex flex-wrap items-center gap-1 text-xs text-stone-500" data-background-hints>
            Suits that job:
            {suggested.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => state.changeBackground(entry.id)}
                aria-pressed={background?.id === entry.id}
                className="rounded-md border border-stone-700/70 px-1.5 py-0.5 text-sm text-stone-300 transition-colors hover:border-amber-500/40 hover:text-amber-100 aria-pressed:border-amber-400/60 aria-pressed:text-amber-100"
              >
                {entry.name}
              </button>
            ))}
          </span>
        ) : null}
        {background ? (
          <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
            <span className="grow">
              {background.skills.length ? "Grants " : null}
              {background.skills.length
                ? background.skills.map((skillId, index) => {
                    const name = SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId;
                    return (
                      <span key={skillId} className="whitespace-nowrap">
                        {index ? ", " : null}
                        {name}
                        {/* Each granted skill says what it is, so "Grants
                            Deception, Sleight of Hand" is a sentence a new
                            player can read. */}
                        <InfoButton label={name} text={describeSkill(skillId)} />
                      </span>
                    );
                  })
                : "What your character did before adventuring."}
              {background.feature ? (
                <span className="whitespace-nowrap">
                  {background.skills.length ? " · " : " "}
                  Feature: {background.feature}
                  <InfoButton
                    label={background.feature}
                    text={background.featureDesc || undefined}
                    reference={background.featureDesc ? undefined : { kind: "backgrounds", slug: background.id }}
                  />
                </span>
              ) : null}
            </span>
            <InfoButton
              label={background.name}
              text={backgroundInfoText(background)}
              reference={{ kind: "backgrounds", slug: background.id }}
            />
          </span>
        ) : null}
        {background?.languages ? (
          // What the background adds to the language list on this same
          // step, said here so the extra slots are no surprise (issue #117).
          <span className="mt-1 block text-xs text-stone-500">
            This background adds {background.languages === 1 ? "one more language" : `${background.languages} more languages`} to
            your bonus languages, picked below{raceChosen ? "" : " once a lineage is chosen"}.
          </span>
        ) : null}
        {background?.skillChoice ? (
          <BackgroundSkillChoice state={state} background={background} choice={background.skillChoice} />
        ) : null}
      </Field>
    </StepPanel>
  );
}

function skillName(skillId: string) {
  return SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId;
}

// The skills a content-pack background leaves to the player ("Persuasion,
// and either Insight or History"), one select per pick, the way the race's
// skill choices are asked.
function BackgroundSkillChoice({
  state,
  background,
  choice,
}: {
  state: BuilderState;
  background: BackgroundOption;
  choice: NonNullable<BackgroundOption["skillChoice"]>;
}) {
  const picks = state.backgroundSkills;
  const taken = new Set([...background.skills, ...state.chosenSkills, ...state.racialSkills]);
  return (
    <div className="mt-2" data-builder-target="backgroundSkills">
      <span className="mb-1 flex flex-wrap items-center gap-1 text-xs text-stone-400">
        <GameTerm id="skill">Skill</GameTerm> {choice.count === 1 ? "proficiency" : "proficiencies"} (
        {choice.count} of your choice)
      </span>
      <div className="grid grid-cols-1 gap-2">
        {Array.from({ length: choice.count }, (_, index) => (
          <span key={index} className="flex items-center gap-1">
            <Select<string>
              value={picks[index] ?? ""}
              onChange={(next) =>
                state.setBackgroundSkills((current) => {
                  const updated = [...current];
                  updated[index] = next;
                  return updated;
                })
              }
              className="min-w-0 grow"
              label={`Background skill ${index + 1}`}
              placeholder="Choose a skill..."
              options={[
                { value: "", label: "Choose a skill..." },
                ...choice.from
                  .filter((skill) => picks[index] === skill || (!picks.includes(skill) && !taken.has(skill)))
                  .map((skill) => ({ value: skill, label: skillName(skill) })),
              ]}
            />
            {picks[index] ? <InfoButton label={skillName(picks[index])} text={describeSkill(picks[index])} /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
