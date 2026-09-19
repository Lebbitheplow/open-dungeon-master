"use client";

import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import {
  ActionPlate,
  CloseForm,
  DeskCard,
  adjudicationGlyph,
} from "@/app/campaigns/[campaignId]/DmConsoleParts";
import { DmActionForm } from "@/app/campaigns/[campaignId]/DmActionForm";
import { ADJUDICATIONS } from "@/lib/dm/invoke-catalog";
import { findAdjudication } from "@/lib/dm/catalog-types";
import { DIFFICULTY_TIERS, dcForDifficulty, type DifficultyTier } from "@/lib/srd/dc";
import { evaluateEncounter, type EncounterVerdict } from "@/lib/srd/encounter-math";
import { OddsCalculator, type CritRules } from "@/app/campaigns/[campaignId]/DmOddsPanel";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The DM's assist rail: read-only answers from engines that already exist.
// Nothing here applies anything to the game. The one exception is the
// suggestion, which hands the DM a prefilled adjudication form; they still
// press the button.

const TIER_LABELS: Record<DifficultyTier, string> = {
  very_easy: "Very easy",
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  very_hard: "Very hard",
  nearly_impossible: "Nearly impossible",
};

const VERDICT_LABELS: Record<EncounterVerdict, string> = {
  trivial: "Trivial",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  deadly: "Deadly",
  beyond_deadly: "Beyond deadly",
};

const VERDICT_TONE: Record<EncounterVerdict, string> = {
  trivial: "text-stone-400",
  easy: "text-emerald-300",
  medium: "text-amber-200",
  hard: "text-orange-300",
  deadly: "text-red-300",
  beyond_deadly: "text-red-400",
};

const inputClass = ui.input;

type Suggestion = {
  name: string;
  label: string;
  summary: string;
  args?: Record<string, unknown>;
  why?: string;
};

