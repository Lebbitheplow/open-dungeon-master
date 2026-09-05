"use client";

import { useState } from "react";
import { Calculator, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { WorkbenchPart, WorkbenchReadout } from "@/lib/dm/encounter-workbench";

// The encounter workbench: what a roster costs, and what it is likely to do.
//
// Nothing here computes anything. The whole readout arrives from the route,
// which resolves the roster through the same resolver start_encounter uses
// and runs the same XP maths the engine enforces, so a fight that reads
// "hard" here is one the engine will also treat as hard.
//
// Every number shows its parts. That is the feature: a DM will not trust a
// difficulty rating they cannot audit, and the ratings worth auditing are
// exactly the ones that disagree with their instinct.
//
// In the workshop the panel folds into a "How hard is this?" card so the
// prepared encounters get the room. The fields inside are the same; only the
// frame and the heading change.

type Response = {
  readout: WorkbenchReadout;
  party: { levels: number[]; size: number };
  roster: Array<{ name: string; count: number; cr: number; ac: number; hp: number }>;
  maxEnemies: number;
};

const VERDICT_TONE: Record<string, string> = {
  trivial: "text-stone-500",
  easy: "text-emerald-300/80",
  medium: "text-amber-200",
  hard: "text-orange-300",
  deadly: "text-red-400",
  beyond_deadly: "text-red-400",
};

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

function Parts({ parts }: { parts: WorkbenchPart[] }) {
  return (
    <div className="flex flex-col gap-1">
      {parts.map((part) => (
        <div key={part.label} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
          <span className="w-32 shrink-0 text-stone-500">{part.label}</span>
          <span className="w-24 shrink-0 text-amber-100">{part.value}</span>
          <span className="flex-1 text-stone-500">{part.detail}</span>
        </div>
      ))}
    </div>
  );
}

export function DmWorkbenchPanel({
  campaignId,
  collapsible = false,
}: {
  campaignId: string;
  // Opt-in: wrap the panel in a card that opens on tap. Off by default so
  // the DM console renders as it always has.
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [enemies, setEnemies] = useState("");
  const [partyLevel, setPartyLevel] = useState<number | "">("");
  const [partySize, setPartySize] = useState<number | "">("");
  const [result, setResult] = useState<Response | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/workbench`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enemies,
          ...(partyLevel === "" ? {} : { partyLevel }),
          ...(partySize === "" ? {} : { partySize }),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<Response> & {
        error?: string;
      };
      if (!response.ok || !payload.readout) {
        setError(payload.error ?? "That roster could not be costed.");
        setResult(null);
        return;
      }
      setResult(payload as Response);
    } finally {
      setBusy(false);
    }
  }

  const budget = result?.readout.budget;
  const attrition = result?.readout.attrition;

  const body = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-stone-800 bg-stone-900/40 p-3">
        {collapsible ? null : (
          <h3 className="flex items-center gap-1.5 text-sm text-amber-100">
            <Calculator className="size-4" /> Weigh a fight
          </h3>
        )}
        <textarea
          value={enemies}
          onChange={(event) => setEnemies(event.target.value)}
          rows={3}
          placeholder={"goblin x4\nhobgoblin"}
          className={cn(input, "w-full resize-y font-mono")}
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-500">
              Party level (what if)
            </span>
            <input
              type="number"
              min={1}
              max={20}
              value={partyLevel}
              onChange={(event) =>
                setPartyLevel(event.target.value === "" ? "" : Number(event.target.value))
              }
              placeholder="as it is"
              className={cn(input, "w-28")}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-500">Party size</span>
            <input
              type="number"
              min={1}
              max={8}
              value={partySize}
              onChange={(event) =>
                setPartySize(event.target.value === "" ? "" : Number(event.target.value))
              }
              placeholder="as it is"
              className={cn(input, "w-28")}
            />
          </label>
          <button
            type="button"
            disabled={busy || !enemies.trim()}
            onClick={() => void run()}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 px-3 py-1 text-xs text-amber-100 hover:bg-stone-800 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Work it out
          </button>
        </div>
        {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      </div>

      {budget && attrition && result ? (
        <>
          <div className="flex flex-col gap-2 rounded-lg border border-stone-800 bg-stone-900/40 p-3">
            <p className="text-sm">
              <span className={cn("font-medium", VERDICT_TONE[budget.verdict] ?? "text-stone-300")}>
                {budget.verdict.replace(/_/g, " ")}
              </span>{" "}
              <span className="text-stone-500">
                for {result.party.size} character{result.party.size === 1 ? "" : "s"} at level{" "}
                {[...new Set(result.party.levels)].join(", ")}
              </span>
            </p>
            {budget.overCeiling ? (
              <p className="text-[11px] text-red-400">
                Past this campaign&apos;s ceiling. The engine will refuse to start it as written.
              </p>
            ) : null}
            {budget.monsterCount > result.maxEnemies ? (
              <p className="text-[11px] text-amber-300/80">
                {budget.monsterCount} creatures. A fight takes {result.maxEnemies} or fewer, so this
                roster is a plan rather than something that will deploy.
              </p>
            ) : null}
            <Parts parts={budget.parts} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-stone-800 bg-stone-900/40 p-3">
            <p className="text-sm text-stone-300">{attrition.outcome}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-stone-500">
              <span>
                Party{" "}
                <span className="text-amber-100">
                  {attrition.party.hitPoints} hp, {attrition.party.damagePerRound.toFixed(1)} a round
                </span>
              </span>
              <span>
                Roster{" "}
                <span className="text-amber-100">
                  {attrition.monsters.hitPoints} hp,{" "}
                  {attrition.monsters.damagePerRound.toFixed(1)} a round
                </span>
              </span>
            </div>
            <Parts parts={[...attrition.party.parts, ...attrition.monsters.parts]} />
            {attrition.warnings.map((warning) => (
              <p key={warning} className="text-[10px] text-amber-300/70">
                {warning}
              </p>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );

  if (!collapsible) {
    return body;
  }
  return (
    <section className={`${ui.card} p-3`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left font-display text-sm tracking-wide text-amber-100"
      >
        <Calculator className="size-4 text-amber-300" />
        How hard is this?
        {open ? (
          <ChevronDown className="ml-auto size-4 text-stone-500" />
        ) : (
          <ChevronRight className="ml-auto size-4 text-stone-500" />
        )}
      </button>
      {open ? <div className="mt-3">{body}</div> : null}
    </section>
  );
}
