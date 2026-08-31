"use client";

import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { asPercent, forecastAttack, roundsToDrop } from "@/lib/srd/odds";

// The consequence preview: hit chance, expected damage, and how long a target
// lasts. Pure arithmetic from src/lib/srd/odds.ts, so it is instant, always
// available, and needs nothing from the server.

// The only two table rules that change what a crit is worth. Named here so
// the same shape threads down from the panel without dragging the whole
// GameSettings type through three components.
export type CritRules = { powerfulCritical: boolean; criticalDamageMods: boolean };

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Calculator;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <Icon className="size-3.5" />
        {title}
      </p>
      {children}
    </section>
  );
}

// Hit chance, expected damage, and how long a target lasts. Pure arithmetic
// from src/lib/srd/odds.ts, so it is instant and always available.
export function OddsCalculator({
  variantRules,
}: {
  // The table's optional crit rules. The forecast runs them through the
  // engine's own critDamageExpression, so what it predicts is what the
  // server would actually roll.
  variantRules: CritRules;
}) {
  const [attackBonus, setAttackBonus] = useState(5);
  const [ac, setAc] = useState(15);
  const [damage, setDamage] = useState("1d8+3");
  const [advantage, setAdvantage] = useState<"none" | "advantage" | "disadvantage">("none");
  const [hitPoints, setHitPoints] = useState(30);
  const [attacksPerRound, setAttacksPerRound] = useState(1);
  const [extraCritDice, setExtraCritDice] = useState(0);

  const forecast = useMemo(
    () =>
      forecastAttack({
        attackBonus,
        ac,
        damage,
        advantage,
        extraCritDice,
        variantRules: {
          powerfulCritical: variantRules.powerfulCritical,
          multiplyNumeric: variantRules.criticalDamageMods,
        },
      }),
    [attackBonus, ac, damage, advantage, extraCritDice, variantRules],
  );
  const perRound = forecast.perAttack * Math.max(1, attacksPerRound);
  const rounds = roundsToDrop(hitPoints, perRound);

  return (
    <Section icon={Calculator} title="What is this likely to do?">
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[11px] text-stone-500">
          Attack bonus
          <input
            type="number"
            value={attackBonus}
            onChange={(event) => setAttackBonus(Number(event.target.value) || 0)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500">
          Target AC
          <input
            type="number"
            value={ac}
            onChange={(event) => setAc(Number(event.target.value) || 0)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500">
          Damage
          <input
            value={damage}
            onChange={(event) => setDamage(event.target.value)}
            placeholder="2d6+4"
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500">
          Roll
          <select
            value={advantage}
            onChange={(event) =>
              setAdvantage(event.target.value as "none" | "advantage" | "disadvantage")
            }
            className={inputClass}
          >
            <option value="none">Straight</option>
            <option value="advantage">Advantage</option>
            <option value="disadvantage">Disadvantage</option>
          </select>
        </label>
        <label className="text-[11px] text-stone-500">
          Target hit points
          <input
            type="number"
            value={hitPoints}
            onChange={(event) => setHitPoints(Number(event.target.value) || 0)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500">
          Attacks per round
          <input
            type="number"
            min={1}
            value={attacksPerRound}
            onChange={(event) => setAttacksPerRound(Number(event.target.value) || 1)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500" title="Brutal Critical, Savage Attacks.">
          Extra dice on a crit
          <input
            type="number"
            min={0}
            max={4}
            value={extraCritDice}
            onChange={(event) => setExtraCritDice(Math.max(0, Number(event.target.value) || 0))}
            className={inputClass}
          />
        </label>
      </div>
      {forecast.exact ? null : (
        <p className="mt-2 text-xs text-amber-300/90">
          That damage expression cannot be averaged, so only the odds below are
          real. The chance to hit never depended on it.
        </p>
      )}
      <dl className="mt-2 space-y-0.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-stone-500">Chance to hit</dt>
          <dd className="text-stone-200">
            {asPercent(forecast.odds.hit)}
            <span className="text-stone-500"> ({asPercent(forecast.odds.crit)} crit)</span>
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">Damage on a hit</dt>
          <dd className="text-stone-200">
            {forecast.exact ? (
              <>
                {forecast.onHit.toFixed(1)}
                <span className="text-stone-500"> ({forecast.onCrit.toFixed(1)} on a crit)</span>
              </>
            ) : (
              "unknown"
            )}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">Average per round</dt>
          <dd className="text-stone-200">{forecast.exact ? perRound.toFixed(1) : "unknown"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">Rounds to drop</dt>
          <dd className="text-stone-200">
            {!forecast.exact ? "unknown" : rounds === null ? "never" : rounds}
          </dd>
        </div>
      </dl>
    </Section>
  );
}
