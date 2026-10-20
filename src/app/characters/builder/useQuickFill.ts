"use client";

import { useEffect, useState } from "react";
import { FILL_ROUNDS, fillRound, undoFill, type BuildSeed, type FilledPick, type QuizAnswers } from "./quickBuild";
import type { BlockerTarget } from "./submit";
import type { BuilderDerived } from "./useBuilderDerived";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderDraftFields, BuilderState } from "./useBuilderState";

// A quick-build fill in the wizard (quickBuild.ts): the rounds run one per
// render, each reading what useBuilderDerived made of the last, until a
// round fills nothing. What it wrote is read back once, with one Undo. "Keep
// them" closes the panel, and "Show what was picked" opens it again until
// the character is saved (the builder unmounts) or another fill starts.

export type FillRequest = {
  // Only these slots ("Pick for me" on one card).
  only?: BlockerTarget[];
  // The quiz's answers and the character chosen from its two.
  answers?: QuizAnswers;
  seed?: BuildSeed;
};

export type FillReadback = {
  filled: FilledPick[];
  snapshot: BuilderDraftFields;
  // The builder as the fill left it, so a later Undo can tell a pick still
  // as filled from one the player has changed since (undoFill).
  after: BuilderDraftFields;
  // Where it started: a quiz character, the whole of what was left, or one
  // card.
  from: "quiz" | "fill" | "card";
};

type Run = FillRequest & { snapshot: BuilderDraftFields; filled: FilledPick[]; round: number };

export function useQuickFill({
  state,
  derived,
  race,
  klass,
  background,
  offered,
  subclasses,
  spellPool,
  onDone,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  offered: Parameters<typeof fillRound>[0]["offered"];
  subclasses: string[];
  spellPool: ReadonlyArray<{ name: string; level: number }>;
  // Called once a fill has finished, with what it read back.
  onDone?: (readback: FillReadback) => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [readback, setReadback] = useState<FillReadback | null>(null);
  // Whether the panel shows: "Keep them" closes it and keeps it to reopen.
  const [shown, setShown] = useState(true);

  function start(request: FillRequest = {}) {
    setReadback(null);
    setShown(true);
    setRun({ ...request, snapshot: state.draftFields, filled: [], round: 0 });
  }

  // One round per render. The state lands in a .then callback rather than
  // in the effect's body, as the builder's draft read does: the round is
  // work on what this render derived, and its result is the next render's.
  const fields = state.draftFields;
  useEffect(() => {
    if (!run) {
      return;
    }
    void Promise.resolve().then(() => {
      if (run.round === 0 && run.seed) {
        const seed = run.seed;
        const named = (list: ReadonlyArray<{ id: string; name: string }>, id: string) => list.find((entry) => entry.id === id)?.name ?? id;
        state.applyFill({ classId: seed.classId, raceId: seed.raceId, backgroundId: seed.backgroundId });
        setRun({
          ...run,
          round: 1,
          filled: [
            { target: "class", label: "Class", value: named(offered.classes, seed.classId) },
            { target: "race", label: "Race", value: named(offered.races, seed.raceId) },
            { target: "background", label: "Background", value: named(offered.backgrounds, seed.backgroundId) },
          ],
        });
        return;
      }
      const step =
        run.round < FILL_ROUNDS + 1
          ? fillRound({
              fields,
              derived,
              race,
              klass,
              background,
              offered,
              subclasses,
              spellPool,
              answers: run.answers,
              only: run.only,
            })
          : null;
      if (!step || !step.filled.length) {
        const done: FillReadback = {
          filled: run.filled,
          snapshot: run.snapshot,
          after: fields,
          from: run.seed ? "quiz" : run.only ? "card" : "fill",
        };
        setRun(null);
        setReadback(done.filled.length ? done : null);
        onDone?.(done);
        return;
      }
      state.applyFill(step.patch);
      setRun({ ...run, round: run.round + 1, filled: [...run.filled, ...step.filled] });
    });
    // One round for each render the last round caused: the run's own change
    // is what moves it on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  function undo() {
    if (!readback) {
      return;
    }
    state.restoreDraft(undoFill(readback.snapshot, readback.after, state.draftFields));
    setReadback(null);
  }

  return {
    start,
    running: Boolean(run),
    // The panel, while it shows; the fill it would reopen, while it does not.
    readback: shown ? readback : null,
    kept: shown ? null : readback,
    undo,
    dismiss: () => setShown(false),
    reopen: () => setShown(true),
  };
}
