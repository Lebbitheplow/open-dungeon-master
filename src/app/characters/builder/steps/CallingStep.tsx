"use client";

import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { describeFeature } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import { displayName } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import type { ArchetypeOption, BackgroundOption, ClassOption } from "../useBuilderOptions";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { ClassChoices } from "./ClassChoices";
import { Field, PickPill, StepPanel, inputClass } from "./shared";

// Step 3: the class, its subclass once the level allows one, what the pair
// grants at this level, and the class skill picks. Expertise, fighting
// styles and option lists (invocations and the like) follow in ClassChoices.
export function CallingStep({
  state,
  derived,
  actions,
  klass,
  background,
  pack,
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
  classGroups: PickerGroup[];
  subclassGroups: PickerGroup[];
  offersSubclass: boolean;
  chosenArchetype: ArchetypeOption | null;
}) {
  const { subclass } = state;
  const { effectiveLevel, grantedFeatures } = derived;
  return (
    <div className="space-y-4">
      <StepPanel title="Choose a class" ornate>
        <Field label="Class">
          <OptionPicker
            value={klass?.id ?? ""}
            groups={classGroups}
            className={inputClass}
            onChange={state.changeClass}
          />
          {klass ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-stone-500">
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
                text={klass.blurb || klass.desc}
                reference={{ kind: "classes", slug: klass.id }}
              />
            </span>
          ) : null}
        </Field>
        {offersSubclass ? (
          <Field label="Subclass" className="mt-3">
            <OptionPicker
              value={subclass}
              groups={subclassGroups}
              placeholder="None yet"
              className={inputClass}
              onChange={state.setSubclass}
            />
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              {subclass ? (
                <>
                  <span className="grow">
                    {chosenArchetype?.desc
                      ? chosenArchetype.desc.split("\n")[0]
                      : "A specialization within your class."}
                  </span>
                  <InfoButton
                    label={subclass}
                    text={chosenArchetype?.desc}
                    reference={
                      chosenArchetype ? { kind: "archetypes", slug: chosenArchetype.id } : undefined
                    }
                  />
                </>
              ) : (
                <span className="grow">
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
        <StepPanel title={`Class skills (pick ${klass.skillChoices.count})`}>
          <div className="flex flex-wrap gap-2">
            {klass.skillChoices.from.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const fromBackground = background?.skills.includes(skillId) ?? false;
              return (
                <PickPill
                  key={skillId}
                  selected={state.chosenSkills.includes(skillId)}
                  disabled={fromBackground}
                  onClick={() => actions.toggleSkill(skillId)}
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
