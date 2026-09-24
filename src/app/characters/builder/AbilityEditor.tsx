"use client";

import { Dices } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { GameTerm } from "@/components/ui/GameTerm";
import { cn } from "@/lib/cn";
import { abilityMod, formatModifier } from "@/lib/srd";
import { POINT_BUY_MAX, POINT_BUY_MIN, pointBuyCost, pointBuyRemaining } from "@/lib/srd/point-buy";
import type { Ability } from "@/lib/schemas/sheet";
import { ui } from "@/lib/ui";
import {
  REROLL_BELOW,
  ROW_SETTLE_MS,
  ROW_STAGGER_MS,
  TOTAL_POP_MS,
  assignStandard,
  canRerollPool,
  placeFromPool,
  poolSum,
  rollPool,
  rollTier,
  scoresFromSlots,
  type PoolEntry,
  type PoolSlots,
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
      `Roll four six-sided dice six times, dropping the lowest each time, then place the six totals on the abilities you choose. It can hand you a hero far above the standard array, or well below it. The six are yours to keep: you may throw again only if they add up to less than ${REROLL_BELOW}. Some tables love the swing; ask yours before choosing it.`,
  },
];

export type AbilityState = Record<Ability, number | null>;

const EMPTY_SLOTS: PoolSlots<Ability> = { str: null, dex: null, con: null, int: null, wis: null, cha: null };

const DRAG_TYPE = "application/x-odm-pool";

