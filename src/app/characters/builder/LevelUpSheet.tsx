"use client";

import { ContentScopeProvider } from "@/lib/content-scope";
import { HeartPulse, Loader2, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { useWiderSpellPool } from "@/components/sheet/useSpellPool";
import { cn } from "@/lib/cn";
import { useEffectsRoot, prefersStillMotion } from "@/lib/effects-mode";
import { firstSentence } from "@/lib/help/rules-text";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { featChoice } from "@/lib/schemas/sheet";
import { subclassBlurb, subclassLevelFor } from "@/lib/srd/features";
import { racialFeatCount } from "@/lib/srd/race-id";
import { withSpeciesVariant } from "@/lib/content/species-variants";
import { ui } from "@/lib/ui";
import { applyClassReskins, applyIdReskins } from "@/lib/worlds/reskin-logic";
import AsiFeatEditor from "./AsiFeatEditor";
import FeatChoicesFields, { knownTraining } from "./FeatChoicesFields";
import { builderFeatJudge, FeatJudgeContext, unmetFeatMessage } from "./featPrereqs";
import { hitPointsLine } from "./derivedReasons";
import { builderProgressionInput, LevelProgressionTable } from "./LevelProgressionTable";
import { levelProgressionRows } from "./levelProgression";
import { levelUpSections, racialCantripsDue, SHEET_TARGETS, splitOwed } from "./levelUpSections";
import OptionPicker, { type PickerGroup } from "./OptionPicker";
import { owedPicks } from "./owed";
import { QuickBuildReadback } from "./QuickBuildReadback";
import { RacialCantripPicker } from "./RacialCantripPicker";
import { ClassChoices } from "./steps/ClassChoices";
import { SpellsSection } from "./steps/SpellsGearStep";
import { Field, StepPanel, inputClass } from "./steps/shared";
import {
  abilitiesBlocks,
  ancestryBlocks,
  buildBuilderResult,
  callingBlocks,
  gearBlocker,
  backgroundBlocks,
  identityBlocks,
  spellsBlocks,
  validateBuilder,
  type BlockerTarget,
  type BuilderResult,
  type StepBlock,
} from "./submit";
import { builderActions, useBuilderDerived } from "./useBuilderDerived";
import { useArchetypeOptions, useBuilderOptions } from "./useBuilderOptions";
import { findRace, useBuilderState } from "./useBuilderState";
import { useFeatDescs, useFeatTexts } from "./useFeatDescs";
import { usePickerGroups } from "./usePickerGroups";
import { useQuickFill } from "./useQuickFill";
import { useTableRules } from "./useTableRules";

// The rows a picker offers, in its order: what the fill chooses from, so it
// never picks what this builder leaves out (as CharacterBuilder.tsx does).
function offeredRows<T extends { id: string }>(rows: T[], groups: PickerGroup[]): T[] {
  const ids = [...new Set(groups.flatMap((group) => group.options.map((option) => option.id)).filter(Boolean))];
  const picked = ids.flatMap((id) => rows.filter((row) => row.id === id).slice(0, 1));
  return picked.length ? picked : rows;
}

// "Level up" on a library character (backlog F7): only what the new level
// brings, the way the table's level-up dialog asks for it (hit points, new
// features, the subclass when it is due, the improvement or feat, class
// picks, new spells), with Choose for me filling the empty picks and
// nothing else. It runs on the builder's own state, derived numbers and
// fill (useBuilderState, useBuilderDerived, useQuickFill), opened one level
// up, so the sheet it saves is the one the whole build would save, through
// the same rules check an edit goes through (PATCH /api/characters/[id]).
// Single-class only: a multiclass split levels at a table, where the class
// taking the level is chosen, and the library offers it no Level up.
export default function LevelUpSheet(props: Parameters<typeof LevelUpSheetForm>[0]) {
  return (
    <ContentScopeProvider campaignId={null}>
      <LevelUpSheetForm {...props} />
    </ContentScopeProvider>
  );
}

function LevelUpSheetForm({
  initial,
  initialLevel,
  onSubmit,
  busy,
  error,
  wholeBuildHref,
  cancelHref,
}: {
  // The stored character and the level its library row holds.
  initial: CreateSheetInput;
  initialLevel: number;
  onSubmit: (result: BuilderResult) => void;
  busy: boolean;
  error: string;
  // The full builder at the new level, for anyone who wants every step.
  wholeBuildHref: string;
  cancelHref: string;
}) {
  useEffectsRoot();
  const nextLevel = Math.min(20, initialLevel + 1);
  const { races: rawRaces, classes: rawClasses, backgrounds: rawBackgrounds, loaded } = useBuilderOptions(initial.race);
  // The library builds with no world pack: names as the rows hold them.
  const races = useMemo(() => applyIdReskins(rawRaces, []), [rawRaces]);
  const classes = useMemo(() => applyClassReskins(rawClasses, null), [rawClasses]);
  const backgrounds = useMemo(() => applyIdReskins(rawBackgrounds, []), [rawBackgrounds]);
  const initialFeatDescs = useFeatDescs([
    ...(initial.feats ?? []),
    ...(initial.asiChoices ?? []).flatMap((choice) => (choice.mode === "feat" ? [choice.feat] : [])),
  ]);
  const state = useBuilderState({ initial, initialFeatDescs, initialLevel, startLevel: nextLevel, races, classes, backgrounds, rowsLoaded: loaded });
  // With the species option the character holds, as the whole build reads it.
  const pickedRace = findRace(races, state.raceId);
  const race = useMemo(() => pickedRace && withSpeciesVariant(pickedRace, state.racialVariant), [pickedRace, state.racialVariant]);
  const klass = classes.find((entry) => entry.id === state.classId);
  const background = backgrounds.find((entry) => entry.id === state.backgroundId);
  const subclassOptions = useArchetypeOptions(klass?.id ?? "");
  const table = useTableRules(undefined, klass?.id);
  const featTexts = useFeatTexts([
    ...state.feats,
    ...state.asiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : [])),
  ]);
  const derived = useBuilderDerived({ state, race, klass, background, rules: table.rules, featDescs: featTexts.descs });
  const featJudge = builderFeatJudge({ state, derived, race, klass, background }, featTexts.prerequisites, initial.feats);
  const actions = builderActions(state, klass, race, background);
  const pickers = usePickerGroups({
    races,
    rawRaces,
    classes,
    rawClasses,
    backgrounds,
    pack: null,
    klass,
    subclass: state.subclass,
    effectiveLevel: derived.effectiveLevel,
    archetypes: subclassOptions.archetypes,
  });
  const { pool: spellPool } = useWiderSpellPool(derived.spellSearchClass, derived.maxSpellLevel, derived.casts, derived.spellWider);
  const fill = useQuickFill({
    state,
    derived,
    race,
    klass,
    background,
    offered: {
      classes: offeredRows(classes, pickers.classGroups),
      races: offeredRows(races, pickers.raceGroups),
      backgrounds: offeredRows(backgrounds, pickers.backgroundGroups),
      recommended: new Set(),
    },
    subclasses: pickers.subclassGroups.flatMap((group) => group.options.map((option) => option.id)).filter(Boolean),
    spellPool,
  });
  const rootId = useId();
  const [problem, setProblem] = useState("");

  // The stored character is read into the builder once the option rows are
  // in (its scores, skills and expertise land together): until then a pick
  // it holds would read as owed.
  const ready = Boolean(races.length && classes.length && backgrounds.length);
  const hydrated = Object.values(state.scores).every((score) => score !== null);
  if (!ready || !hydrated) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  // Every pick the build still owes, in the order the save checks them.
  const gear = gearBlocker(derived);
  const blocks: StepBlock[] = [
    ...identityBlocks(state),
    ...backgroundBlocks(state, background, derived),
    ...abilitiesBlocks(derived, state, featJudge),
    ...ancestryBlocks(state, race, background, derived, featJudge),
    ...callingBlocks(klass, state, derived),
    ...spellsBlocks(derived, klass),
    ...(gear ? [gear] : []),
  ];
  const racialFeatProblem = unmetFeatMessage(featJudge, state.feats.slice(0, race ? racialFeatCount(race.id) : 0));
  if (racialFeatProblem) {
    blocks.push({ message: racialFeatProblem, target: "racialFeat" });
  }
  const owed = owedPicks(blocks);
  const owedTargets = new Set(owed.map((pick) => pick.target));
  // The gate names a pick on this sheet first: the ones it sends to the
  // whole build are listed below it, with the way there.
  const sheetTargets = new Set<BlockerTarget>(SHEET_TARGETS);
  const firstOwed = blocks.find((entry) => sheetTargets.has(entry.target)) ?? blocks[0] ?? null;

  // What this level brings, read off the tables by level, so a section
  // stays while its pick is made (the owed list empties as it is).
  const rows = klass
    ? levelProgressionRows(builderProgressionInput(state, derived, klass, { current: initialLevel, next: nextLevel }))
    : [];
  const newRow = rows[nextLevel - 1];
  const heldRow = rows[initialLevel - 1];
  const pickLevel = klass ? subclassLevelFor(klass.id) : null;
  const sections = klass
    ? levelUpSections({
        classId: klass.id,
        subclass: state.subclass,
        storedSubclass: initial.subclass ?? "",
        heldLevel: initialLevel,
        nextLevel,
        asiSlotLevels: derived.asiSlotLevels,
        casts: derived.casts,
        heldRow,
        nextRow: newRow,
        owed: owedTargets,
      })
    : { subclass: false, asi: false, classPicks: false, spells: false };
  const showSubclass = sections.subclass;
  const showAsi = sections.asi;
  const showClassPicks = sections.classPicks;
  const showSpells = sections.spells;
  const showRacialCantrips = racialCantripsDue(initial.racialChoices, race?.cantripChoice?.count ?? 0, owedTargets);
  const { here: sheetOwed, elsewhere } = splitOwed(owed);
  const nothingToChoose = !showSubclass && !showAsi && !showClassPicks && !showSpells && !showRacialCantrips;

  // To the block that takes a pick, lit for a moment, focus on its first
  // control (as the builder's "Show me" does).
  function locate(target: BlockerTarget) {
    const found = document.querySelector<HTMLElement>(`[data-level-up-root="${rootId}"] [data-builder-target="${target}"]`);
    if (!found) {
      return;
    }
    found.scrollIntoView({ block: "start", behavior: prefersStillMotion() ? "auto" : "smooth" });
    found.removeAttribute("data-flash");
    void found.offsetWidth;
    found.setAttribute("data-flash", "");
    window.setTimeout(() => found.removeAttribute("data-flash"), 1600);
    const control =
      found.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button[aria-haspopup]') ??
      found.querySelector<HTMLElement>('button:not(.creator-help):not([aria-label^="Details"]):not([aria-label^="What is"]), [tabindex="0"]');
    control?.focus({ preventScroll: true });
  }

  function chooseForMe() {
    setProblem("");
    fill.start({ only: [...SHEET_TARGETS] });
  }

  function save() {
    if (firstOwed) {
      setProblem(firstOwed.message);
      locate(firstOwed.target);
      return;
    }
    const input = { state, derived, race, klass, background, initial, featJudge };
    const check = validateBuilder(input);
    if (check) {
      if (check.kind === "spellWarning") {
        state.setSpellWarningAck(true);
      }
      setProblem(check.message);
      if (check.target) {
        locate(check.target);
      }
      return;
    }
    setProblem("");
    onSubmit(buildBuilderResult(input));
  }

  const preview = derived.preview;
  const hpLine =
    preview && klass
      ? hitPointsLine({
          hitDie: klass.hitDie,
          level: derived.effectiveLevel,
          maxHp: preview.maxHp,
          range: preview.hpRange,
          method: preview.hpMethod,
          kept: preview.hpKept,
          atTable: false,
        })
      : null;
  const hpGain = preview && !preview.hpKept && preview.hpMethod !== "rolled" ? preview.maxHp - initial.maxHp : null;
  const who = initial.name.trim() || "Your hero";
  const shown = state.subclass ? pickers.chosenArchetype?.desc || subclassBlurb(klass?.id ?? "", state.subclass) : "";
  const saveBlocked = Boolean(firstOwed) || busy || fill.running;

  return (
    <div data-level-up-root={rootId} data-level-up-sheet="" className="space-y-4 text-sm">
      <FeatJudgeContext.Provider value={featJudge}>
        {fill.readback ? (
          <QuickBuildReadback
            readback={fill.readback}
            stillOwed={sheetOwed.length}
            onChange={(target) => locate(target)}
            onUndo={fill.undo}
            onDismiss={fill.dismiss}
          />
        ) : null}

        <StepPanel title={`What level ${nextLevel} brings`} ornate className="border-amber-500/30">
          <div className="space-y-3">
            <div data-level-up-hp="" className="flex items-start gap-2">
              <HeartPulse aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rose-300" />
              <p className="min-w-0 flex-1 text-stone-200">
                <span className="font-medium">Hit points: </span>
                {hpLine ? (
                  <>
                    {hpGain !== null ? (
                      <>
                        <span className="font-mono text-amber-100">
                          {initial.maxHp} to {preview?.maxHp}
                        </span>{" "}
                        ({hpGain >= 0 ? "+" : ""}
                        {hpGain})
                      </>
                    ) : (
                      <span className="font-mono text-amber-100">{hpLine.value}</span>
                    )}
                    <span className="mt-0.5 block text-xs text-stone-500">{hpLine.reason}</span>
                  </>
                ) : (
                  "worked out once the build is read."
                )}
              </p>
            </div>
            <div data-level-up-features="" className="flex items-start gap-2">
              <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-200" />
              <div className="min-w-0 flex-1 text-stone-200">
                <span className="font-medium">New features: </span>
                {newRow?.features.length ? newRow.features.join(", ") : "none at this level."}
                {newRow && newRow.proficiency > (heldRow?.proficiency ?? newRow.proficiency) ? (
                  <span className="mt-0.5 block text-xs text-stone-400">
                    Proficiency bonus rises to +{newRow.proficiency}.
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-stone-400" data-level-up-owed={sheetOwed.length}>
            {nothingToChoose
              ? `Nothing to choose at level ${nextLevel}. Save takes the level.`
              : sheetOwed.length
                ? `${sheetOwed.length === 1 ? "One choice is" : `${sheetOwed.length} choices are`} still to make below. Choose for me fills only the empty ones.`
                : "Every choice for this level is made."}
          </p>
          {sheetOwed.length ? (
            <button
              type="button"
              onClick={chooseForMe}
              disabled={fill.running}
              data-level-up-fill=""
              className={cn(ui.btnSecondary, "mt-2")}
            >
              <Wand2 aria-hidden="true" className="size-4" /> {fill.running ? "Choosing..." : "Choose for me"}
            </button>
          ) : null}
        </StepPanel>

        {showSubclass && klass ? (
          <StepPanel title="Subclass" anchor="subclass">
            <Field label="Subclass">
              <OptionPicker
                value={state.subclass}
                groups={pickers.subclassGroups}
                placeholder="None yet"
                className={inputClass}
                onChange={state.changeSubclass}
              />
              <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
                {state.subclass ? (
                  <>
                    <span className="grow">{firstSentence(shown) ?? "A specialization within your class."}</span>
                    <InfoButton
                      label={state.subclass}
                      text={shown || undefined}
                      reference={pickers.chosenArchetype ? { kind: "archetypes", slug: pickers.chosenArchetype.id } : undefined}
                    />
                  </>
                ) : (
                  <span className="grow">
                    <span className="text-amber-300">Still to choose. </span>A {klass.name.toLowerCase()} chooses a{" "}
                    <GameTerm id="subclass">subclass</GameTerm> at level {pickLevel}. It decides much of how they play from here.
                  </span>
                )}
              </span>
              {derived.subclassTraining.map((grant) => (
                <FeatChoicesFields
                  key={grant.name}
                  feat={grant.name}
                  spec={grant.spec}
                  picks={featChoice(state.featChoices, grant.name)}
                  known={knownTraining(derived)}
                  onChange={(picks) => state.setFeatPicks(grant.name, picks)}
                  source="subclass"
                />
              ))}
            </Field>
          </StepPanel>
        ) : null}

        {showAsi ? (
          <div data-builder-target="asi">
            <AsiFeatEditor
              level={derived.effectiveLevel}
              slotLevels={derived.asiSlotLevels}
              baseScores={derived.asiBaseAbilities}
              choices={derived.activeAsiChoices}
              takenInPlay={derived.asiTakenInPlay}
              featSpecOf={derived.featSpecOf}
              featDescOf={derived.featDescOf}
              featChoices={state.featChoices}
              onFeatPicks={state.setFeatPicks}
              known={knownTraining(derived)}
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
          </div>
        ) : null}

        {showClassPicks ? <ClassChoices state={state} derived={derived} actions={actions} klass={klass} /> : null}

        {showSpells && klass ? <SpellsSection state={state} derived={derived} klass={klass} pack={null} /> : null}

        {showRacialCantrips && race ? (
          <StepPanel title={`${race.name} choices`}>
            <RacialCantripPicker race={race} cantrips={state.racialCantrips} onChange={state.setRacialCantrips} />
          </StepPanel>
        ) : null}

        {elsewhere.length ? (
          <section
            data-level-up-elsewhere=""
            className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100"
          >
            <h2 className="font-medium">Also still to choose, in the whole build</h2>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {elsewhere.map((pick) => (
                <li key={pick.target}>{pick.message}</li>
              ))}
            </ul>
            <Link href={wholeBuildHref} className="mt-1 inline-flex min-h-10 items-center text-amber-300 underline underline-offset-2">
              Edit the whole build to choose {elsewhere.length === 1 ? "it" : "them"}
            </Link>
          </section>
        ) : null}

        {rows.length ? <LevelProgressionTable rows={rows} who={initial.name.trim() || "your hero"} /> : null}

        {problem || error ? (
          <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-100">
            {problem || error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-amber-500/15 pt-3">
          <button
            type="button"
            onClick={save}
            aria-disabled={saveBlocked ? "true" : undefined}
            aria-describedby={firstOwed ? `${rootId}-blocker` : undefined}
            data-level-up-save=""
            className={cn(ui.btnPrimary, "min-w-0 flex-1 sm:flex-none", saveBlocked && "opacity-60")}
          >
            {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null} Take level {nextLevel}
          </button>
          <Link href={wholeBuildHref} data-level-up-whole="" className={cn(ui.btnSecondary, "min-w-0 flex-1 sm:flex-none")}>
            Edit the whole build
          </Link>
          <Link href={cancelHref} className="inline-flex min-h-10 items-center px-2 text-xs text-stone-400 hover:text-amber-200">
            Not now
          </Link>
          {firstOwed ? (
            <p id={`${rootId}-blocker`} className="basis-full text-xs text-stone-400">
              {who} takes the level once this is chosen: {firstOwed.message}
            </p>
          ) : null}
        </div>
      </FeatJudgeContext.Provider>
    </div>
  );
}
