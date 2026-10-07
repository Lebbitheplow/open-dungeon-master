"use client";

import { Loader2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
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
import { SpellsGearStep } from "./steps/SpellsGearStep";
import {
  abilitiesBlocker,
  ancestryBlocker,
  buildBuilderResult,
  callingBlocker,
  gearBlocker,
  identityBlocker,
  spellsBlocker,
  validateBuilder,
  type BlockerTarget,
  type BuilderResult,
  type StepBlock,
} from "./submit";
import { builderActions, useBuilderDerived } from "./useBuilderDerived";
import { useArchetypes, useBuilderOptions, useWorldPack } from "./useBuilderOptions";
import { findRace, useBuilderState } from "./useBuilderState";
import { usePickerGroups } from "./usePickerGroups";
import { useTableRules } from "./useTableRules";

export type { BuilderResult } from "./submit";

// Full character creation flow as a six-step wizard: identity, ancestry,
// calling, abilities, spells and gear, finishing touches, paced by the diamond
// stepper and the gold step wipe (docs/visual-overhaul-plan.md 7). Open5e
// races/classes/subclasses/backgrounds (SRD fallback), three ability-score
// methods, spell/equipment/feat pickers, live derived stats. Used by
// /characters/new, the campaign join/edit/replace page and the companion
// dialog. The fields, validation and submitted sheet are unchanged from the
// single-page form this replaced; only the pacing is new.
export default function CharacterBuilder({
  campaignId,
  fixedLevel,
  genre,
  worldPackId,
  initial,
  initialLevel,
  submitLabel,
  onSubmit,
  busy,
  error,
  role,
  className,
}: {
  // The table the character is made for: its hit point method and starting
  // wealth decide the numbers shown, and its wealth is rolled here. Absent in
  // the library, where the defaults apply.
  campaignId?: string;
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
  // The level the stored character reached (its library row's). Improvements
  // it earned up to there with no recorded pick were taken in play and are
  // already in its scores.
  initialLevel?: number;
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
  } = useBuilderOptions(initial?.race);
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

  const state = useBuilderState({ initial, initialLevel, fixedLevel, races, classes, backgrounds });
  const race = findRace(races, state.raceId) ?? races[0];
  const klass = classes.find((entry) => entry.id === state.classId) ?? classes[0];
  const background =
    backgrounds.find((entry) => entry.id === state.backgroundId) ?? backgrounds[0];
  const archetypes = useArchetypes(klass?.id ?? "");

  const table = useTableRules(campaignId, klass?.id);
  const derived = useBuilderDerived({ state, race, klass, background, fixedLevel, rules: table.rules });
  const actions = builderActions(state, klass, race, background);
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
  // This builder's own root, so the footer's "Show me" looks inside it and
  // not in another builder on the page.
  const rootId = useId();

  // Takes the player to the block that holds the missing pick: scrolls the
  // active step to it, lights it for a moment and puts focus on its first
  // control (issue #117).
  function locate(target: BlockerTarget) {
    const found = document.querySelector<HTMLElement>(
      `[data-builder-root="${rootId}"] [data-active] [data-builder-target="${target}"]`,
    );
    if (!found) {
      return;
    }
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    found.scrollIntoView({ block: "start", inline: "nearest", behavior: still ? "auto" : "smooth" });
    found.removeAttribute("data-flash");
    void found.offsetWidth;
    found.setAttribute("data-flash", "");
    window.setTimeout(() => found.removeAttribute("data-flash"), 1600);
    // The first control that takes the pick: a field or a select before any
    // card, and never a block's own "what is this" button.
    const control =
      found.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button[aria-haspopup]') ??
      found.querySelector<HTMLElement>(
        'button:not(.creator-help):not([aria-label^="Details"]):not([aria-label^="What is"]), [tabindex="0"]',
      );
    control?.focus({ preventScroll: true });
  }
  const gate = (blocked: StepBlock | null) => ({
    canContinue: !blocked,
    blocker: blocked?.message ?? null,
    onBlocked: blocked ? () => locate(blocked.target) : undefined,
  });

  function submit() {
    const input = { state, derived, race, klass, background, initial };
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
    identity: identityBlocker(state, background),
    ancestry: ancestryBlocker(state, race, background),
    calling: callingBlocker(klass, state, derived),
    abilities: abilitiesBlocker(derived, state),
    spells: spellsBlocker(state, derived, klass) ?? gearBlocker(derived),
  };
  const casts = derived.casts;

  const steps: WizardStep[] = [
    {
      key: "identity",
      label: "Identity",
      title: "Who is this?",
      ...gate(blockers.identity),
      content: (
        <>
          <IdentityStep
            state={state}
            pack={pack}
            packInstalled={packInstalled}
            fixedLevel={fixedLevel}
            role={role}
            alignmentGroups={pickers.alignmentGroups}
            alignmentInfo={pickers.alignmentInfo}
            backgroundGroups={pickers.backgroundGroups}
            background={background}
          />
        </>
      ),
    },
    {
      key: "ancestry",
      label: "Ancestry",
      title: "Ancestry",
      blurb: "Where are they from, and what does that grant?",
      ...gate(blockers.ancestry),
      continueLabel: race ? `Continue as ${race.name}` : undefined,
      content: (
        <>
          <AncestryStep
            state={state}
            race={race}
            background={background}
            races={races}
            raceGroups={pickers.raceGroups}
          />
        </>
      ),
    },
    {
      key: "calling",
      label: "Calling",
      title: "Calling",
      blurb: "The class decides how this character plays.",
      ...gate(blockers.calling),
      content: (
        <>
          <CallingStep
            state={state}
            derived={derived}
            actions={actions}
            klass={klass}
            race={race}
            background={background}
            pack={pack}
            classes={classes}
            classGroups={pickers.classGroups}
            subclassGroups={pickers.subclassGroups}
            offersSubclass={pickers.offersSubclass}
            subclassLockedAt={pickers.subclassLockedAt}
            chosenArchetype={pickers.chosenArchetype}
          />
        </>
      ),
    },
    {
      key: "abilities",
      label: "Ability scores",
      title: "Ability scores",
      blurb: "How do you roll?",
      ...gate(blockers.abilities),
      content: (
        <>
          <AbilitiesStep state={state} derived={derived} race={race} klass={klass} />
        </>
      ),
    },
    {
      key: "spells-gear",
      label: casts ? "Spells and gear" : "Gear",
      title: casts ? "Spells and gear" : "Gear",
      blurb: casts ? "Pick what they can cast, then arm your hero." : "Arm your hero.",
      ...gate(blockers.spells),
      content: (
        <>
          <SpellsGearStep
            state={state}
            derived={derived}
            actions={actions}
            klass={klass}
            background={background}
            table={table}
            pack={pack}
          />
        </>
      ),
    },
    {
      key: "finish",
      label: "Finishing touches",
      title: "Finishing touches",
      blurb: "Who have you made?",
      canContinue: !busy,
      content: (
        <FinishStep
          state={state}
          derived={derived}
          race={race}
          klass={klass}
          background={background}
          table={table}
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
    <div data-builder-root={rootId} className={cn("flex h-[max(30rem,calc(100dvh-14rem))] flex-col text-sm", className)}>
      <Wizard
        title={state.name.trim() || "New character"}
        variant="diamonds"
        wipe
        goldTitles
        aside={
          race && klass
            ? `${race.name} ${klass.name} · level ${derived.effectiveLevel} · d${klass.hitDie}`
            : undefined
        }
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
