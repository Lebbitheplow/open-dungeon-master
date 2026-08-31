"use client";

import { useMemo, useState } from "react";
import { BookOpen, Loader2, Scale, Sparkles, Swords } from "lucide-react";
import { cn } from "@/lib/cn";
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

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Scale;
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
    <Section icon={Sparkles} title="What should I press?">
      <textarea
        value={intent}
        onChange={(event) => onIntentChange(event.target.value.slice(0, 1000))}
        rows={2}
        placeholder="I try to talk the guard into letting us through."
        className={cn(inputClass, "resize-y")}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => ask(true)}
          disabled={busy || !intent.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/50 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Suggest
        </button>
        <button
          type="button"
          onClick={() => ask(false)}
          disabled={busy || !intent.trim()}
          title="Skips the model and just matches keywords against the catalog."
          className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-40"
        >
          Without the model
        </button>
      </div>
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}

      {suggestions.length ? (
        <ul className="mt-2 space-y-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion.name}>
              {open?.name === suggestion.name && openEntry ? (
                <div className="space-y-1">
                  <DmActionForm
                    campaignId={campaignId}
                    entry={openEntry}
                    sheets={sheets}
                    encounter={encounter}
                    initialArgs={suggestion.args}
                  />
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    className="text-[11px] text-stone-500 hover:text-stone-300"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(suggestion)}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2 text-left hover:border-stone-700"
                >
                  <span className="block text-sm text-stone-200">
                    {suggestion.label}
                    {suggestion.args ? (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-300/80">
                        filled in
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-stone-500">
                    {suggestion.why || suggestion.summary}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

// The DMG's difficulty ladder, so "hard" is DC 20 in every scene.
function DcLadder() {
  return (
    <Section icon={Scale} title="What should this cost?">
      <div className="flex flex-wrap gap-1">
        {DIFFICULTY_TIERS.map((tier) => (
          <span
            key={tier}
            className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300"
          >
            {TIER_LABELS[tier]}
            <span className="ml-1.5 font-semibold text-amber-200">
              DC {dcForDifficulty(tier)}
            </span>
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-stone-500">
        Naming the tier rather than the number is what keeps a hard lock the
        same difficulty in chapter one and chapter nine.
      </p>
    </Section>
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
      <Section icon={Swords} title="How hard is this fight?">
        <p className="text-xs text-stone-500">
          Nothing on the board yet. Add enemies and this reads the budget as
          they land.
        </p>
      </Section>
    );
  }
  return (
    <Section icon={Swords} title="How hard is this fight?">
      <p className={cn("text-sm font-medium", VERDICT_TONE[evaluation.verdict])}>
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
    </Section>
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
    <Section icon={BookOpen} title="Look up a rule">
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
          className={inputClass}
        />
        <button
          type="button"
          onClick={look}
          disabled={busy || !question.trim()}
          className="shrink-0 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Ask"}
        </button>
      </div>
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
      {answer ? (
        <div className="mt-1.5 text-xs text-stone-300">
          <p className="whitespace-pre-wrap">{answer.answer}</p>
          {answer.citations.length ? (
            <ul className="mt-1 space-y-0.5 text-[11px] text-stone-500">
              {answer.citations.map((citation) => (
                <li key={`${citation.kind}:${citation.ref}`}>
                  {citation.ref}: {citation.quote}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Section>
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
