"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { cn } from "@/lib/cn";
import type { Genre } from "@/lib/schemas/game-settings";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { applyClassReskins, applyIdReskins } from "@/lib/worlds/reskin-logic";
import { AbilitiesStep } from "./steps/AbilitiesStep";
import { AncestryStep } from "./steps/AncestryStep";
import { CallingStep } from "./steps/CallingStep";
import { FinishStep } from "./steps/FinishStep";
import { IdentityStep, type BuilderRole } from "./steps/IdentityStep";
import { StepBlocker } from "./steps/shared";
import { SpellsGearStep } from "./steps/SpellsGearStep";
import {
  abilitiesBlocker,
  ancestryBlocker,
  buildBuilderResult,
  callingBlocker,
  identityBlocker,
  validateBuilder,
  type BuilderResult,
} from "./submit";
import { builderActions, useBuilderDerived } from "./useBuilderDerived";
import { useArchetypes, useBuilderOptions, useWorldPack } from "./useBuilderOptions";
import { useBuilderState } from "./useBuilderState";
import { usePickerGroups } from "./usePickerGroups";

export type { BuilderResult } from "./submit";

// Full character creation flow as a six-step wizard: identity, ancestry,
// calling, abilities, spells and gear, finishing touches. Open5e
// races/classes/subclasses/backgrounds (SRD fallback), three ability-score
// methods, spell/equipment/feat pickers, live derived stats. Used by
// /characters/new, the campaign join/edit/replace page and the companion
// dialog. The fields, validation and submitted sheet are unchanged from the
// single-page form this replaced; only the pacing is new.
export default function CharacterBuilder({
  fixedLevel,
  genre,
  worldPackId,
  initial,
  submitLabel,
  onSubmit,
  busy,
  error,
  role,
  className,
}: {
  fixedLevel?: number;
  // Campaign genre: floats setting-appropriate classes to the top of the
  // class picker. Absent in the library builder (default ordering).
  genre?: Genre;
  // Campaign world pack: renames races, classes and backgrounds to the
  // world's own words and floats the ones that belong in it. Display only,
  // so every id submitted on the sheet stays canonical.
  worldPackId?: string;
  // Edit mode: prefill every field from an existing stored sheet (the
  // library copy, which owns builder-only fields like ASI picks).
  initial?: CreateSheetInput;
  submitLabel: string;
  onSubmit: (result: BuilderResult) => void;
  busy: boolean;
  error: string;
  // Player character or DM-played ally; only the library page asks, since a
  // campaign already knows which door the character comes through.
  role?: { value: BuilderRole; onChange: (role: BuilderRole) => void };
  className?: string;
}) {
  const {
    races: rawRaces,
    classes: rawClasses,
    backgrounds: rawBackgrounds,
    packInstalled,
  } = useBuilderOptions();
  const pack = useWorldPack(worldPackId);
  // Display overlay only. applyIdReskins rewrites `name`, never `id`, so
  // race.asi, classFeaturesFor(klass.id), spellClassFor(klass.id) and the
  // submitted sheet all keep seeing canonical values.
  const races = useMemo(() => applyIdReskins(rawRaces, pack?.races ?? []), [rawRaces, pack]);
  const classes = useMemo(() => applyClassReskins(rawClasses, pack), [rawClasses, pack]);
  const backgrounds = useMemo(
    () => applyIdReskins(rawBackgrounds, pack?.backgrounds ?? []),
    [rawBackgrounds, pack],
  );

  const state = useBuilderState({ initial, fixedLevel, races, backgrounds });
  const race = races.find((entry) => entry.id === state.raceId) ?? races[0];
  const klass = classes.find((entry) => entry.id === state.classId) ?? classes[0];
  const background =
    backgrounds.find((entry) => entry.id === state.backgroundId) ?? backgrounds[0];
  const archetypes = useArchetypes(klass?.id ?? "");

  const derived = useBuilderDerived({ state, race, klass, background, fixedLevel });
  const actions = builderActions(state, klass);
  const pickers = usePickerGroups({
    races,
    rawRaces,
    classes,
    rawClasses,
    backgrounds,
    pack,
    genre,
    klass,
    subclass: state.subclass,
    effectiveLevel: derived.effectiveLevel,
    archetypes,
  });

  const paintsPortraits = offersImages(useCapabilities());
  const [cropping, setCropping] = useState(false);

  function submit() {
    const input = { state, derived, race, klass, background };
    const problem = validateBuilder(input);
    if (problem) {
      if (problem.kind === "spellWarning") {
        state.setSpellWarningAck(true);
      }
      state.setLocalError(problem.message);
      return;
    }
    state.setLocalError("");
    onSubmit(buildBuilderResult(input));
  }

  if (!races.length || !classes.length || !backgrounds.length) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  // Each gate mirrors a rule the final check enforces, so a player learns
  // about a missing pick on the step where they can fix it.
  const blockers = {
    identity: identityBlocker(state),
    ancestry: ancestryBlocker(state, race),
    calling: callingBlocker(klass),
    abilities: abilitiesBlocker(derived),
  };
  const casts = Boolean(klass?.spellAbility);

  const steps: WizardStep[] = [
    {
      key: "identity",
      title: "Who is this?",
      canContinue: !blockers.identity,
      content: (
        <>
          <IdentityStep
            state={state}
            pack={pack}
            packInstalled={packInstalled}
            fixedLevel={fixedLevel}
            role={role}
            alignmentOrder={pickers.alignmentOrder}
            backgroundGroups={pickers.backgroundGroups}
            background={background}
          />
          <StepBlocker message={blockers.identity} />
        </>
      ),
    },
    {
      key: "ancestry",
      title: "Ancestry",
      blurb: "Where are they from, and what does that grant?",
      canContinue: !blockers.ancestry,
      content: (
        <>
          <AncestryStep
            state={state}
            race={race}
            background={background}
            raceGroups={pickers.raceGroups}
          />
          <StepBlocker message={blockers.ancestry} />
        </>
      ),
    },
    {
      key: "calling",
      title: "Calling",
      blurb: "The class decides how this character plays.",
      canContinue: !blockers.calling,
      content: (
        <>
          <CallingStep
            state={state}
            derived={derived}
            actions={actions}
            klass={klass}
            background={background}
            pack={pack}
            classGroups={pickers.classGroups}
            subclassGroups={pickers.subclassGroups}
            offersSubclass={pickers.offersSubclass}
            chosenArchetype={pickers.chosenArchetype}
          />
          <StepBlocker message={blockers.calling} />
        </>
      ),
    },
    {
      key: "abilities",
      title: "Ability scores",
      blurb: "How do you roll?",
      canContinue: !blockers.abilities,
      content: (
        <>
          <AbilitiesStep state={state} derived={derived} race={race} />
          <StepBlocker message={blockers.abilities} />
        </>
      ),
    },
    {
      key: "spells-gear",
      title: casts ? "Spells and gear" : "Gear",
      blurb: casts ? "Arm your hero, then pick what they can cast." : "Arm your hero.",
      content: (
        <SpellsGearStep state={state} derived={derived} actions={actions} klass={klass} pack={pack} />
      ),
    },
    {
      key: "finish",
      title: "Finishing touches",
      blurb: "Who have you made?",
      canContinue: !busy,
      content: (
        <FinishStep
          state={state}
          derived={derived}
          race={race}
          initial={initial}
          paintsPortraits={paintsPortraits}
          onUploadPortrait={() => setCropping(true)}
          error={state.localError || error}
        />
      ),
    },
  ];

  return (
    // A bounded height so each step scrolls on its own and the Continue
    // button stays put; the fallback keeps a usable pane on a short phone.
    <div className={cn("flex h-[max(30rem,calc(100dvh-14rem))] flex-col text-sm", className)}>
      <Wizard
        title={state.name.trim() || "New character"}
        steps={steps}
        onDone={submit}
        doneLabel={
          busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {submitLabel}
            </>
          ) : (
            submitLabel
          )
        }
      />
      {cropping ? (
        <AvatarCropDialog
          title={`Portrait for ${state.name.trim() || "your character"}`}
          onUploaded={(image) => {
            setCropping(false);
            state.setPortrait({ id: image.id, name: image.name, type: image.type, url: image.url });
          }}
          onClose={() => setCropping(false)}
        />
      ) : null}
    </div>
  );
}
