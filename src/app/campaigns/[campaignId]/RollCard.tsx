"use client";

import { useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { checkBeat } from "@/lib/battlemap/beats";
import type { StoredRoll } from "@/lib/db/rolls";
import type { DiceTerm, ModifierTerm } from "@/lib/dice";
import { prefersReducedMotion } from "@/lib/effects-mode";
import { CheckDie, CheckFrame, type CheckDieState } from "@/app/campaigns/[campaignId]/SkillCheckCard";

const KIND_LABELS: Record<string, string> = {
  skill_check: "Skill check",
  saving_throw: "Saving throw",
  ability_check: "Ability check",
  attack: "Attack roll",
  damage: "Damage",
  initiative: "Initiative",
  custom: "Roll",
};

// A roll that arrived within this window is the one the table is watching
// land; anything older is history and is shown still.
const FRESH_MS = 6000;

function lowEffectsNow(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.effects === "low";
}

// The roll announce (docs/visual-overhaul-plan.md 5.4): the line a roll
// writes in the chronicle, presented as the skill-check card landing. The die
// tumbles, the modifier flies in and merges, the total lands on the overshoot
// and the verdict pops on the spring; a natural 20 frames it in gold, a
// natural 1 in ember. It is the card around the number: the 3D dice tray
// plays on its own and is not driven from here.
export function RollCard({ roll, characterName }: { roll: StoredRoll; characterName?: string }) {
  const label = KIND_LABELS[roll.kind] ?? "Roll";
  const detail = roll.detail ? roll.detail.replaceAll("_", " ") : "";
  // Decided once, when the card first appears: a re-render must not replay
  // the landing, and scrolling back through history must not start one.
  const [beat] = useState<CheckDieState>(() => {
    const age = Date.now() - new Date(roll.createdAt).getTime();
    if (!(age >= 0 && age < FRESH_MS) || prefersReducedMotion()) {
      return "settled";
    }
    // Low effects plays from the chip onward: the number, without the tumble.
    return lowEffectsNow() ? "landing-short" : "landing";
  });

  // A blind roll: the table sees that the dice went, and what for, and not
  // how they landed. The server stripped the number before it ever reached
  // this browser (src/lib/dm/viewer.ts).
  if ((roll as { hidden?: boolean }).hidden) {
    return (
      <div className="inline-flex animate-fade-up items-center gap-2 rounded-lg border border-stone-700/70 bg-stone-900/70 px-3 py-2 text-sm text-stone-400 shadow-elev-1">
        <GameIcon icon={{ kind: "glyph", key: "die-d20" }} size="size-6" className="opacity-80" />
        <span>
          {characterName ? `${characterName} · ` : ""}
          {label}
          {detail ? ` (${detail})` : ""}
        </span>
        <span className="text-xs text-stone-600">rolled behind the screen</span>
      </div>
    );
  }

  const diceTerms = roll.breakdown.terms.filter((term): term is DiceTerm => term.kind === "dice");
  const flat = roll.breakdown.terms
    .filter((term): term is ModifierTerm => term.kind === "modifier")
    .reduce((sum, term) => sum + term.sign * term.value, 0);
  const crit = roll.breakdown.crit ?? null;
  const judged = roll.dc !== null;
  const tone = judged ? (roll.success ? "pass" : "fail") : crit === "nat1" ? "fail" : crit === "nat20" ? "pass" : "neutral";
  const verdict = judged ? (roll.success ? "Success!" : "Failure!") : null;
  const timing = checkBeat({ quick: beat === "landing-short" });
  const sides = diceTerms[0]?.sides ?? 20;

  return (
    <CheckFrame
      crit={crit}
      className="inline-flex max-w-full animate-fade-up items-center gap-3 py-2 pl-2 pr-4 text-sm"
      style={
        {
          "--check-run": `${timing.run}ms`,
          "--check-total-at": `${timing.total}ms`,
          "--check-verdict-at": `${timing.verdict}ms`,
        } as React.CSSProperties
      }
    >
      <CheckDie
        state={beat}
        total={roll.total}
        tone={tone}
        sides={sides}
        size="size-14"
        modLabel={flat !== 0 ? `${flat > 0 ? "+" : ""}${flat}` : undefined}
        verdict={verdict}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-display text-[12px] font-semibold tracking-[0.04em]">
            {characterName ? `${characterName} · ` : ""}
            {label}
            {detail ? ` (${detail})` : ""}
          </span>
          {crit === "nat20" ? (
            <span className="animate-twinkle text-xs font-semibold" style={{ color: "var(--check-pass)" }}>
              Natural 20!
            </span>
          ) : crit === "nat1" ? (
            <span className="text-xs font-medium" style={{ color: "var(--check-fail)" }}>
              Natural 1
            </span>
          ) : null}
        </span>
        {/* The mechanics line: what was rolled, each die, and what it made. */}
        <span className={cn("check-dim flex flex-wrap items-center gap-x-2 font-mono text-xs", beat !== "settled" && "check-log")}>
          <span>{roll.expression}</span>
          <span className="opacity-80">
            {diceTerms
              .map((term) => term.dice.map((die) => (die.kept ? String(die.value) : `(${die.value})`)).join(" "))
              .join(" | ")}
          </span>
          <span className="text-sm font-semibold" style={{ color: tone === "neutral" ? "var(--check-ink)" : `var(--check-${tone})` }}>
            = {roll.total}
          </span>
          {judged ? (
            <span
              className="check-well px-1.5 py-px"
              style={{ color: roll.success ? "var(--check-pass)" : "var(--check-fail)" }}
            >
              DC {roll.dc} · {roll.success ? "success" : "failure"}
            </span>
          ) : null}
        </span>
      </span>
    </CheckFrame>
  );
}
