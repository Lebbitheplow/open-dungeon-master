"use client";

import { EmptyState } from "@/components/EmptyState";
import { useEffect, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { PanelLoading } from "./PanelKit";
import type { TimelineKind, TimelineRow } from "@/lib/dm/timeline-logic";

// The campaign on one axis (docs/vtt-parity-implementation-plan.md 5.5):
// chapters, facts, sessions and the world's arcs in story order with the
// party marker at now. A list below lg; two columns about a gold rule
// above it. Filters by kind; read-only.

const KIND_LABEL: Record<TimelineKind, string> = {
  chapter: "Chapters",
  fact: "Facts",
  session: "Sessions",
  arc: "World arcs",
  event: "Calendar",
  now: "Now",
};

const KIND_GLYPH: Record<TimelineKind, string> = {
  chapter: "tab-story",
  fact: "tab-facts",
  session: "tab-session",
  arc: "system-storyboard",
  event: "daypart-day",
  now: "tab-map",
};

const KIND_TONE: Record<TimelineKind, string> = {
  chapter: "border-amber-700/60 text-amber-200",
  fact: "border-stone-700 text-stone-300",
  session: "border-sky-800/60 text-sky-200",
  arc: "border-violet-800/60 text-violet-200",
  event: "border-emerald-800/60 text-emerald-200",
  now: "border-amber-400 bg-amber-950/60 text-amber-100 shadow-glow-gold",
};

export function TimelinePanel({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const [rows, setRows] = useState<TimelineRow[] | null>(null);
  const [hidden, setHidden] = useState<Set<TimelineKind>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/timeline`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { rows?: TimelineRow[] } | null) => {
        if (!cancelled) {
          setRows(data?.rows ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, refreshKey]);

  if (rows === null) {
    return <PanelLoading label="Laying out the years..." />;
  }
  const kinds = (Object.keys(KIND_LABEL) as TimelineKind[]).filter((kind) => kind !== "now" && rows.some((row) => row.kind === kind));
  const shown = rows.filter((row) => !hidden.has(row.kind));
  return (
    <div className="space-y-3">
      <SectionHead title="Timeline" glyph="tab-timeline" aside={shown.length > 1 ? shown.length - 1 : null} />
      {kinds.length ? (
        <div role="group" aria-label="Show on the line" className="reveal flex flex-wrap items-center gap-1">
          {kinds.map((kind) => {
            const on = !hidden.has(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(kind)) {
                      next.delete(kind);
                    } else {
                      next.add(kind);
                    }
                    return next;
                  })
                }
                data-on={on ? "" : undefined}
                className="pk-pill pk-tap motion-press"
              >
                <GameIcon icon={{ kind: "glyph", key: KIND_GLYPH[kind] }} size="size-4" />
                {KIND_LABEL[kind]}
              </button>
            );
          })}
        </div>
      ) : null}
      {shown.length <= 1 ? (
        <EmptyState size="sm" art="scrolls" title="Nothing has happened yet. The first closed chapter starts the line." />
      ) : null}
      <ol className="stagger relative space-y-2 lg:before:absolute lg:before:bottom-0 lg:before:left-1/2 lg:before:top-0 lg:before:w-px lg:before:bg-gradient-to-b lg:before:from-amber-700/0 lg:before:via-amber-600/70 lg:before:to-amber-700/0">
        {shown.map((row, index) => {
          const left = index % 2 === 0;
          return (
            <li key={row.id} className={cn("lg:flex", left ? "lg:justify-start lg:pr-[52%]" : "lg:justify-end lg:pl-[52%]")}>
              <article
                className={cn(
                  "panel w-full rounded-lg px-2.5 py-2",
                  KIND_TONE[row.kind],
                  row.kind === "now" && "lg:w-auto lg:mx-auto",
                )}
              >
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <GameIcon icon={{ kind: "glyph", key: KIND_GLYPH[row.kind] }} size="size-5" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  {row.when ? <span className="text-[11px] font-normal text-stone-500">{row.when}</span> : null}
                  {row.secret ? <span className="text-[11px] font-normal text-violet-300">DM</span> : null}
                </p>
                {row.detail ? <p className="reveal mt-0.5 text-xs leading-5 text-stone-400">{row.detail}</p> : null}
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
