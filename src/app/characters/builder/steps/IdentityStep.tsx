"use client";

import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import type { WorldPack } from "@/lib/worlds/types";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { backgroundInfoText } from "../usePickerGroups";
import type { BackgroundOption } from "../useBuilderOptions";
import type { BuilderState } from "../useBuilderState";
import { splitToolGrants } from "@/lib/srd/tool-choices";
import { Field, StepPanel, inputClass } from "./shared";
import { GENDERS, type Gender } from "@/lib/gender";

// How many tools a background's open grant leaves to the player, in words.
const COUNT_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three" };

export type BuilderRole = "pc" | "companion";

// Step 1: the name, who plays them, level, background and alignment. The
// setting notices live here too, so the first thing a player sees under a
// world pack is whose names they are about to choose from.
export function IdentityStep({
  state,
  pack,
  packInstalled,
  fixedLevel,
  role,
  alignmentGroups,
  alignmentInfo,
  backgroundGroups,
  background,
}: {
  state: BuilderState;
  pack: WorldPack | null;
  packInstalled: boolean;
  fixedLevel?: number;
  // Offered by the library page only: a campaign already knows which door
  // the character comes through.
  role?: { value: BuilderRole; onChange: (role: BuilderRole) => void };
  alignmentGroups: PickerGroup[];
  alignmentInfo: string;
  backgroundGroups: PickerGroup[];
  background: BackgroundOption | undefined;
}) {
  return (
    <div className="space-y-4">
      {!packInstalled ? (
        <p className="rounded-lg border border-stone-700/60 bg-stone-900/60 p-3 text-xs text-stone-400">
          Content pack not installed; showing SRD 5.1 basics only. Run
          <span className="font-mono"> node scripts/import-open5e.mjs</span> on the server
          for the full Open5e catalog.
        </p>
      ) : null}
      {pack ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-xs text-amber-100">
            <span className="font-medium">{pack.name}</span> · {pack.blurb}
          </p>
          <p className="mt-1 text-[11px] text-stone-400">
            Names only. Every race, class, spell and item below plays by the same 5e rules.
          </p>
          <UnofficialPackNotice
            rightsHolder={pack.rightsHolder}
            inspiredBy={pack.inspiredBy}
            variant="inline"
            className="mt-1"
          />
        </div>
      ) : null}

      <StepPanel title="Name your hero" ornate anchor="name">
        <input
          value={state.name}
          onChange={(event) => state.setName(event.target.value)}
          required
          maxLength={60}
          placeholder={pack?.nameHints || "Thornwick Ashvale"}
          className={inputClass}
          aria-label="Name"
        />
        {pack?.nameSeeds.people.length ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {pack.nameSeeds.people.slice(0, 8).map((seed) => (
              <button
                key={seed}
                type="button"
                onClick={() => state.setName(seed)}
                className="rounded-md border border-stone-700/70 px-1.5 py-0.5 text-[11px] text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-100"
              >
                {seed}
              </button>
            ))}
          </span>
        ) : null}
        {role ? (
          <div className="mt-4">
            <span className="mb-1.5 block text-xs text-stone-400">Their place at the table</span>
            <SegmentedControl
              label="Role"
              value={role.value}
              onChange={role.onChange}
              options={[
                { value: "pc", label: "A character I play" },
                { value: "companion", label: "An ally the DM plays" },
              ]}
              className="w-full"
            />
            <p className="mt-1.5 text-xs text-stone-500">
              {role.value === "companion"
                ? "Companions are offered when a party adds one, at whatever level that table plays at. Nobody has to roll them up again."
                : "Joins a campaign as yours to control."}
            </p>
          </div>
        ) : null}
      </StepPanel>

      <StepPanel title="Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Gender">
            <Select<Gender>
              value={state.gender}
              onChange={state.setGender}
              label="Gender"
              className="w-full"
              options={[{ value: "", label: "Unspecified" }, ...GENDERS.map((value) => ({ value, label: value }))]}
            />
          </Field>
          <Field label="Level">
            {fixedLevel ? (
              <span className="block rounded-lg border border-stone-700/70 bg-stone-950/60 px-3 py-2 text-sm text-stone-400">
                {fixedLevel} (campaign)
              </span>
            ) : (
              <Select<string>
                value={String(state.level)}
                onChange={(next) => state.changeLevel(Number(next))}
                label="Level"
                className="w-full"
                options={Array.from({ length: 20 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
              />
            )}
          </Field>
          <Field label="Background">
            <OptionPicker
              value={background?.id ?? ""}
              groups={backgroundGroups}
              className={inputClass}
              onChange={state.changeBackground}
            />
            {background ? (
              <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
                <span className="grow">
                  {background.skills.length ? "Grants " : null}
                  {background.skills.length
                    ? background.skills.map((skillId, index) => {
                        const name =
                          SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId;
                        return (
                          <span key={skillId} className="whitespace-nowrap">
                            {index ? ", " : null}
                            {name}
                            {/* Each granted skill says what it is, so
                                "Grants Deception, Sleight of Hand" is a
                                sentence a new player can read. */}
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
                        reference={
                          background.featureDesc ? undefined : { kind: "backgrounds", slug: background.id }
                        }
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
              // What the background asks for on a later step, said here so
              // the hold on step 2 is no surprise (issue #117).
              <span className="mt-1 block text-xs text-stone-500">
                On the Ancestry step you will pick {background.languages === 1 ? "one more language" : `${background.languages} more languages`} for this background.
              </span>
            ) : null}
            {background?.tools?.length && splitToolGrants(background.tools).choices.length ? (
              // A background's open tool grant ("one type of artisan's
              // tools") is picked on the class step, under the class's own;
              // said here like the languages (issue #117 follow-up).
              <span className="mt-1 block text-xs text-stone-500">
                On the Calling step you will pick{" "}
                {splitToolGrants(background.tools)
                  .choices.map((choice) => `${COUNT_WORDS[choice.count] ?? choice.count} ${choice.label}${choice.count === 1 || choice.label.endsWith("s") ? "" : "s"}`)
                  .join(" and ")}{" "}
                for this background.
              </span>
            ) : null}
            {background?.skillChoice ? (
              <BackgroundSkillChoice state={state} background={background} choice={background.skillChoice} />
            ) : null}
          </Field>
          <Field
            label={
              <span className="flex items-center gap-1">
                Alignment
                <InfoButton label="Alignment" text={alignmentInfo} />
              </span>
            }
          >
            <OptionPicker
              value={state.alignment}
              groups={alignmentGroups}
              className={inputClass}
              onChange={state.setAlignment}
            />
          </Field>
        </div>
      </StepPanel>
    </div>
  );
}

function skillName(skillId: string) {
  return SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId;
}

// The skills a content-pack background leaves to the player ("Persuasion,
// and either Insight or History"), one select per pick, the way the race's
// skill choices are asked on the ancestry step.
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
            {picks[index] ? (
              <InfoButton label={skillName(picks[index])} text={describeSkill(picks[index])} />
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
