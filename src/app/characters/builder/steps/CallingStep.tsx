"use client";

import { useMemo, useState } from "react";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton, InfoDialog } from "@/components/ui/InfoDialog";
import { describeFeature, describeSkill } from "@/lib/help";
import { firstSentence } from "@/lib/help/rules-text";
import { subclassBlurb } from "@/lib/srd/features";
import { SRD_SKILLS } from "@/lib/srd";
import { displayName, type Reskinned } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import { classArt } from "../lineage";
import { OptionCardGrid, type OptionCardGroup } from "../OptionCardGrid";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { classInfoText } from "../usePickerGroups";
import type { ArchetypeOption, BackgroundOption, ClassOption } from "../useBuilderOptions";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { ClassChoices } from "./ClassChoices";
import { Field, PickPill, StepPanel, inputClass } from "./shared";

// Step 3: the class (painted cards in the picker's groups and order, the
// setting's callings first and badged, each with its emblem and a ? that
// opens its write-up), its subclass once the level allows one, what the pair
// grants at this level, and the class skill picks. Expertise, fighting
// styles and option lists (invocations and the like) follow in ClassChoices.
export function CallingStep({
  state,
  derived,
  actions,
  klass,
  background,
  pack,
  classes,
  classGroups,
  subclassGroups,
  offersSubclass,
  chosenArchetype,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  actions: BuilderActions;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  pack: WorldPack | null;
  classes: Array<Reskinned<ClassOption>>;
  classGroups: PickerGroup[];
  subclassGroups: PickerGroup[];
  offersSubclass: boolean;
  chosenArchetype: ArchetypeOption | null;
}) {
  const { subclass } = state;
  const { effectiveLevel, grantedFeatures } = derived;
  const { gender } = state;
  const [detailsFor, setDetailsFor] = useState<string | null>(null);

  const cardGroups = useMemo<OptionCardGroup[]>(
    () =>
      classGroups.map((group) => ({
        label: group.label,
        recommended: group.recommended,
        options: group.options.map((option) => {
          const entry = classes.find((candidate) => candidate.id === option.id);
          // Under a reskin the canonical class name leads the tagline, the
          // same fact the dropdown kept in its meta column.
          const canonical = entry?.packName ? option.meta?.split(" · ")[1] : undefined;
          return {
            id: option.id,
            name: option.name,
            meta: canonical,
            art: classArt(option.id, gender),
            tagline: [canonical, entry ? `Saves ${entry.saves.map((save) => save.toUpperCase()).join(" ")}` : ""]
              .filter(Boolean)
              .join(" · "),
            chips: entry
              ? [`d${entry.hitDie}`, ...(entry.spellAbility ? [`${entry.spellAbility.toUpperCase()} caster`] : [])]
              : [],
            icon: { kind: "family" as const, key: `class-${option.id}` },
          };
        }),
      })),
    [classGroups, classes, gender],
  );
  const details = detailsFor
    ? classGroups.flatMap((group) => group.options).find((option) => option.id === detailsFor)
    : undefined;

  return (
    <div className="space-y-4">
      <StepPanel title="Choose a class" ornate>
        <Field label="Class">
          {klass ? (
            <span className="mb-3 flex flex-wrap items-center gap-x-1 text-xs text-stone-500">
              <span className="text-amber-200">{klass.name}:</span>{" "}
              <GameTerm id="hit_dice">d{klass.hitDie} hit die</GameTerm> ·{" "}
              <GameTerm id="saving_throw">saves</GameTerm>{" "}
              {klass.saves.map((save) => save.toUpperCase()).join(", ")}
              {klass.spellAbility ? (
                <>
                  {" · "}
                  <GameTerm id={klass.spellAbility}>{klass.spellAbility.toUpperCase()}</GameTerm>{" "}
                  caster
                  {klass.castingLabel ? ` (spells flavored as ${klass.castingLabel})` : ""}
                </>
              ) : null}
              <InfoButton
                label={klass.name}
                text={classInfoText(klass)}
                reference={{ kind: "classes", slug: klass.id }}
              />
            </span>
          ) : null}
          <OptionCardGrid
            groups={cardGroups}
            value={klass?.id ?? ""}
            onChoose={state.changeClass}
            onDetails={setDetailsFor}
            noun="class"
            compact
          />
          {/* The same write-up the dropdown's info button opened: the pack's
              blurb, the catalog blurb or the content pack's entry. */}
          <InfoDialog
            open={Boolean(details)}
            onOpenChange={(open) => (open ? undefined : setDetailsFor(null))}
            title={details?.name ?? ""}
            meta={details?.meta}
            text={details?.infoText}
            reference={details?.reference}
          />
        </Field>
        {offersSubclass ? (
          <Field label="Subclass" className="mt-3">
            <OptionPicker
              value={subclass}
              groups={subclassGroups}
              placeholder="None yet"
              className={inputClass}
              onChange={state.changeSubclass}
            />
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              {subclass ? (
                <>
                  <span className="grow">
                    {firstSentence(chosenArchetype?.desc || subclassBlurb(klass?.id ?? "", subclass)) ??
                      "A specialization within your class."}
                  </span>
                  <InfoButton
                    label={subclass}
                    text={chosenArchetype?.desc || subclassBlurb(klass?.id ?? "", subclass) || undefined}
                    reference={
                      chosenArchetype ? { kind: "archetypes", slug: chosenArchetype.id } : undefined
                    }
                  />
                </>
              ) : (
                <span className="grow">
                  <span className="text-amber-300">Still to choose. </span>
                  Your <GameTerm id="subclass">subclass</GameTerm> is the biggest choice about how
                  this character plays. Tap the info icon next to any option to read what it does
                  before choosing.
                </span>
              )}
            </span>
          </Field>
        ) : null}
      </StepPanel>

      {grantedFeatures.length ? (
        <StepPanel
          title={`What you gain at level ${effectiveLevel}`}
          help="Tap any name to read what it does. Racial traits and background perks are added on top when the character is saved."
        >
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {grantedFeatures.map((feature) => (
              <span
                key={`${feature.name}-${feature.level ?? 0}`}
                className="flex items-center gap-1 text-xs text-stone-300"
              >
                {displayName(pack, "features", feature.name)}
                <InfoButton
                  label={feature.name}
                  meta={feature.level ? `Level ${feature.level}` : undefined}
                  text={klass ? describeFeature(klass.id, subclass, feature.name) : null}
                />
              </span>
            ))}
          </div>
        </StepPanel>
      ) : null}

      {klass ? (
        <StepPanel
          title={`Class skills (pick ${klass.skillChoices.count})`}
          help={
            <>
              {klass.skillChoices.count - state.chosenSkills.length > 0 ? (
                <span className="text-amber-300">
                  {klass.skillChoices.count - state.chosenSkills.length} still to choose.{" "}
                </span>
              ) : null}
              A <GameTerm id="skill">skill</GameTerm> you are proficient in adds your{" "}
              <GameTerm id="proficiency_bonus">proficiency bonus</GameTerm> to rolls that use
              it. Tap any ⓘ to see which ability a skill leans on.
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            {klass.skillChoices.from.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const fromBackground = background?.skills.includes(skillId) ?? false;
              return (
                <PickPill
                  key={skillId}
                  label={skill?.name ?? skillId}
                  selected={state.chosenSkills.includes(skillId)}
                  disabled={fromBackground}
                  onClick={() => actions.toggleSkill(skillId)}
                  info={{ text: describeSkill(skillId) }}
                >
                  {skill?.name ?? skillId}
                  {fromBackground ? " (background)" : ""}
                </PickPill>
              );
            })}
          </div>
        </StepPanel>
      ) : null}

      <ClassChoices state={state} derived={derived} actions={actions} klass={klass} />
    </div>
  );
}
