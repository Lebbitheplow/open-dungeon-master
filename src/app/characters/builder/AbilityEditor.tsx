"use client";

import { Dices } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { OptionalStepper } from "@/app/workshop/kit";
import { GameTerm } from "@/components/ui/GameTerm";
import { cn } from "@/lib/cn";
import { abilityMod, formatModifier } from "@/lib/srd";
import { POINT_BUY_MAX, POINT_BUY_MIN, pointBuyCost, pointBuyRemaining } from "@/lib/srd/point-buy";
import type { Ability } from "@/lib/schemas/sheet";
import { ui } from "@/lib/ui";
import {
  ROW_SETTLE_MS,
  ROW_STAGGER_MS,
  TOTAL_POP_MS,
  assignStandard,
  restOffsets,
  rollFourDice,
  rollTier,
  type AbilityRoll,
} from "./abilityDice";
import { HelpDot, MethodInfoDialog, type HpExplainerInput } from "./AbilityExplainers";
import { AbilitySummary } from "./AbilitySummary";
import { DiceDefs, DiceRow } from "./Dice";

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

// What each way of getting six numbers actually costs you, for the player who
// has never been asked this question before.
const METHODS: Array<{ id: AbilityMethod; label: string; info: string }> = [
  {
    id: "standard",
    label: "Standard array",
    info: `Everyone starts with the same six numbers: ${STANDARD_ARRAY.join(
      ", ",
    )}. You decide which ability gets which. Nothing is left to luck, and no character is accidentally weaker than the rest of the party. This is the safe choice if you are new.`,
  },
  {
    id: "pointbuy",
    label: "Point buy",
    info:
      "You spend 27 points raising each score from 8. The higher a score climbs the more each step costs, so a character with one towering ability pays for it with weak ones. Fair like the standard array, but you choose the shape.",
  },
  {
    id: "roll",
    label: "Roll 4d6",
    info:
      "Roll four six-sided dice for each ability and drop the lowest. It can hand you a hero far above the standard array, or well below it. Some tables love the swing; ask yours before choosing it.",
  },
];

export type AbilityState = Record<Ability, number | null>;

export function rollFourDropLowest() {
  return rollFourDice().total;
}

type RowRoll = AbilityRoll & { id: number; delay: number };

