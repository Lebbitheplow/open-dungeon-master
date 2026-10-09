"use client";

import { useState, type ReactNode } from "react";
import { Select } from "@/components/ui/Select";
import { ChevronDown, ChevronRight } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
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
  tour,
}: {
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  // The guided tour's name for this card.
  tour?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={cn(ui.card, "p-3")} data-tour={tour}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-10 w-full items-center gap-2 text-left font-display text-sm tracking-wide text-amber-100"
      >
        {icon}
        {title}
        {open ? (
          <ChevronDown className="ml-auto size-4 text-stone-500" />
        ) : (
          <ChevronRight className="ml-auto size-4 text-stone-500" />
        )}
      </button>
      {open ? <div className="reveal mt-2 flex flex-col gap-1.5">{children}</div> : null}
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
    <AsideCard title="What this board is missing" icon={<GameIcon icon={{ kind: "glyph", key: "rest-inspiration" }} size="size-7" />} tour="storyboard-missing">
      <p className="text-[11px] text-stone-500">
        Counted, not guessed. Nothing here asked a model what your story needs.
      </p>
      {suggestions.map((suggestion) => (
        <div key={suggestion.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex-1 text-xs text-stone-400">{suggestion.reason}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdd(suggestion.kind, suggestion.title)}
            className={cn(ui.btnSmall, "px-2 py-1.5")}
          >
            + {BEAT_LABELS[suggestion.kind]}
          </button>
        </div>
      ))}
    </AsideCard>
  );
}

// The shared workshop a chapter draws on (#159). Picking one puts its cast,
// places, maps and fights in every picker on this board, live; a workshop
// other chapters already draw on says so instead, because it cannot draw on
// another itself.
export function SharedWorkshopCard({
  workshopId,
  shared,
  onChanged,
}: {
  workshopId: string;
  shared: {
    common: { id: string; title: string } | null;
    choices: Array<{ id: string; title: string }>;
    chapters: Array<{ id: string; title: string }>;
  };
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(commonWorkshopId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/workshops/${workshopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commonWorkshopId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "That could not be changed.");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AsideCard
      title="Shared workshop"
      icon={<GameIcon icon={{ kind: "glyph", key: "system-cast" }} size="size-7" />}
      tour="storyboard-shared"
    >
      {shared.chapters.length ? (
        <p className="text-xs text-stone-400">
          {shared.chapters.length === 1 ? "One chapter draws" : `${shared.chapters.length} chapters draw`} on
          this workshop: {shared.chapters.map((chapter) => chapter.title).join(", ")}. Its cast,
          places, maps and fights show in their pickers.
        </p>
      ) : (
        <>
          <p className="text-xs text-stone-400">
            Write the recurring cast, places, maps and fights once in one workshop, and let each
            chapter&apos;s cards pick from it. Picks follow the shared rows as they change. A
            campaign that imports this chapter brings what its cards pick, once, and later
            chapters reuse it.
          </p>
          <Select
            label="Draws on"
            value={shared.common?.id ?? ""}
            disabled={busy}
            onChange={(id) => void choose(id)}
            options={[
              { value: "", label: "Nothing shared" },
              ...shared.choices.map((choice) => ({
                value: choice.id,
                label: choice.title,
                icon: { kind: "glyph" as const, key: "system-storyboard" },
              })),
            ]}
          />
        </>
      )}
      {error ? <p className="motion-shake text-[11px] text-red-400">{error}</p> : null}
    </AsideCard>
  );
}

export function CompileCard({ summary }: { summary: CompileSummary }) {
  return (
    <AsideCard title="What this becomes" icon={<GameIcon icon={{ kind: "glyph", key: "tab-campaigns" }} size="size-7" />} tour="storyboard-compile">
      <p className="text-xs text-stone-400">
        {summary.lines.length
          ? `Imported into a campaign, this board becomes ${summary.lines.join(", ")}.`
          : "Nothing yet. Cards become lore, quests, prepared fights, DM notes and the story arc."}
      </p>
      {summary.arcRefusal ? (
        <p className="reveal text-[11px] text-amber-300/70">{summary.arcRefusal}</p>
      ) : null}
    </AsideCard>
  );
}
