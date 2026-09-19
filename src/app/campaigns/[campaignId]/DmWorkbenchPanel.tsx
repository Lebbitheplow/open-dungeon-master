"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { DisclosureHead, FieldLabel, OptionalNumber } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import type { WorkbenchPart, WorkbenchReadout } from "@/lib/dm/encounter-workbench";
import { useTourPrepare } from "@/lib/tours/prepare";
import { MonsterRosterPicker } from "@/app/campaigns/[campaignId]/MonsterRosterPicker";

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

// What the fold wears when the panel is a card of its own (the workshop).
const innerCard = "flex flex-col gap-2 rounded-lg border border-amber-500/15 bg-stone-950/40 p-3";

function Parts({ parts }: { parts: WorkbenchPart[] }) {
  return (
    <div className="flex flex-col gap-1">
      {parts.map((part) => (
        <div key={part.label} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
          <span className="w-32 shrink-0 text-stone-400">{part.label}</span>
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

  // The tour's "unfold the workbench" step.
  useTourPrepare((name) => {
    if (name === "open-workbench") setOpen(true);
  });

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
      <div className={collapsible ? innerCard : cn(ui.card, "dm-card flex flex-col gap-2 p-3")}>
        {collapsible ? null : <SectionHead title="Weigh a fight" glyph="rest-proficiency" />}
        {/* The same search the prepared-encounter form has: pick from what
            this world holds rather than remembering a spelling. */}
        <MonsterRosterPicker campaignId={campaignId} roster={enemies} onChange={setEnemies} />
        <textarea
          value={enemies}
          onChange={(event) => setEnemies(event.target.value)}
          rows={3}
          placeholder={"goblin x4\nhobgoblin"}
          data-tour="encounters-workbench-roster"
          aria-label="Roster to weigh"
          className={cn(ui.input, "resize-y font-mono text-xs")}
        />
        <div className="flex flex-wrap items-end gap-2">
          {/* An empty figure means "the party as it is", and is left out of
              the request, so both stay clearable. */}
          <div>
            <FieldLabel>Party level (what if)</FieldLabel>
            <OptionalNumber
              value={partyLevel}
              onChange={setPartyLevel}
              min={1}
              max={20}
              label="Party level (what if)"
              emptyHint="as it is"
              size="sm"
            />
          </div>
          <div>
            <FieldLabel>Party size</FieldLabel>
            <OptionalNumber
              value={partySize}
              onChange={setPartySize}
              min={1}
              max={8}
              label="Party size"
              emptyHint="as it is"
              size="sm"
            />
          </div>
          <button
            type="button"
            disabled={busy || !enemies.trim()}
            onClick={() => void run()}
            aria-busy={busy}
            className={ui.btnSecondary}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <GameIcon icon={{ kind: "glyph", key: "die-d20" }} size="size-5" />}
            Work it out
          </button>
        </div>
        {error ? <p className="motion-shake text-[11px] text-red-400">{error}</p> : null}
      </div>

      {budget && attrition && result ? (
        <>
          <div className={cn(collapsible ? innerCard : cn(ui.card, "flex flex-col gap-2 p-3"), "live-in")}>
            <p className="text-sm">
              <span key={budget.verdict} className={cn("count-pop inline-block font-display text-base tracking-wide", VERDICT_TONE[budget.verdict] ?? "text-stone-300")}>
                {budget.verdict.replace(/_/g, " ")}
              </span>{" "}
              <span className="text-stone-500">
                for {result.party.size} character{result.party.size === 1 ? "" : "s"} at level{" "}
                {[...new Set(result.party.levels)].join(", ")}
              </span>
            </p>
            {budget.overCeiling ? (
              <p className="motion-shake text-[11px] text-red-400">
                Past this campaign&apos;s ceiling. The engine will refuse to start it as written.
              </p>
            ) : null}
            {budget.monsterCount > result.maxEnemies ? (
              <p className="reveal text-[11px] text-amber-300/80">
                {budget.monsterCount} creatures. A fight takes {result.maxEnemies} or fewer, so this
                roster is a plan rather than something that will deploy.
              </p>
            ) : null}
            <Parts parts={budget.parts} />
          </div>

          <div className={cn(collapsible ? innerCard : cn(ui.card, "flex flex-col gap-2 p-3"), "live-in")}>
            <p className="text-sm text-stone-200">{attrition.outcome}</p>
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
      <DisclosureHead
        open={open}
        onToggle={() => setOpen((current) => !current)}
        glyph="rest-proficiency"
        title="How hard is this?"
        tour="encounters-workbench"
      />
      {open ? <div className="reveal mt-3">{body}</div> : null}
    </section>
  );
}