// "The player said this. What am I supposed to press?" The shortlist comes
// from a keyword pass over the catalog and arrives instantly; the model only
// reorders it and fills the form in.
function IntentSuggest({
  campaignId,
  sheets,
  encounter,
  intent,
  onIntentChange,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
  intent: string;
  onIntentChange: (next: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState<Suggestion | null>(null);

  async function ask(useModel: boolean) {
    const text = intent.trim();
    if (!text) {
      return;
    }
    setBusy(true);
    setError("");
    setOpen(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/assist/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: text, useModel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not work that out.");
        return;
      }
      setSuggestions(data.suggestions ?? []);
      if (!data.suggestions?.length) {
        setError("Nothing in the engine matches that. It may just be narration.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const openEntry = open ? findAdjudication(ADJUDICATIONS, open.name) : null;

  return (
    <DeskCard glyph="die-d20" title="What should I press?">
      <textarea
        value={intent}
        onChange={(event) => onIntentChange(event.target.value.slice(0, 1000))}
        rows={2}
        placeholder="I try to talk the guard into letting us through."
        aria-label="What the player said"
        className={cn(inputClass, "resize-y")}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => ask(true)}
          disabled={busy || !intent.trim()}
          aria-busy={busy}
          className={ui.btnPrimary}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Suggest
        </button>
        <button
          type="button"
          onClick={() => ask(false)}
          disabled={busy || !intent.trim()}
          title="Skips the model and just matches keywords against the catalog."
          className={cn(ui.btnSmall, "min-h-10 text-xs")}
        >
          Without the model
        </button>
      </div>
      {error ? <p className="motion-shake mt-1.5 text-xs text-red-400">{error}</p> : null}

      {suggestions.length ? (
        <ul className="stagger mt-2 space-y-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion.name}>
              {open?.name === suggestion.name && openEntry ? (
                <div className="reveal space-y-1">
                  <DmActionForm
                    campaignId={campaignId}
                    entry={openEntry}
                    sheets={sheets}
                    encounter={encounter}
                    initialArgs={suggestion.args}
                    glyph={adjudicationGlyph(suggestion.name, "tab-dm")}
                  />
                  <CloseForm onClick={() => setOpen(null)} />
                </div>
              ) : (
                <ActionPlate
                  glyph={adjudicationGlyph(suggestion.name, "tab-dm")}
                  label={suggestion.label}
                  badge={
                    suggestion.args ? (
                      <span className="ml-1.5 rounded-full border border-amber-500/40 bg-amber-400/10 px-1.5 py-px align-middle font-display text-[10px] tracking-[0.1em] text-amber-200">
                        filled in
                      </span>
                    ) : null
                  }
                  summary={suggestion.why || suggestion.summary}
                  onClick={() => setOpen(suggestion)}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </DeskCard>
  );
}

// The DMG's difficulty ladder, so "hard" is DC 20 in every scene.
function DcLadder() {
  return (
    <DeskCard glyph="rest-proficiency" title="What should this cost?">
      <div className="stagger-pop flex flex-wrap gap-1">
        {DIFFICULTY_TIERS.map((tier) => (
          <span
            key={tier}
            className="inline-flex items-center rounded-lg border border-amber-500/25 bg-stone-950/50 px-2 py-1 text-xs text-stone-200"
          >
            {TIER_LABELS[tier]}
            <span className="ml-1.5 font-display font-semibold tracking-wide text-amber-200">
              DC {dcForDifficulty(tier)}
            </span>
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-stone-500">
        Naming the tier rather than the number is what keeps a hard lock the
        same difficulty in chapter one and chapter nine.
      </p>
    </DeskCard>
  );
}

// The fight on the board, measured against the party in front of it.
function EncounterBudget({
  sheets,
  encounter,
}: {
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
}) {
  const evaluation = useMemo(() => {
    const levels = sheets.filter((sheet) => !sheet.deathSaves?.dead).map((sheet) => sheet.level);
    const crs = (encounter?.enemies ?? [])
      .filter((enemy) => enemy.status === "alive")
      .map((enemy) => enemy.cr);
    if (!levels.length || !crs.length) {
      return null;
    }
    return evaluateEncounter(levels, crs);
  }, [sheets, encounter]);

  if (!evaluation) {
    return (
      <DeskCard glyph="system-encounters" title="How hard is this fight?">
        <p className="text-xs text-stone-500">
          Nothing on the board yet. Add enemies and this reads the budget as
          they land.
        </p>
      </DeskCard>
    );
  }
  return (
    <DeskCard glyph="system-encounters" title="How hard is this fight?">
      <p key={evaluation.verdict} className={cn("count-pop flex items-center gap-2 font-display text-base tracking-wide", VERDICT_TONE[evaluation.verdict])}>
        <GameIcon icon={{ kind: "glyph", key: "tab-battle" }} size="size-6" />
        {VERDICT_LABELS[evaluation.verdict]}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-stone-500">
        {evaluation.adjustedXp.toLocaleString()} adjusted XP against thresholds
        of {evaluation.thresholds.easy.toLocaleString()} easy,{" "}
        {evaluation.thresholds.medium.toLocaleString()} medium,{" "}
        {evaluation.thresholds.hard.toLocaleString()} hard,{" "}
        {evaluation.thresholds.deadly.toLocaleString()} deadly. Raw XP is{" "}
        {evaluation.totalXp.toLocaleString()}; the rest is the many-enemies
        multiplier.
      </p>
    </DeskCard>
  );
}

// Rules lookup, which is Ask with the scope pinned to "rules" and the answer
// kept private. Not a second Ask: the same endpoint, the same retrieval, the
// same citations. What it adds is that the DM does not have to leave the
// console to use it, which on a phone means not leaving the screen.
//
// House rules already win here: assembleEvidence pulls the table's own
// rule_chunks, sorts pinned ones first, and tells the model they override the
// standard rules.
function RulesLookup({ campaignId }: { campaignId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<{
    answer: string;
    citations: Array<{ kind: string; ref: string; quote: string }>;
  } | null>(null);

  async function look() {
    const text = question.trim();
    if (!text) {
      return;
    }
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, scope: "rules", visibility: "private" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not look that up.");
        return;
      }
      setAnswer({ answer: data.ask?.answer ?? "", citations: data.ask?.citations ?? [] });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DeskCard glyph="system-rules" title="Look up a rule">
      <div className="flex gap-1.5">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value.slice(0, 500))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void look();
            }
          }}
          placeholder="Can you cast a spell and use a bonus action?"
          aria-label="Rules question"
          className={inputClass}
        />
        <button
          type="button"
          onClick={look}
          disabled={busy || !question.trim()}
          aria-busy={busy}
          className={cn(ui.btnSecondary, "shrink-0")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
        </button>
      </div>
      {error ? <p className="motion-shake mt-1.5 text-xs text-red-400">{error}</p> : null}
      {answer ? (
        <div className="reveal mt-1.5 text-xs text-stone-300">
          <p className="whitespace-pre-wrap">{answer.answer}</p>
          {answer.citations.length ? (
            <ul className="reveal mt-1 space-y-0.5 text-[11px] text-stone-500">
              {answer.citations.map((citation) => (
                <li key={`${citation.kind}:${citation.ref}`}>
                  {citation.ref}: {citation.quote}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </DeskCard>
  );
}

export function DmAssistPanel({
  campaignId,
  sheets,
  encounter,
  variantRules,
  intent,
  onIntentChange,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
  // The table's crit rules, so the consequence preview agrees with what the
  // server would roll.
  variantRules: CritRules;
  intent: string;
  onIntentChange: (next: string) => void;
}) {
  return (
    <div className="space-y-3">
      <IntentSuggest
        campaignId={campaignId}
        sheets={sheets}
        encounter={encounter}
        intent={intent}
        onIntentChange={onIntentChange}
      />
      <EncounterBudget sheets={sheets} encounter={encounter} />
      <DcLadder />
      <OddsCalculator variantRules={variantRules} />
      <RulesLookup campaignId={campaignId} />
    </div>
  );
}
