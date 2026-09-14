"use client";

import { BookOpen, CalendarDays, Flag, Loader2, MapPin, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
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

const KIND_ICON: Record<TimelineKind, typeof BookOpen> = {
  chapter: BookOpen,
  fact: Sparkles,
  session: CalendarDays,
  arc: Flag,
  event: CalendarDays,
  now: MapPin,
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
    return (
      <p className="flex items-center gap-1 text-[11px] text-stone-500">
        <Loader2 className="size-3 animate-spin" /> Laying out the years...
      </p>
    );
  }
  const kinds = (Object.keys(KIND_LABEL) as TimelineKind[]).filter((kind) => kind !== "now" && rows.some((row) => row.kind === kind));
  const shown = rows.filter((row) => !hidden.has(row.kind));
  return (
    <div className="space-y-3">
      {kinds.length ? (
        <div className="flex flex-wrap items-center gap-1">
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
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px]",
                  on ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-stone-800 text-stone-500",
                )}
              >
                {KIND_LABEL[kind]}
              </button>
            );
          })}
        </div>
      ) : null}
      {shown.length <= 1 ? (
        <p className="text-[11px] italic text-stone-600">Nothing has happened yet. The first closed chapter starts the line.</p>
      ) : null}
      <ol className="relative space-y-2 lg:before:absolute lg:before:bottom-0 lg:before:left-1/2 lg:before:top-0 lg:before:w-px lg:before:bg-gradient-to-b lg:before:from-amber-700/0 lg:before:via-amber-600/70 lg:before:to-amber-700/0">
        {shown.map((row, index) => {
          const Icon = KIND_ICON[row.kind];
          const left = index % 2 === 0;
          return (
            <li key={row.id} className={cn("lg:flex", left ? "lg:justify-start lg:pr-[52%]" : "lg:justify-end lg:pl-[52%]")}>
              <article
                className={cn(
                  "w-full rounded-lg border bg-stone-950/50 px-2.5 py-1.5",
                  KIND_TONE[row.kind],
                  row.kind === "now" && "lg:w-auto lg:mx-auto",
                )}
              >
                <p className="flex items-center gap-1.5 text-[11px] font-medium">
                  <Icon className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  {row.when ? <span className="text-[10px] font-normal text-stone-500">{row.when}</span> : null}
                  {row.secret ? <span className="text-[10px] font-normal text-violet-300">DM</span> : null}
                </p>
                {row.detail ? <p className="mt-0.5 text-[11px] leading-4 text-stone-400">{row.detail}</p> : null}
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
