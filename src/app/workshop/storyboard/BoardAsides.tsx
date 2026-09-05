"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { BEAT_LABELS, type BeatKind, type Suggestion } from "@/lib/workshop/board";
import type { CompileSummary } from "@/lib/workshop/board-compile";

// What sits beside the workshop board: what the board is missing and what
// it becomes. Both are collapsible cards so a phone can fold them away under
// the cards, and both say exactly what the DM console's list says, because
// the suggestions are the same arithmetic and the compile the same summary.
//
// Neither of these is AI, so neither is ever hidden. The suggestions are
// counted over the board (lib/workshop/board.ts) and the compile is what an
// import would create; both stay in a workshop with no model at all.

function AsideCard({
  title,
  icon,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={cn(ui.card, "p-3")}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-sm text-amber-100"
      >
        {icon}
        {title}
        {open ? (
          <ChevronDown className="ml-auto size-4 text-stone-500" />
        ) : (
          <ChevronRight className="ml-auto size-4 text-stone-500" />
        )}
      </button>
      {open ? <div className="mt-2 flex flex-col gap-1.5">{children}</div> : null}
    </section>
  );
}

export function SuggestionsCard({
  suggestions,
  busy,
  onAdd,
}: {
  suggestions: Suggestion[];
  busy: boolean;
  onAdd: (kind: BeatKind, title: string) => void;
}) {
  if (!suggestions.length) {
    return null;
  }
  return (
    <AsideCard title="What this board is missing" icon={<Lightbulb className="size-4" />}>
      <p className="text-[10px] text-stone-600">
        Counted, not guessed. Nothing here asked a model what your story needs.
      </p>
      {suggestions.map((suggestion) => (
        <div key={suggestion.id} className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-[11px] text-stone-400">{suggestion.reason}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdd(suggestion.kind, suggestion.title)}
            className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-amber-100 disabled:opacity-40"
          >
            + {BEAT_LABELS[suggestion.kind]}
          </button>
        </div>
      ))}
    </AsideCard>
  );
}

export function CompileCard({ summary }: { summary: CompileSummary }) {
  return (
    <AsideCard title="What this becomes">
      <p className="text-[11px] text-stone-500">
        {summary.lines.length
          ? `Imported into a campaign, this board becomes ${summary.lines.join(", ")}.`
          : "Nothing yet. Cards become lore, quests, prepared fights, DM notes and the story arc."}
      </p>
      {summary.arcRefusal ? (
        <p className="text-[10px] text-amber-300/70">{summary.arcRefusal}</p>
      ) : null}
    </AsideCard>
  );
}