// Method-aware ability score editor: standard array slots, 27-point buy
// steppers, or 4d6-drop-lowest on the dice grid with a number field beside
// each total so a score rolled at a real table can still be typed in. Racial
// bonuses are displayed but applied by the parent.
export default function AbilityEditor({
  method,
  onMethodChange,
  scores,
  onScoresChange,
  racialBonus,
  asiCount = 0,
  who = "",
  hp = null,
}: {
  method: AbilityMethod;
  onMethodChange: (method: AbilityMethod) => void;
  scores: AbilityState;
  onScoresChange: (scores: AbilityState) => void;
  racialBonus: Partial<Record<Ability, number>>;
  // Ability score improvements the chosen level has earned; > 0 adds a hint
  // that base scores are level-1 rules and the bonuses are picked below.
  asiCount?: number;
  // "half-orc paladin", for the summary's sentence.
  who?: string;
  // What the health explainer under the summary works from.
  hp?: HpExplainerInput | null;
}) {
  // The dice on the table. Display only: the score itself is committed to the
  // builder the moment the dice leave the hand, so nothing is lost if the
  // player moves on mid-toss.
  const [rolls, setRolls] = useState<Partial<Record<Ability, RowRoll>>>({});
  const [methodInfoOpen, setMethodInfoOpen] = useState(false);
  const timers = useRef<Partial<Record<Ability, number>>>({});
  const rollSeq = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of Object.values(pending)) window.clearTimeout(id);
    };
  }, []);

  const pointBuyScores = ABILITY_KEYS.map((key) => scores[key] ?? POINT_BUY_MIN);
  const remaining = method === "pointbuy" ? pointBuyRemaining(pointBuyScores) : 0;
  const anyRolling = ABILITY_KEYS.some((key) => rolls[key]?.phase === "rolling");
  const rolledCount = ABILITY_KEYS.filter((key) => scores[key] !== null).length;
  const complete = ABILITY_KEYS.every((key) => scores[key] !== null);

  function clearRoll(abilities: Ability[]) {
    for (const ability of abilities) {
      window.clearTimeout(timers.current[ability]);
      delete timers.current[ability];
    }
    setRolls((current) => {
      const next = { ...current };
      for (const ability of abilities) delete next[ability];
      return next;
    });
  }

  function switchMethod(next: AbilityMethod) {
    clearRoll(ABILITY_KEYS);
    onMethodChange(next);
    onScoresChange(
      next === "pointbuy"
        ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }
        : { str: null, dex: null, con: null, int: null, wis: null, cha: null },
    );
  }

  function roll(abilities: Ability[]) {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextScores = { ...scores };
    const thrown: Partial<Record<Ability, RowRoll>> = {};
    abilities.forEach((ability, index) => {
      const four = rollFourDice();
      const delay = still ? 0 : index * ROW_STAGGER_MS;
      rollSeq.current += 1;
      nextScores[ability] = four.total;
      thrown[ability] = {
        ...four,
        rest: restOffsets(),
        phase: still ? "settled" : "rolling",
        id: rollSeq.current,
        delay,
      };
      window.clearTimeout(timers.current[ability]);
      if (!still) {
        timers.current[ability] = window.setTimeout(() => {
          setRolls((current) => {
            const landed = current[ability];
            return landed ? { ...current, [ability]: { ...landed, phase: "settled" } } : current;
          });
        }, ROW_SETTLE_MS + delay);
      }
    });
    setRolls((current) => ({ ...current, ...thrown }));
    onScoresChange(nextScores);
  }

  function typeScore(ability: Ability, value: number | null) {
    // A typed number replaces the dice: they would otherwise show a roll
    // that no longer adds up to the score beside them.
    clearRoll([ability]);
    onScoresChange({ ...scores, [ability]: value });
  }

  function nudgeBuy(ability: Ability, delta: number) {
    const value = Math.max(POINT_BUY_MIN, Math.min(POINT_BUY_MAX, (scores[ability] ?? POINT_BUY_MIN) + delta));
    onScoresChange({ ...scores, [ability]: value });
  }

  return (
    <section className="panel rounded-xl p-3 sm:p-4">
      <DiceDefs />
      <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <h2 className="eyebrow w-full text-xs text-amber-200/90 sm:w-auto">
          <GameTerm id="ability_score">Ability scores</GameTerm>
        </h2>
        <div className="method-switch">
          {METHODS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => (entry.id === method ? undefined : switchMethod(entry.id))}
              aria-pressed={method === entry.id}
              className="method-option"
            >
              <span>{entry.label}</span>
            </button>
          ))}
          {/* Which of the three to use is the question a first character
              actually gets stuck on, so the answer sits on the control. */}
          <HelpDot
            label={`About ${METHODS.find((entry) => entry.id === method)?.label ?? "the three ways"}`}
            onClick={() => setMethodInfoOpen(true)}
            className="-my-px size-[30px]"
          />
        </div>
        {method === "pointbuy" ? (
          <span className={cn("font-mono text-[11px]", remaining < 0 ? "text-red-400" : "text-stone-400")} aria-live="polite">
            {remaining} points left
          </span>
        ) : null}
        {method === "roll" ? (
          <>
            <span className="inline-flex items-center gap-2">
              <span className="eyebrow text-[10px] tracking-[0.18em] text-amber-500/80">4d6 drop lowest</span>
              <span className="font-mono text-[10.5px] text-stone-500" aria-live="polite">
                {rolledCount} / 6 set
              </span>
            </span>
            <button
              type="button"
              onClick={() => roll(ABILITY_KEYS)}
              disabled={anyRolling}
              className={cn(ui.btnSmall, "ml-auto px-2.5 py-1 text-xs")}
            >
              <Dices className="size-3.5" /> {rolledCount ? "Reroll all" : "Roll all"}
            </button>
          </>
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

      <div className="flex flex-col gap-1.5">
        {ABILITY_KEYS.map((ability) => {
          const bonus = racialBonus[ability] ?? 0;
          const assigned = scores[ability];
          const thrown = method === "roll" ? (rolls[ability] ?? null) : null;
          const rolling = thrown?.phase === "rolling";
          // Held back while the dice are in the air, so the answer lands
          // with them instead of ahead of them.
          const finalScore = assigned !== null && !rolling ? assigned + bonus : null;
          const label = ABILITY_LABELS[ability];
          return (
            <div
              key={ability}
              className="dice-row"
              data-phase={thrown?.phase}
              style={{ "--delay": `${thrown?.delay ?? 0}ms`, "--pop": `${TOTAL_POP_MS}ms` } as CSSProperties}
            >
              <span className="dice-abbr" aria-hidden="true">
                {ability.toUpperCase()}
              </span>
              {/* The racial bonus and the final score ride under the name, so
                  the dice, the total, the typed field and the Roll button
                  all fit one line in the builder's column. */}
              <span className="flex min-w-0 flex-[1_1_104px] flex-col gap-px">
                <span className="truncate font-display text-[13.5px] font-semibold text-stone-100">
                  <GameTerm id={ability}>{label}</GameTerm>
                </span>
                {bonus || finalScore !== null ? (
                  <span className="truncate font-mono text-[10px] text-stone-400">
                    {bonus ? <span className="text-amber-300">+{bonus} racial</span> : null}
                    {bonus && finalScore !== null ? " · " : null}
                    {finalScore !== null ? `Final ${finalScore} (${formatModifier(abilityMod(finalScore))})` : null}
                  </span>
                ) : null}
              </span>

              {method === "roll" ? (
                <>
                  <DiceRow key={thrown?.id ?? "idle"} roll={thrown} />
                  <span className="flex w-[52px] flex-none items-center justify-center">
                    {thrown ? (
                      <span
                        key={thrown.id}
                        className={cn("dice-total", `roll-tier-${rollTier(thrown.total)}`)}
                        data-phase={thrown.phase}
                      >
                        {thrown.total}
                      </span>
                    ) : (
                      <span className="h-0.5 w-3 rounded-full bg-stone-700" aria-hidden="true" />
                    )}
                  </span>
                  <span className="flex-none" title="3 to 18">
                    <OptionalStepper
                      min={3}
                      max={18}
                      fallback={3}
                      // Blank while the dice are in the air, or the field would
                      // give the total away before they land.
                      value={rolling ? undefined : assigned}
                      onChange={(next) => typeScore(ability, next === "" ? null : next)}
                      label={`${label} score, typed`}
                      size="sm"
                      // Two digits at most: the narrower figure pays for the
                      // clear cross, so the Roll button stays on this line.
                      className="[&_.kit-stepper-figure]:w-8!"
                    />
                  </span>
                </>
              ) : null}

              {method === "standard" ? (
                <span className="flex min-w-[192px] flex-[1_1_192px] items-center gap-[5px]" role="group" aria-label={`${label} score`}>
                  {STANDARD_ARRAY.map((value) => {
                    const mine = assigned === value;
                    const taken = !mine && ABILITY_KEYS.some((key) => scores[key] === value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => onScoresChange(assignStandard(scores, ability, value))}
                        aria-pressed={mine}
                        aria-label={`${label} ${value}${taken ? ", held by another ability" : ""}`}
                        data-taken={taken || undefined}
                        className="slot-button"
                      >
                        {value}
                      </button>
                    );
                  })}
                </span>
              ) : null}

              {method === "pointbuy" ? (
                <span className="flex min-w-[150px] flex-[1_1_192px] items-center gap-[7px]">
                  <button
                    type="button"
                    onClick={() => nudgeBuy(ability, -1)}
                    disabled={(assigned ?? POINT_BUY_MIN) <= POINT_BUY_MIN}
                    aria-label={`Lower ${label}`}
                    className="step-button"
                  >
                    −
                  </button>
                  <span className="flex flex-1 flex-col items-center leading-none" aria-live="polite">
                    <span className="font-display text-[19px] font-bold text-amber-100">{assigned ?? POINT_BUY_MIN}</span>
                    <span className="mt-0.5 font-mono text-[9px] text-stone-500">
                      costs {pointBuyCost(assigned ?? POINT_BUY_MIN)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => nudgeBuy(ability, 1)}
                    disabled={(assigned ?? POINT_BUY_MIN) >= POINT_BUY_MAX}
                    aria-label={`Raise ${label}`}
                    className="step-button"
                  >
                    +
                  </button>
                </span>
              ) : null}

              {method === "roll" ? (
                <button
                  type="button"
                  onClick={() => roll([ability])}
                  disabled={Boolean(thrown)}
                  className={cn(
                    "motion-press h-8 w-[86px] flex-none rounded-lg border font-display text-[9.5px] font-semibold uppercase tracking-[0.14em]",
                    thrown
                      ? "border-stone-700/60 bg-stone-950/50 text-stone-600"
                      : "border-amber-500/50 bg-amber-500/10 text-amber-200 hover:shadow-glow-gold",
                  )}
                >
                  {rolling ? "Rolling" : thrown ? "Rolled" : "Roll"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {complete && !anyRolling ? (
        <AbilitySummary
          key={method}
          method={method}
          who={who}
          hp={hp}
          rows={ABILITY_KEYS.map((ability) => ({
            ability,
            label: ABILITY_LABELS[ability],
            base: scores[ability] ?? 0,
            bonus: racialBonus[ability] ?? 0,
          }))}
        />
      ) : null}

      <MethodInfoDialog open={methodInfoOpen} onOpenChange={setMethodInfoOpen} methods={METHODS} current={method} />
    </section>
  );
}
