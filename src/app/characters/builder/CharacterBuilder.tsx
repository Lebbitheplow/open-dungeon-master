"use client";

import { ContentScopeProvider } from "@/lib/content-scope";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { Wizard, type WizardNotice, type WizardStep } from "@/components/ui/Wizard";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { prefersStillMotion, useEffectsRoot } from "@/lib/effects-mode";
import type { Genre } from "@/lib/schemas/game-settings";
import type { Ability, CreateSheetInput } from "@/lib/schemas/sheet";
import { SRD_SKILLS } from "@/lib/srd";
import { FIGHTING_STYLES } from "@/lib/srd/feature-effects";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { classRoles } from "@/lib/srd/class-roles";
import { applyClassReskins, applyIdReskins } from "@/lib/worlds/reskin-logic";
import { ABILITY_LABELS } from "./AbilityEditor";
import type { DroppedPick } from "./reconcile";
import { AbilitiesStep } from "./steps/AbilitiesStep";
import { AncestryStep } from "./steps/AncestryStep";
import { CallingStep } from "./steps/CallingStep";
import { FinishStep, type BuilderRole } from "./steps/FinishStep";
import { IdentityStep } from "./steps/IdentityStep";
import { SpellsGearStep } from "./steps/SpellsGearStep";
import { OwedLine } from "./steps/shared";
import { owedPicks } from "./owed";
import { playstyleBackgrounds, type PlaystyleId } from "./playstyles";
import {
  abilitiesBlocks,
  ancestryBlocks,
  buildBuilderResult,
  callingBlocks,
  gearBlocker,
  identityBlocks,
  spellsBlocks,
  validateBuilder,
  type BlockerTarget,
  type BuilderResult,
  type StepBlock,
} from "./submit";
import { clearBuilderDraft, readBuilderDraft, writeBuilderDraft, type BuilderDraft } from "./builderDraft";
import { builderActions, useBuilderDerived } from "./useBuilderDerived";
import { BuildMathPanel } from "./BuildMathPanel";
import { useArchetypeOptions, useBuilderOptions, useWorldPack, type OptionListKind } from "./useBuilderOptions";
import { TableScopeNote } from "./TableScopeNote";
import { summaryRows, type SummaryRowKey } from "./summary";
import { ALIGNMENT_LABELS } from "./usePickerGroups";
import { listWords, unofferedPicks } from "./unoffered";
import { findRace, useBuilderState, type DroppedNotice } from "./useBuilderState";
import { useFeatDescs, useFeatTexts } from "./useFeatDescs";
import { builderFeatJudge, FeatJudgeContext, unmetFeatMessage } from "./featPrereqs";
import { racialFeatCount } from "@/lib/srd/race-id";
import { usePickerGroups } from "./usePickerGroups";
import type { PickerGroup } from "./OptionPicker";
import { useWiderSpellPool } from "@/components/sheet/useSpellPool";
import { QuickBuildQuiz, type QuizVoice } from "./QuickBuildQuiz";
import { QuickBuildReadback } from "./QuickBuildReadback";
import { useQuickFill, type FillRequest } from "./useQuickFill";
import { useTableRules } from "./useTableRules";

export type { BuilderResult } from "./submit";