// Method-aware ability score editor: standard array slots, 27-point buy
// steppers, or 4d6-drop-lowest, where all six throws land in a tray at once
// and are then placed on the abilities by tap or drag. There is no rolling a
// single ability and no typing a score in. Racial bonuses are displayed but
// applied by the parent.
export default function AbilityEditor({
  method,
  onMethodChange,
  scores,
  onScoresChange,
  pool,
  onPoolChange,
  slots,
  onSlotsChange,
  racialBonus,
  asiCount = 0,
  who = "",
  hp = null,
}: {
  method: AbilityMethod;
  onMethodChange: (method: AbilityMethod) => void;
  scores: AbilityState;
  onScoresChange: (scores: AbilityState) => void;
  // The six 4d6 totals (null until thrown) and which ability holds each.
  pool: PoolEntry[] | null;
  onPoolChange: (pool: PoolEntry[] | null) => void;
  slots: PoolSlots<Ability>;
  onSlotsChange: (slots: PoolSlots<Ability>) => void;
  racialBonus: Partial<Record<Ability, number>>;
  // Ability score improvements the chosen level has earned; > 0 adds a hint
  // that base scores are level-1 rules and the bonuses are picked below.
  asiCount?: number;
  // "half-orc paladin", for the summary's sentence.
  who?: string;
  // What the health explainer under the summary works from.
  hp?: HpExplainerInput | null;
}) {
  // The toss in the air. Display only: the pool itself is committed the
  // moment the dice leave the hand, so nothing is lost if the player moves
  // on mid-toss.
  const [phases, setPhases] = useState<Array<"rolling" | "settled">>([]);
  const [tossId, setTossId] = useState(0);
  // The throw in hand, waiting for an ability to land on.
  const [held, setHeld] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<Ability | "tray" | null>(null);
  const [methodInfoOpen, setMethodInfoOpen] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
    };
  }, []);

  const pointBuyScores = ABILITY_KEYS.map((key) => scores[key] ?? POINT_BUY_MIN);
  const remaining = method === "pointbuy" ? pointBuyRemaining(pointBuyScores) : 0;
  const anyRolling = method === "roll" && phases.some((phase) => phase === "rolling");
  const placedCount = ABILITY_KEYS.filter((key) => slots[key] !== null).length;
  const complete = ABILITY_KEYS.every((key) => scores[key] !== null);
  const total = pool ? poolSum(pool) : 0;
  const rerollOpen = canRerollPool(pool);
  const ownerOf = (index: number) => ABILITY_KEYS.find((key) => slots[key] === index) ?? null;

  function switchMethod(next: AbilityMethod) {
    setHeld(null);
    onMethodChange(next);
    onScoresChange(
      next === "pointbuy"
        ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }
        : next === "roll" && pool
          ? scoresFromSlots(slots, pool)
          : { str: null, dex: null, con: null, int: null, wis: null, cha: null },
    );
  }

  function throwPool() {
    if (!rerollOpen || anyRolling) {
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const thrown = rollPool();
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    setHeld(null);
    setTossId((id) => id + 1);
    setPhases(thrown.map(() => (still ? "settled" : "rolling")));
    if (!still) {
      thrown.forEach((_, index) => {
        timers.current.push(
          window.setTimeout(() => {
            setPhases((current) => current.map((phase, at) => (at === index ? "settled" : phase)));
          }, ROW_SETTLE_MS + index * ROW_STAGGER_MS),
        );
      });
    }
    onPoolChange(thrown);
    onSlotsChange(EMPTY_SLOTS);
    onScoresChange(scoresFromSlots(EMPTY_SLOTS, thrown));
  }

  function commitSlots(next: PoolSlots<Ability>) {
    if (!pool) return;
    onSlotsChange(next);
    onScoresChange(scoresFromSlots(next, pool));
  }

  function place(ability: Ability, index: number) {
    commitSlots(placeFromPool(slots, ability, index));
    setHeld(null);
  }

  function returnToTray(index: number) {
    const owner = ownerOf(index);
    if (owner) commitSlots({ ...slots, [owner]: null });
    setHeld(null);
  }

  // A tap on a socket: with a throw in hand it lands there (its own throw
  // goes back to the tray); with an empty hand it picks up what the socket
  // holds, so it can be moved on to another ability.
  function tapSocket(ability: Ability) {
    const mine = slots[ability];
    if (held !== null) {
      place(ability, held);
    } else if (mine !== null) {
      setHeld(mine);
    }
  }

  function nudgeBuy(ability: Ability, delta: number) {
    const value = Math.max(POINT_BUY_MIN, Math.min(POINT_BUY_MAX, (scores[ability] ?? POINT_BUY_MIN) + delta));
    onScoresChange({ ...scores, [ability]: value });
  }

  function startDrag(event: DragEvent, index: number) {
    event.dataTransfer.setData(DRAG_TYPE, String(index));
    event.dataTransfer.effectAllowed = "move";
    setHeld(index);
  }

  function dragInto(event: DragEvent, target: Ability | "tray") {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTarget !== target) setDropTarget(target);
  }

  function dropInto(event: DragEvent, target: Ability | "tray") {
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    setDropTarget(null);
    if (raw === "") return;
    event.preventDefault();
    const index = Number(raw);
    if (target === "tray") returnToTray(index);
    else place(target, index);
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
              {pool ? (
                <span className="font-mono text-[10.5px] text-stone-500" aria-live="polite">
                  {placedCount} / 6 placed
                </span>
              ) : null}
            </span>
            {pool ? (
              <button
                type="button"
                onClick={throwPool}
                disabled={anyRolling || !rerollOpen}
                title={
                  rerollOpen
                    ? `These add up to less than ${REROLL_BELOW}, so you may throw again`
                    : `A reroll opens only when the six add up to less than ${REROLL_BELOW}`
                }
                className={cn(ui.btnSmall, "ml-auto px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40")}
              >
                <Dices className="size-3.5" /> Reroll
              </button>
            ) : null}
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

      {method === "roll" ? (
        <div
          className="pool-tray mb-3"
          data-empty={!pool || undefined}
          data-drop={dropTarget === "tray" || undefined}
          onDragOver={(event) => dragInto(event, "tray")}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => dropInto(event, "tray")}
        >
          {pool ? (
            <>
              <div className="pool-grid" role="group" aria-label="Your six throws">
                {pool.map((entry, index) => {
                  const phase = phases[index] ?? "settled";
                  const rolling = anyRolling && phase === "rolling";
                  const owner = ownerOf(index);
                  const inHand = held === index;
                  return (
                    <button
                      key={`${tossId}-${index}`}
                      type="button"
                      className="pool-token"
                      data-phase={anyRolling ? phase : undefined}
                      data-held={inHand || undefined}
                      data-placed={owner ? true : undefined}
                      draggable={!anyRolling}
                      disabled={anyRolling}
                      aria-pressed={inHand}
                      aria-label={`Throw of ${entry.total}${owner ? `, on ${ABILITY_LABELS[owner]}` : ", not placed"}`}
                      onClick={() => setHeld(inHand ? null : index)}
                      onDragStart={(event) => startDrag(event, index)}
                      onDragEnd={() => {
                        setDropTarget(null);
                        setHeld(null);
                      }}
                      style={
                        {
                          "--delay": `${anyRolling ? index * ROW_STAGGER_MS : 0}ms`,
                          "--pop": `${TOTAL_POP_MS}ms`,
                        } as CSSProperties
                      }
                    >
                      {entry.roll ? (
                        <span className="pool-dice">
                          <DiceRow roll={{ ...entry.roll, phase: anyRolling ? phase : "settled" }} />
                        </span>
                      ) : (
                        <span className="pool-saved">from your sheet</span>
                      )}
                      <span className={cn("dice-total", `roll-tier-${rollTier(entry.total)}`)} data-phase={rolling ? "rolling" : undefined}>
                        {entry.total}
                      </span>
                      <span className="pool-tag">{owner ? owner.toUpperCase() : inHand ? "in hand" : "free"}</span>
                    </button>
                  );
                })}
              </div>
              <p className="pool-note" aria-live="polite">
                {anyRolling ? (
                  "The dice are in the air…"
                ) : (
                  <>
                    <span className="font-mono text-amber-200">Total {total}</span>
                    <span className="text-stone-600"> · </span>
                    {rerollOpen
                      ? `Under ${REROLL_BELOW}: you may throw all six again.`
                      : `A reroll opens only under ${REROLL_BELOW}. These six are yours.`}
                    <span className="block text-stone-500">
                      {held !== null
                        ? "Now tap the ability that should get it."
                        : placedCount < 6
                          ? "Tap a throw, then an ability, or drag it into place."
                          : "Tap or drag a placed score to swap it with another."}
                    </span>
                  </>
                )}
              </p>
            </>
          ) : (
            <div className="pool-empty">
              <p className="font-display text-[15px] font-semibold text-stone-100">Six throws of four dice</p>
              <p className="max-w-sm text-xs text-stone-400">
                Each throw keeps its best three. All six land at once, then you decide which ability gets which.
              </p>
              <button type="button" onClick={throwPool} className="pool-throw motion-press">
                <Dices className="size-4" /> Roll the dice
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {ABILITY_KEYS.map((ability) => {
          const bonus = racialBonus[ability] ?? 0;
          const assigned = scores[ability];
          const finalScore = assigned !== null ? assigned + bonus : null;
          const label = ABILITY_LABELS[ability];
          const slot = method === "roll" ? slots[ability] : null;
          const armed = method === "roll" && held !== null && !anyRolling;
          return (
            <div
              key={ability}
              className="dice-row"
              data-armed={armed || undefined}
              data-drop={dropTarget === ability || undefined}
              onDragOver={method === "roll" && pool ? (event) => dragInto(event, ability) : undefined}
              onDragLeave={method === "roll" ? () => setDropTarget(null) : undefined}
              onDrop={method === "roll" && pool ? (event) => dropInto(event, ability) : undefined}
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
                <button
                  type="button"
                  className="pool-socket"
                  data-filled={slot !== null || undefined}
                  data-held={slot !== null && held === slot ? true : undefined}
                  disabled={!pool || anyRolling || (slot === null && held === null)}
                  draggable={slot !== null && !anyRolling}
                  onClick={() => tapSocket(ability)}
                  onDragStart={slot !== null ? (event) => startDrag(event, slot) : undefined}
                  onDragEnd={() => {
                    setDropTarget(null);
                    setHeld(null);
                  }}
                  aria-label={
                    slot !== null
                      ? `${label} holds ${assigned}. ${held === slot ? "Tap again to send it back to the tray" : held !== null ? "Tap to swap" : "Tap to pick it up"}`
                      : held !== null
                        ? `Place the held throw on ${label}`
                        : `${label} is empty`
                  }
                >
                  {slot !== null && assigned !== null ? (
                    <span key={`${tossId}-${slot}`} className={cn("pool-socket-value", `roll-tier-${rollTier(assigned)}`)}>
                      {assigned}
                    </span>
                  ) : (
                    <span className="pool-socket-hint">{armed ? "Place" : "—"}</span>
                  )}
                </button>
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
