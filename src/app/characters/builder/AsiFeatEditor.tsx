"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { abilityMod, formatModifier } from "@/lib/srd";
import { ABILITY_SCORE_CAP, applyAsiChoices } from "@/lib/srd/asi";
import type { Ability, AbilityScores, AsiChoice } from "@/lib/schemas/sheet";
import { ABILITY_LABELS } from "./AbilityEditor";
import ContentPicker from "./ContentPicker";

const ABILITY_KEYS = Object.keys(ABILITY_LABELS) as Ability[];

const MODES = [
  ["plus2", "+2 one ability"],
  ["plus1x2", "+1 two abilities"],
  ["feat", "Feat"],
] as const;

// One card per earned Ability Score Improvement (levels 4/8/12/16/19).
// Choices apply in order, so each card's selects reflect the scores after
// every earlier card; abilities already at the 20 cap are disabled.
export default function AsiFeatEditor({
  slotLevels,
  baseScores,
  choices,
  onChange,
}: {
  slotLevels: number[];
  baseScores: AbilityScores | null;
  choices: Array<AsiChoice | null>;
  onChange: (choices: Array<AsiChoice | null>) => void;
}) {
  const inputClass =
    "w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300";

  function setChoice(index: number, choice: AsiChoice | null) {
    const next = slotLevels.map((_, slot) => choices[slot] ?? null);
    next[index] = choice;
    onChange(next);
  }

  return (
    <section className="panel rounded-xl p-4">
      <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Ability score improvements</h2>
      <p className="mb-3 text-xs text-stone-500">
        Each of these levels grants +2 to one ability, +1 to two abilities, or a feat.
        Scores cap at {ABILITY_SCORE_CAP}.
      </p>
      {!baseScores ? (
        <p className="rounded-md border border-stone-800 bg-stone-900/60 p-3 text-xs text-stone-400">
          Assign all six ability scores first.
        </p>
      ) : (
        <div className="space-y-3">
          {slotLevels.map((slotLevel, index) => {
            const choice = choices[index] ?? null;
            // Scores as they stand entering this slot: base plus all
            // earlier choices.
            const current = applyAsiChoices(baseScores, choices.slice(0, index));
            return (
              <div
                key={slotLevel}
                className="rounded-lg border border-stone-800 bg-stone-950/60 p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-stone-300">Level {slotLevel} improvement</span>
                  <div className="flex rounded-md border border-stone-700 p-0.5 text-xs">
                    {MODES.map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          if (mode === "feat") {
                            // Clears back to the feat search; picking a feat resolves it.
                            setChoice(index, null);
                          } else if (mode === "plus2") {
                            setChoice(index, { mode: "plus2", ability: firstOpenAbility(current) });
                          } else {
                            const first = firstOpenAbility(current);
                            const second = firstOpenAbility(current, first);
                            setChoice(index, { mode: "plus1x2", abilities: [first, second] });
                          }
                        }}
                        className={cn(
                          "rounded px-2.5 py-1",
                          choice?.mode === mode
                            ? "bg-amber-900/60 text-amber-200"
                            : "text-stone-400 hover:text-stone-200",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {choice?.mode === "plus2" ? (
                  <label className="block sm:w-64">
                    <span className="mb-1 block text-xs text-stone-500">+2 to</span>
                    <select
                      value={choice.ability}
                      onChange={(event) =>
                        setChoice(index, { mode: "plus2", ability: event.target.value as Ability })
                      }
                      className={inputClass}
                    >
                      {ABILITY_KEYS.map((ability) => (
                        <option
                          key={ability}
                          value={ability}
                          disabled={current[ability] >= ABILITY_SCORE_CAP && ability !== choice.ability}
                        >
                          {ABILITY_LABELS[ability]} ({current[ability]}
                          {current[ability] >= ABILITY_SCORE_CAP ? ", at cap" : ""})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {choice?.mode === "plus1x2" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([0, 1] as const).map((half) => (
                      <label key={half} className="block">
                        <span className="mb-1 block text-xs text-stone-500">
                          {half === 0 ? "First +1" : "Second +1"}
                        </span>
                        <select
                          value={choice.abilities[half]}
                          onChange={(event) => {
                            const abilities = [...choice.abilities] as [Ability, Ability];
                            abilities[half] = event.target.value as Ability;
                            setChoice(index, { mode: "plus1x2", abilities });
                          }}
                          className={inputClass}
                        >
                          {ABILITY_KEYS.map((ability) => (
                            <option
                              key={ability}
                              value={ability}
                              disabled={
                                (current[ability] >= ABILITY_SCORE_CAP &&
                                  ability !== choice.abilities[half]) ||
                                ability === choice.abilities[half === 0 ? 1 : 0]
                              }
                            >
                              {ABILITY_LABELS[ability]} ({current[ability]}
                              {current[ability] >= ABILITY_SCORE_CAP ? ", at cap" : ""})
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : null}

                {choice === null || choice.mode === "feat" ? (
                  <div>
                    {choice?.mode === "feat" ? (
                      <span className="mb-2 inline-flex items-center gap-1 rounded-full border border-amber-800 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200">
                        {choice.feat}
                        <button
                          type="button"
                          onClick={() => setChoice(index, null)}
                          className="text-stone-500 hover:text-red-400"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ) : (
                      <ContentPicker
                        kind="feats"
                        placeholder="Search feats (e.g. alert, tough)"
                        onPick={(entry) => setChoice(index, { mode: "feat", feat: entry.name })}
                      />
                    )}
                  </div>
                ) : null}

                {choice ? (
                  <p className="mt-2 text-xs text-stone-500">
                    {choice.mode === "feat"
                      ? `Feat: ${choice.feat}`
                      : summarizeChoice(current, choice)}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-stone-500">
                    Pick +2, two +1s, or search a feat above.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function firstOpenAbility(scores: AbilityScores, skip?: Ability): Ability {
  const open = ABILITY_KEYS.find(
    (ability) => ability !== skip && scores[ability] < ABILITY_SCORE_CAP,
  );
  return open ?? ABILITY_KEYS.find((ability) => ability !== skip) ?? "str";
}

function summarizeChoice(current: AbilityScores, choice: AsiChoice): string {
  const after = applyAsiChoices(current, [choice]);
  const touched =
    choice.mode === "plus2" ? [choice.ability] : choice.mode === "plus1x2" ? choice.abilities : [];
  return touched
    .map(
      (ability) =>
        `${ABILITY_LABELS[ability]} ${current[ability]} to ${after[ability]} (${formatModifier(abilityMod(after[ability]))})`,
    )
    .join(", ");
}