// The step each pick is made on, by the block that collects it, so a notice
// about a dropped pick can take the player to where it is made again.
const STEP_OF_TARGET: Record<BlockerTarget, string> = {
  name: "identity",
  background: "identity",
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

// The steps' keys in order, for the summary's Edit and Fix links and for a
// quick build's read-back, whose Change goes to a pick's step.
const STEP_ORDER = ["identity", "ancestry", "calling", "abilities", "spells-gear", "finish"];

// The rows a picker offers, in its order: what the quiz and the fill choose
// from, so they never pick what this table leaves out.
function offeredRows<T extends { id: string }>(rows: T[], groups: PickerGroup[]): T[] {
  const ids = [...new Set(groups.flatMap((group) => group.options.map((option) => option.id)).filter(Boolean))];
  const picked = ids.flatMap((id) => rows.filter((row) => row.id === id).slice(0, 1));
  return picked.length ? picked : rows;
}

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
// class, abilities, spells and gear, finish, paced by the diamond
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
  startLevel,
  levelNote,
  submitLabel,
  onSubmit,
  busy,
  error,
  role,
  draftKey,
  onCancel,
  quizVoice = "player",
  openQuiz = false,
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
  // Open a stored character this many levels up ("Level up" in the library),
  // or a new one at this level when the door knows it (door.ts).
  startLevel?: number;
  // Where that level came from, said under the level select.
  levelNote?: string;
  submitLabel: string;
  onSubmit: (result: BuilderResult) => void;
  busy: boolean;
  error: string;
  // Player character or DM-played ally, asked on the Finish step; only the
  // library page asks, and only when the link that opened it did not say
  // (door.ts), since a campaign already knows which door the character
  // comes through.
  role?: { value: BuilderRole; onChange: (role: BuilderRole) => void };
  // Where a new character's progress is kept on this device
  // (builderDraftKey); the caller clears it once the save succeeds. Ignored
  // for an edit.
  draftKey?: string;
  // Where the first step's back arrow leads (the page or dialog it opened
  // from), as every other wizard's does; later steps step back as before.
  onCancel?: () => void;
  // Whose job the first step's question and "Help me build" ask about: a
  // player's own hero, or (the DM's quick companion) what the party needs.
  quizVoice?: QuizVoice;
  // Open on "Help me build" (the hero chooser's door to it, backlog F1).
  openQuiz?: boolean;
  className?: string;
}) {
  // creator.css stills its loops under <html data-effects="low">, which only
  // the table's session view set; the library and join pages build
  // characters outside it.
  useEffectsRoot();
  const {
    races: rawRaces,
    classes: rawClasses,
    backgrounds: rawBackgrounds,
    packInstalled,
    loaded,
    status: optionStatus,
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
  const state = useBuilderState({ initial, initialFeatDescs, initialLevel, fixedLevel, startLevel, races, classes, backgrounds });
  // No stand-in for a race, class or background the player has not chosen:
  // the first row used to be shown as if picked ("Continue as Aarakocra"),
  // so the step's own race gate could never hold, and an untouched
  // background was an Acolyte owing two languages nobody asked for.
  const race = findRace(races, state.raceId);
  const klass = classes.find((entry) => entry.id === state.classId);
  const background = backgrounds.find((entry) => entry.id === state.backgroundId);
  const subclassOptions = useArchetypeOptions(klass?.id ?? "");
  const archetypes = subclassOptions.archetypes;
  // Why a list is short: the asker's own Homebrew a table leaves out, or a
  // list the server did not send (workshop import audit F06).
  const scopeNote = (noun: string, kind: OptionListKind) => (
    <TableScopeNote noun={noun} unadmitted={optionStatus.unadmitted[kind]} failed={optionStatus.failed.includes(kind)} onRetry={optionStatus.retry} />
  );

  const table = useTableRules(campaignId, klass?.id);
  // The text of every feat picked, for what each grants (issue #125); a
  // content pack's is fetched once.
  const featTexts = useFeatTexts([
    ...state.feats,
    ...state.asiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : [])),
  ]);
  const featDescs = featTexts.descs;
  const derived = useBuilderDerived({ state, race, klass, background, fixedLevel, rules: table.rules, featDescs, genre });
  // Each feat's prerequisite judged as the save judges it, against the
  // character as built so far (featPrereqs.ts): the feat pickers read it,
  // and the gates below flag a picked feat a later choice broke.
  const featJudge = builderFeatJudge({ state, derived, race, klass, background }, featTexts.prerequisites, initial?.feats);
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
  // What the last save found missing, until the player goes to it.
  const [saveProblem, setSaveProblem] = useState<{ message: string; target: BlockerTarget } | null>(null);
  // "How do you want to play?", asked on the first step of a new character
  // and carried to the class step.
  const [playstyle, setPlaystyle] = useState<PlaystyleId | null>(null);

  // An unfinished new character is kept on this device as it is built
  // (builderDraft.ts), and offered back the next time this door opens. The
  // step is the builder's so a resumed draft can land where it was left.
  const draftAt = !initial && draftKey ? draftKey : null;
  // An edit opens on the last step, the summary (backlog F3): one row per
  // step with a way to it, so changing one pick never starts at step 1.
  const [step, setStep] = useState(initial ? STEP_ORDER.length - 1 : 0);
  // Once the summary has been seen, every other step offers "Back to
  // summary", and that returns focus to the row the player left from.
  const [summarySeen, setSummarySeen] = useState(Boolean(initial));
  if (step === STEP_ORDER.length - 1 && !summarySeen) {
    setSummarySeen(true);
  }
  const [cameFrom, setCameFrom] = useState<SummaryRowKey | null>(null);
  const [returnTo, setReturnTo] = useState<{ row: SummaryRowKey } | null>(null);
  function backToSummary(from: string) {
    setReturnTo({ row: cameFrom ?? (from as SummaryRowKey) });
    setCameFrom(null);
    setStep(STEP_ORDER.length - 1);
  }
  const [draftOffer, setDraftOffer] = useState<BuilderDraft | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  useEffect(() => {
    if (!draftAt) {
      return;
    }
    // Read after mount: the server render has no storage to read.
    void Promise.resolve().then(() => {
      setDraftOffer(readBuilderDraft(draftAt));
      setDraftChecked(true);
    });
  }, [draftAt]);
  const draftJson = draftAt ? JSON.stringify(state.draftFields) : "";
  const begun = Boolean(state.name.trim() || state.raceId || state.classId);
  useEffect(() => {
    // Nothing is written over a draft still on offer, or for a builder
    // opened and left untouched.
    if (!draftAt || !draftChecked || draftOffer || !begun) {
      return;
    }
    const id = window.setTimeout(() => writeBuilderDraft(draftAt, step, JSON.parse(draftJson)), 400);
    return () => window.clearTimeout(id);
  }, [draftAt, draftChecked, draftOffer, begun, draftJson, step]);
  function resumeDraft() {
    if (!draftOffer) {
      return;
    }
    state.restoreDraft(draftOffer.fields);
    setStep(draftOffer.step);
    setDraftOffer(null);
  }
  function discardDraft() {
    if (draftAt) {
      clearBuilderDraft(draftAt);
    }
    setDraftOffer(null);
  }

  // The quick build (quickBuild.ts): the quiz, "Fill what's left" and the
  // cards' "Pick for me" all choose from what this builder offers.
  const offered = {
    classes: offeredRows(classes, pickers.classGroups),
    races: offeredRows(races, pickers.raceGroups),
    backgrounds: offeredRows(backgrounds, pickers.backgroundGroups),
    recommended: new Set(
      pickers.classGroups.filter((group) => group.recommended).flatMap((group) => group.options.map((option) => option.id)),
    ),
  };
  // The spell step's own list for this class, so a fill picks what the
  // step would offer (shared with it: one fetch).
  const { pool: spellPool } = useWiderSpellPool(derived.spellSearchClass, derived.maxSpellLevel, derived.casts, derived.spellWider);
  // "Help me build" open, with the job already picked on the first step.
  const [quiz, setQuiz] = useState<{ role: PlaystyleId | null } | null>(openQuiz ? { role: null } : null);
  const fill = useQuickFill({
    state,
    derived,
    race,
    klass,
    background,
    offered,
    subclasses: pickers.subclassGroups.flatMap((group) => group.options.map((option) => option.id)).filter(Boolean),
    spellPool,
    // A quiz character opens on the last step, where every part shows with
    // a way back to it.
    onDone: (done) => {
      if (done.from === "quiz") {
        setStep(STEP_ORDER.length - 1);
      }
    },
  });
  function startFill(request: FillRequest = {}) {
    setSaveProblem(null);
    fill.start(request);
  }

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
    // Smooth only when the device allows motion: the system setting or the
    // app's own Effects setting can each ask for a jump instead.
    const still = prefersStillMotion();
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

  // A stored race, class or background these lists do not hold shows as not
  // chosen. The save waits until the player picks on purpose (issue 229).
  const unoffered = initial && loaded ? unofferedPicks(initial, state, races, classes, backgrounds) : [];
  const unofferedText = unoffered.length
    ? `This builder does not offer ${initial?.name || "this character"}'s ${listWords(unoffered.map((entry) => entry.what))}: a table's own content, or a row this server no longer has. The save waits until you pick on purpose. Leave without saving to keep ${initial?.name || "them"} as stored.`
    : "";

  function submit() {
    if (unofferedText) {
      state.setLocalError(unofferedText);
      return;
    }
    const input = { state, derived, race, klass, background, initial, featJudge };
    const problem = validateBuilder(input);
    if (problem) {
      if (problem.kind === "spellWarning") {
        state.setSpellWarningAck(true);
      }
      // A pick that is missing says so above the steps with "Show me", which
      // goes to its step and its field, the way the footer's blocker does;
      // the warning and the unplaceable ones stay by the save button.
      if (problem.target) {
        state.setLocalError("");
        setSaveProblem({ message: problem.message, target: problem.target });
      } else {
        setSaveProblem(null);
        state.setLocalError(problem.message);
      }
      return;
    }
    setSaveProblem(null);
    state.setLocalError("");
    onSubmit(buildBuilderResult(input));
  }

  // An edit arrives on the summary with focus on its heading, as a step
  // change puts it (Wizard.tsx); "Back to summary" puts it on the row's
  // Edit instead. Both run after the wizard's own focus move.
  const ready = Boolean(races.length && classes.length && backgrounds.length);
  const arrived = useRef(false);
  useEffect(() => {
    if (!ready || !initial || arrived.current) {
      return;
    }
    arrived.current = true;
    document
      .querySelector<HTMLElement>(`[data-builder-root="${rootId}"] section[data-active] .wizard-step-heading`)
      ?.focus({ preventScroll: true });
  }, [ready, initial, rootId]);
  useEffect(() => {
    if (returnTo) {
      document
        .querySelector<HTMLElement>(`[data-builder-root="${rootId}"] section[data-active] [data-summary-edit="${returnTo.row}"]`)
        ?.focus();
    }
  }, [returnTo, rootId]);

  if (!ready) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  // Each gate mirrors a rule the final check enforces, so a player learns
  // about a missing pick on the step where they can fix it. The gate is the
  // first pick owed; the step's "choices left" line names them all.
  const gear = gearBlocker(derived);
  const owed = {
    identity: identityBlocks(state, background),
    ancestry: ancestryBlocks(state, race, background, derived, featJudge),
    calling: callingBlocks(klass, state, derived),
    // The scores set here can break the racial feat picked a step back;
    // it is flagged here too, with the way back to it.
    abilities: [
      ...abilitiesBlocks(derived, state, featJudge),
      ...racialFeatBlock(unmetFeatMessage(featJudge, state.feats.slice(0, race ? racialFeatCount(race.id) : 0))),
    ],
    spells: [...spellsBlocks(derived, klass), ...(gear ? [gear] : [])],
  };
  const blockers = {
    identity: owed.identity[0] ?? null,
    ancestry: owed.ancestry[0] ?? null,
    calling: owed.calling[0] ?? null,
    abilities: owed.abilities[0] ?? null,
    spells: owed.spells[0] ?? null,
  };
  // The summary holds Save on the first pick owed anywhere, and its Show me
  // goes to that pick's step and field, as a row's Fix does.
  const firstOwed = blockers.identity ?? blockers.ancestry ?? blockers.calling ?? blockers.abilities ?? blockers.spells;
  const owedLine = (blocks: typeof owed.identity) => (
    <OwedLine picks={owedPicks(blocks)} onShow={locate} onFill={fill.running ? undefined : () => startFill()} />
  );
  // What a fill left for the player (a spell list that ran out), said in its
  // read-back.
  const stillOwed = Object.values(owed).reduce((sum, blocks) => sum + owedPicks(blocks).length, 0);
  // A change from the read-back: to the pick's step, then to its block once
  // the step is showing.
  function changePick(target: BlockerTarget) {
    const index = STEP_ORDER.indexOf(STEP_OF_TARGET[target]);
    if (index >= 0) {
      setStep(index);
    }
    window.setTimeout(() => locate(target), 350);
  }
  const casts = derived.casts;
  const summary = summaryRows({
    name: state.name,
    background: background?.name,
    race: race?.name,
    klass: klass?.name,
    subclass: state.subclass || undefined,
    level: derived.effectiveLevel,
    abilities: derived.shownAbilities,
    casts,
    cantrips: state.cantrips,
    spells: state.spells,
    gear: derived.fullEquipment,
    alignment: ALIGNMENT_LABELS[state.alignment]?.name ?? state.alignment,
    portrait: Boolean(state.portrait),
    appearance: Boolean(state.appearance.trim()),
    backstory: Boolean(state.backstory.trim()),
    owed,
  });
  // The classes this table offers, as the playstyle answer reads them.
  const playstyleOffered = pickers.classGroups.flatMap((group) =>
    group.options.map((option) => {
      const reading = classRoles(classes.find((candidate) => candidate.id === option.id) ?? { id: option.id });
      return { id: option.id, name: option.name, roles: reading.roles, playsLike: reading.playsLike };
    }),
  );

  // Each step's title is the task in plain words; its label is the short
  // name printed under its diamond and said with it, and the one the notices
  // above the steps use ("asked for on the Class step").
  const steps: WizardStep[] = [
    {
      key: "identity",
      label: "Hero",
      title: "Name your hero and choose their past",
      ...gate(blockers.identity),
      content: (
        <>
          {owedLine(owed.identity)}
          <IdentityStep
            state={state}
            pack={pack}
            packInstalled={packInstalled}
            fixedLevel={fixedLevel}
            levelNote={levelNote}
            playstyle={
              initial
                ? undefined
                : {
                    value: playstyle,
                    onChange: setPlaystyle,
                    offered: playstyleOffered,
                    chosenClass: klass?.id ?? "",
                    onChooseClass: state.changeClass,
                    backgrounds: playstyle ? playstyleBackgrounds(playstyle, backgrounds) : [],
                    question: quizVoice === "party" ? "What does the party need?" : "In a fight, what's your job?",
                    onHelpMeBuild: (role) => setQuiz({ role }),
                  }
            }
            backgroundGroups={pickers.backgroundGroups}
            background={background}
            backgroundNote={scopeNote("backgrounds", "backgrounds")}
          />
        </>
      ),
    },
    {
      key: "ancestry",
      label: "Ancestry",
      title: "Choose where your hero comes from",
      blurb: "Their people, and what that grants.",
      ...gate(blockers.ancestry),
      continueLabel: race ? `Continue as ${race.name}` : undefined,
      content: (
        <>
          {owedLine(owed.ancestry)}
          <AncestryStep
            state={state}
            derived={derived}
            race={race}
            background={background}
            races={races}
            raceGroups={pickers.raceGroups}
            listNote={scopeNote("species", "races")}
          />
        </>
      ),
    },
    {
      key: "calling",
      label: "Class",
      title: "Choose how you fight or use magic",
      blurb: "The class decides how this character plays.",
      ...gate(blockers.calling),
      content: (
        <>
          {owedLine(owed.calling)}
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
            classNote={scopeNote("classes", "classes")}
            subclassNote={<TableScopeNote noun="subclasses" unadmitted={subclassOptions.unadmitted} failed={subclassOptions.failed} onRetry={subclassOptions.retry} />}
            playstyle={initial ? undefined : { value: playstyle, onChange: setPlaystyle }}
            onPickForMe={fill.running ? undefined : (target) => startFill({ only: [target] })}
          />
        </>
      ),
    },
    {
      key: "abilities",
      label: "Abilities",
      title: "Set what your hero is good at",
      blurb: "How do you roll?",
      ...gate(blockers.abilities),
      content: (
        <>
          {owedLine(owed.abilities)}
          <AbilitiesStep
            state={state}
            derived={derived}
            race={race}
            klass={klass}
            onPickForMe={fill.running ? undefined : (target) => startFill({ only: [target] })}
          />
        </>
      ),
    },
    {
      key: "spells-gear",
      label: casts ? "Spells" : "Gear",
      title: casts ? "Choose spells and gear" : "Choose your gear",
      blurb: casts ? "Pick what they can cast, then arm your hero." : "Arm your hero.",
      ...gate(blockers.spells),
      content: (
        <>
          {owedLine(owed.spells)}
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
      label: "Finish",
      title: "Check your hero and finish",
      blurb: "Who have you made?",
      canContinue: !busy && !firstOwed,
      blocker: firstOwed?.message ?? null,
      onBlocked: firstOwed ? () => changePick(firstOwed.target) : undefined,
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
          onEdit={(key) => {
            setCameFrom(key);
            setStep(STEP_ORDER.indexOf(key));
          }}
          summary={summary}
          onFix={(target) => {
            setCameFrom(STEP_OF_TARGET[target] as SummaryRowKey);
            changePick(target);
          }}
          alignmentGroups={pickers.alignmentGroups}
          alignmentInfo={pickers.alignmentInfo}
          role={role}
        />
      ),
    },
  ];

  // Every step but the summary goes back to it once it has been seen.
  const flow: WizardStep[] = summarySeen
    ? steps.map((entry, index) =>
        index === STEP_ORDER.length - 1
          ? entry
          : { ...entry, secondary: { label: "Back to summary", onClick: () => backToSummary(entry.key) } },
      )
    : steps;

  // What the last change set aside, said above the steps with a way to the
  // step it belongs to (issue #124: the list was computed and thrown away).
  const dropped = state.dropped;
  const droppedStep = dropped ? steps.findIndex((entry) => entry.key === STEP_OF_TARGET[dropped.drops[0].target]) : -1;
  const problemStep = saveProblem ? steps.findIndex((entry) => entry.key === STEP_OF_TARGET[saveProblem.target]) : -1;
  const notice: WizardNotice | undefined = saveProblem
    ? {
        message: saveProblem.message,
        step: problemStep >= 0 ? problemStep : undefined,
        onShow: () => locate(saveProblem.target),
        onDismiss: () => setSaveProblem(null),
      }
    : dropped
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
      {unofferedText ? (
        <p role="alert" className="reveal mb-3 shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {unofferedText}
        </p>
      ) : null}
      {draftOffer ? (
        <div role="status" className="reveal mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
          <span className="min-w-0 flex-1">
            You have an unfinished character here
            {draftOffer.fields.name.trim() ? <>: <span className="font-medium">{draftOffer.fields.name.trim()}</span></> : null}
            , left on step {Math.min(draftOffer.step, steps.length - 1) + 1} of {steps.length}.
          </span>
          <button type="button" onClick={resumeDraft} className={ui.btnSmall}>
            Resume
          </button>
          <button type="button" onClick={discardDraft} className={cn(ui.btnSmall, "text-stone-400")}>
            Start fresh
          </button>
        </div>
      ) : null}
      {fill.readback ? (
        <QuickBuildReadback
          readback={fill.readback}
          stillOwed={stillOwed}
          onChange={changePick}
          onUndo={() => {
            fill.undo();
            if (fill.readback?.from === "quiz") {
              setStep(0);
            }
          }}
          onDismiss={fill.dismiss}
        />
      ) : fill.kept ? (
        // What was picked stays a tap away after "Keep them", until the
        // character is saved or another fill starts.
        <p data-quick-kept="" className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-stone-800 px-3 py-1.5 text-xs text-stone-400">
          <span className="min-w-0 flex-1">
            {fill.kept.filled.length} {fill.kept.filled.length === 1 ? "choice was" : "choices were"} picked for you.
          </span>
          <button type="button" onClick={fill.reopen} className="text-sky-300 underline-offset-2 hover:underline">
            Show what was picked
          </button>
        </p>
      ) : null}
      {quiz ? (
        <QuickBuildQuiz
          voice={quizVoice}
          classes={offered.classes}
          races={offered.races}
          backgrounds={offered.backgrounds}
          recommended={offered.recommended}
          initial={quiz.role ? { role: quiz.role } : undefined}
          onCancel={() => setQuiz(null)}
          onChoose={(seed, answers) => {
            setQuiz(null);
            // The class step's picker opens on the job the quiz was given.
            setPlaystyle(answers.role);
            startFill({ seed, answers });
          }}
        />
      ) : (
      <FeatJudgeContext.Provider value={featJudge}>
      {/* The build math table (F10): beside the steps where the builder is wide, under them where it is not. */}
      <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 @4xl:flex-row @4xl:gap-5">
      <Wizard
        className="min-w-0 flex-1"
        step={step}
        onStepChange={setStep}
        title={state.name.trim() || "New character"}
        variant="diamonds"
        stepNames
        // The wipe paces a first build; an edit of a stored character moves
        // between steps at once.
        wipe={!initial}
        goldTitles
        // A player who went back to fix one pick returns by its diamond, and
        // an edit of a stored character saves from whichever step it is on.
        jumpAhead
        finishFromAnyStep={Boolean(initial)}
        notice={notice}
        aside={
          race || klass
            ? [
                [race?.name, klass?.name].filter(Boolean).join(" "),
                `level ${derived.effectiveLevel}`,
                ...(klass ? [`d${klass.hitDie}`] : []),
              ].join(" · ")
            : undefined
        }
        steps={flow}
        onCancel={onCancel}
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
      <BuildMathPanel derived={derived} scores={state.scores} klass={klass} atTable={Boolean(table.rules)} />
      </div>
      </div>
      </FeatJudgeContext.Provider>
      )}
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

function racialFeatBlock(message: string | null): Array<{ message: string; target: BlockerTarget }> {
  return message ? [{ message, target: "racialFeat" }] : [];
}
