"use client";

import { Dices } from "lucide-react";
import { cn } from "@/lib/cn";
import { abilityMod, formatModifier } from "@/lib/srd";
import {
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  pointBuyRemaining,
} from "@/lib/srd/point-buy";
import type { Ability } from "@/lib/schemas/sheet";

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export type AbilityMethod = "standard" | "pointbuy" | "roll";

export const ABILITY_LABELS: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const ABILITY_KEYS = Object.keys(ABILITY_LABELS) as Ability[];

export type AbilityState = Record<Ability, number | null>;

export function rollFourDropLowest() {
  const dice = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6));
  dice.sort((a, b) => b - a);
  return dice[0] + dice[1] + dice[2];
}

// Method-aware ability score editor: standard array assignment, 27-point
// buy, or 4d6-drop-lowest rolls. Racial bonuses are displayed but applied
// by the parent.
export default function AbilityEditor({
  method,
  onMethodChange,
  scores,
  onScoresChange,
  racialBonus,
  asiCount = 0,
}: {
  method: AbilityMethod;
  onMethodChange: (method: AbilityMethod) => void;
  scores: AbilityState;
  onScoresChange: (scores: AbilityState) => void;
  racialBonus: Partial<Record<Ability, number>>;
  // Ability score improvements the chosen level has earned; > 0 adds a hint
  // that base scores are level-1 rules and the bonuses are picked below.
  asiCount?: number;
}) {
  const inputClass =
    "w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300";
  const usedValues = ABILITY_KEYS.map((key) => scores[key]).filter(
    (value): value is number => value !== null,
  );
  const pointBuyScores = ABILITY_KEYS.map((key) => scores[key] ?? POINT_BUY_MIN);
  const remaining = method === "pointbuy" ? pointBuyRemaining(pointBuyScores) : 0;

  function setScore(ability: Ability, value: number | null) {
    const next = { ...scores };
    if (method === "standard" && value !== null) {
      for (const key of ABILITY_KEYS) {
        if (next[key] === value) {
          next[key] = null;
        }
      }
    }
    next[ability] = value;
    onScoresChange(next);
  }

  function switchMethod(next: AbilityMethod) {
    onMethodChange(next);
    onScoresChange(
      next === "pointbuy"
        ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }
        : { str: null, dex: null, con: null, int: null, wis: null, cha: null },
    );
  }

  function rollAll() {
    const next = { ...scores };
    for (const key of ABILITY_KEYS) {
      next[key] = rollFourDropLowest();
    }
    onScoresChange(next);
  }

  return (
    <section className="panel rounded-xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="eyebrow text-xs text-amber-200/90">Ability scores</h2>
        <div className="flex rounded-md border border-stone-700 p-0.5 text-xs">
          {(
            [
              ["standard", "Standard array"],
              ["pointbuy", "Point buy"],
              ["roll", "Roll 4d6"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => switchMethod(value)}
              className={cn(
                "rounded px-2.5 py-1",
                method === value
                  ? "bg-amber-900/60 text-amber-200"
                  : "text-stone-400 hover:text-stone-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {method === "pointbuy" ? (
          <span
            className={cn(
              "text-xs",
              remaining < 0 ? "text-red-400" : "text-stone-400",
            )}
          >
            {remaining} points left
          </span>
        ) : null}
        {method === "roll" ? (
          <button
            type="button"
            onClick={rollAll}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2.5 py-1 text-xs text-stone-300 hover:bg-stone-900"
          >
            <Dices className="size-3.5" /> Roll all
          </button>
        ) : null}
      </div>
      {asiCount > 0 ? (
        <p className="mb-3 text-xs text-stone-500">
          These are your base scores, the same at every level. Your level has earned{" "}
          <span className="text-amber-200">
            {asiCount} ability score {asiCount === 1 ? "improvement" : "improvements"}
          </span>{" "}
          on top of them; pick those in the section below.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ABILITY_KEYS.map((ability) => {
          const bonus = racialBonus[ability] ?? 0;
          const assigned = scores[ability];
          const finalScore = assigned !== null ? assigned + bonus : null;
          return (
            <label
              key={ability}
              className="block rounded-lg border border-stone-800 bg-stone-950/60 p-3"
            >
              <span className="mb-1 flex items-baseline justify-between">
                <span className="text-stone-300">{ABILITY_LABELS[ability]}</span>
                {bonus ? <span className="text-xs text-amber-200">+{bonus} racial</span> : null}
              </span>
              {method === "standard" ? (
                <select
                  value={assigned ?? ""}
                  onChange={(event) =>
                    setScore(ability, event.target.value ? Number(event.target.value) : null)
                  }
                  className={inputClass}
                >
                  <option value="">--</option>
                  {STANDARD_ARRAY.map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={usedValues.includes(value) && scores[ability] !== value}
                    >
                      {value}
                    </option>
                  ))}
                </select>
              ) : method === "pointbuy" ? (
                <select
                  value={assigned ?? POINT_BUY_MIN}
                  onChange={(event) => setScore(ability, Number(event.target.value))}
                  className={inputClass}
                >
                  {Array.from(
                    { length: POINT_BUY_MAX - POINT_BUY_MIN + 1 },
                    (_, index) => POINT_BUY_MIN + index,
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={3}
                  max={18}
                  value={assigned ?? ""}
                  onChange={(event) =>
                    setScore(ability, event.target.value ? Number(event.target.value) : null)
                  }
                  className={inputClass}
                />
              )}
              {finalScore !== null ? (
                <span className="mt-1 block text-xs text-stone-400">
                  Final {finalScore} ({formatModifier(abilityMod(finalScore))})
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}
