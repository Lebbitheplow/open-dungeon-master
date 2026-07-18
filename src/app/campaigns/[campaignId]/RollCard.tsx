"use client";

import { Dices } from "lucide-react";
import { cn } from "@/lib/cn";
import type { StoredRoll } from "@/lib/db/rolls";
import type { DiceTerm } from "@/lib/dice";

const KIND_LABELS: Record<string, string> = {
  skill_check: "Skill check",
  saving_throw: "Saving throw",
  ability_check: "Ability check",
  attack: "Attack roll",
  damage: "Damage",
  initiative: "Initiative",
  custom: "Roll",
};

export function RollCard({ roll, characterName }: { roll: StoredRoll; characterName?: string }) {
  const diceTerms = roll.breakdown.terms.filter(
    (term): term is DiceTerm => term.kind === "dice",
  );
  const label = KIND_LABELS[roll.kind] ?? "Roll";
  const detail = roll.detail ? roll.detail.replaceAll("_", " ") : "";

  return (
    <div
      className={cn(
        "inline-flex animate-fade-up flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm shadow-elev-1",
        roll.breakdown.crit === "nat20" &&
          "border-amber-500/60 bg-amber-950/40 shadow-glow-gold-strong",
        roll.breakdown.crit === "nat1" && "border-ember-500/60 bg-red-950/40 shadow-glow-ember",
        !roll.breakdown.crit && "border-stone-700/70 bg-stone-900/70",
      )}
    >
      <span className="flex items-center gap-1.5 text-stone-300">
        <Dices className="size-4 text-amber-300" />
        {characterName ? `${characterName} · ` : ""}
        {label}
        {detail ? ` (${detail})` : ""}
      </span>
      <span className="font-mono text-stone-400">{roll.expression}</span>
      <span className="font-mono text-xs text-stone-500">
        {diceTerms
          .map((term) =>
            term.dice
              .map((die) => (die.kept ? String(die.value) : `(${die.value})`))
              .join(" "),
          )
          .join(" | ")}
      </span>
      <span
        className={cn(
          "font-mono text-base font-semibold",
          roll.breakdown.crit === "nat20" && "text-amber-200",
          roll.breakdown.crit === "nat1" && "text-ember-300",
        )}
      >
        = {roll.total}
      </span>
      {roll.dc !== null ? (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs",
            roll.success ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300",
          )}
        >
          DC {roll.dc} · {roll.success ? "success" : "failure"}
        </span>
      ) : null}
      {roll.breakdown.crit === "nat20" ? (
        <span className="animate-twinkle text-xs font-semibold text-amber-200">Natural 20!</span>
      ) : roll.breakdown.crit === "nat1" ? (
        <span className="text-xs font-medium text-ember-300">Natural 1</span>
      ) : null}
    </div>
  );
}
