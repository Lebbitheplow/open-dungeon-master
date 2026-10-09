"use client";

import { ContentScopeProvider } from "@/lib/content-scope";
import { Loader2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { Wizard, type WizardNotice, type WizardStep } from "@/components/ui/Wizard";
import { cn } from "@/lib/cn";
import type { Genre } from "@/lib/schemas/game-settings";
import type { Ability, CreateSheetInput } from "@/lib/schemas/sheet";
import { SRD_SKILLS } from "@/lib/srd";
import { FIGHTING_STYLES } from "@/lib/srd/feature-effects";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { applyClassReskins, applyIdReskins } from "@/lib/worlds/reskin-logic";
import { ABILITY_LABELS } from "./AbilityEditor";
import type { DroppedPick } from "./reconcile";
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
import { findRace, useBuilderState, type DroppedNotice } from "./useBuilderState";
import { useFeatDescs } from "./useFeatDescs";
import { usePickerGroups } from "./usePickerGroups";
import { useTableRules } from "./useTableRules";

export type { BuilderResult } from "./submit";

// The step each pick is made on, by the block that collects it, so a notice
// about a dropped pick can take the player to where it is made again.
const STEP_OF_TARGET: Record<BlockerTarget, string> = {
  name: "identity",
  backgroundSkills: "identity",
  race: "ancestry",
  languages: "ancestry",
  racialAsi: "ancestry",
  racialSkills: "ancestry",
  racialTool: "ancestry",
  racialCantrip: "ancestry",
  racialFeat: "ancestry",
  ancestry: "ancestry",
  repeatSkills: "ancestry",
  class: "calling",
  classSkills: "calling",
  tools: "calling",
  subclass: "calling",
  styles: "calling",
  expertise: "calling",
  options: "calling",
  scores: "abilities",
  asi: "abilities",
  spells: "spells-gear",
  gear: "spells-gear",
};

// A dropped pick as the player knows it: skill and style ids by name, an
// ability by its word, everything else as it was picked.
function droppedName(drop: DroppedPick): string {
  switch (drop.target) {
    case "classSkills":
    case "racialSkills":
    case "backgroundSkills":
    case "expertise":
      return SRD_SKILLS.find((skill) => skill.id === drop.value)?.name ?? drop.value;
    case "styles":
      return FIGHTING_STYLES.find((style) => style.id === drop.value)?.name ?? drop.value;
    case "racialAsi":
      return ABILITY_LABELS[drop.value as Ability] ?? drop.value;
    default:
      return drop.value;
  }
}

// "Changing the race set aside bonus language Dwarvish and bonus language
// Giant: they no longer fit. Anything still owed is asked for on the
// Ancestry step." The notice says what went, never that it must be picked
// again: a language dropped because the new race has fewer slots is not
// owed, and the step's own gate knows which picks are.
function droppedMessage({ because, drops }: DroppedNotice, stepLabel: string | undefined): string {
  const list = drops.map((drop) => `${drop.label} ${droppedName(drop)}`);
  const named =
    list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  const where = stepLabel ? ` Anything still owed is asked for on the ${stepLabel} step.` : "";
  if (because === "stored character") {
    return `${list.length === 1 ? "A stored pick is" : "Stored picks are"} no longer on offer: ${named}.${where}`;
  }
  if (because === "content pack") {
    return `The content pack's rows set aside ${named}.${where}`;
  }
  return `Changing the ${because} set aside ${named}: ${list.length === 1 ? "it no longer fits" : "they no longer fit"}.${where}`;
}

// Full character creation flow as a six-step wizard: identity, ancestry,
// calling, abilities, spells and gear, finishing touches, paced by the diamond
// stepper and the gold step wipe (docs/visual-overhaul-plan.md 7). Open5e
// races/classes/subclasses/backgrounds (SRD fallback), three ability-score
// methods, spell/equipment/feat pickers, live derived stats. Used by
// /characters/new, the campaign join/edit/replace page and the companion
// dialog. The fields, validation and submitted sheet are unchanged from the
// single-page form this replaced; only the pacing is new.
// At a table, every content request the builder makes is that table's
// (src/lib/content-scope.tsx): its DMs' workshop species, feats, spells and
// subclasses are offered, the same ones the server admits.
export default function CharacterBuilder(props: Parameters<typeof CharacterBuilderForm>[0]) {
  return (
    <ContentScopeProvider campaignId={props.campaignId}>
      <CharacterBuilderForm {...props} />
    </ContentScopeProvider>
  );
}

function CharacterBuilderForm({
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

  // The text of a stored character's feats, fetched before its scores are
  // read back (a content pack half-feat's point comes off them).
  const initialFeatDescs = useFeatDescs([
    ...(initial?.feats ?? []),
    ...(initial?.asiChoices ?? []).flatMap((choice) => (choice.mode === "feat" ? [choice.feat] : [])),
  ]);
  const state = useBuilderState({ initial, initialFeatDescs, initialLevel, fixedLevel, races, classes, backgrounds });
  const race = findRace(races, state.raceId) ?? races[0];
  const klass = classes.find((entry) => entry.id === state.classId) ?? classes[0];
  const background =
    backgrounds.find((entry) => entry.id === state.backgroundId) ?? backgrounds[0];
  const archetypes = useArchetypes(klass?.id ?? "");

  const table = useTableRules(campaignId, klass?.id);
  // The text of every feat picked, for what each grants (issue #125); a
  // content pack's is fetched once.
  const featDescs = useFeatDescs([
    ...state.feats,
    ...state.asiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : [])),
  ]);
  const derived = useBuilderDerived({ state, race, klass, background, fixedLevel, rules: table.rules, featDescs });
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
    ancestry: ancestryBlocker(state, race, background, derived),
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
            derived={derived}
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

  // What the last change set aside, said above the steps with a way to the
  // step it belongs to (issue #124: the list was computed and thrown away).
  const dropped = state.dropped;
  const droppedStep = dropped ? steps.findIndex((entry) => entry.key === STEP_OF_TARGET[dropped.drops[0].target]) : -1;
  const notice: WizardNotice | undefined = dropped
    ? {
        message: droppedMessage(dropped, droppedStep >= 0 ? steps[droppedStep].label : undefined),
        step: droppedStep >= 0 ? droppedStep : undefined,
        onShow: () => locate(dropped.drops[0].target),
        onDismiss: state.dismissDropped,
      }
    : undefined;

  return (
    // A bounded height so each step scrolls on its own and the Continue
    // button stays put; the fallback keeps a usable pane on a short phone.
    <div data-builder-root={rootId} className={cn("flex h-[max(30rem,calc(100dvh-14rem))] flex-col text-sm", className)}>
      <Wizard
        title={state.name.trim() || "New character"}
        variant="diamonds"
        wipe
        goldTitles
        notice={notice}
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
