"use client";

import { BookOpen, Check, ChevronDown, ChevronRight, Compass, Loader2, Pencil, RefreshCw, Scissors, X } from "lucide-react";
import { useState } from "react";
import type { Chapter } from "@/lib/db/chapters";
import type { StoryArc } from "@/lib/dm/arc-logic";
import { ExportMenu } from "./ExportMenu";

// Story-so-far browser: every closed chapter with its title, highlights,
// and expandable summary, plus the chapter in progress. The party lead can
// close the open chapter and touch up recorded history.
function ChapterCard({
  campaignId,
  chapter,
  isLead,
}: {
  campaignId: string;
  chapter: Chapter;
  isLead: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chapter.title);
  const [summary, setSummary] = useState(chapter.summary);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/chapters/${chapter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || chapter.title, summary }),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        )}
        <span className="min-w-0">
          <span className="block text-xs font-medium text-amber-200">
            {chapter.index}. {chapter.title || `Chapter ${chapter.index}`}
          </span>
        </span>
      </button>
      {chapter.highlights.length && !editing ? (
        <ul className="mt-1.5 space-y-0.5 pl-5">
          {(expanded ? chapter.highlights : chapter.highlights.slice(0, 2)).map(
            (highlight, index) => (
              <li key={index} className="list-disc text-[11px] leading-4 text-stone-400">
                {highlight}
              </li>
            ),
          )}
        </ul>
      ) : null}
      {expanded && !editing ? (
        <div className="mt-2 space-y-1.5 pl-5">
          {chapter.summary ? (
            <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-300">
              {chapter.summary}
            </p>
          ) : (
            <p className="text-[11px] italic text-stone-600">No summary recorded.</p>
          )}
          {isLead ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300"
            >
              <Pencil className="size-3" /> Edit
            </button>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <div className="mt-2 space-y-1.5 pl-5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600"
          />
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={6}
            maxLength={4000}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-300 hover:bg-stone-900"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTitle(chapter.title);
                setSummary(chapter.summary);
              }}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-900"
            >
              <X className="size-3" /> Cancel
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

// Lead-only view of the DM's secret story arc: the main beats the AI is
// steering by plus the open quest threads. Read-only, with a regenerate
// escape hatch when the arc no longer fits where the table took the story.
function ArcCard({ campaignId }: { campaignId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [arc, setArc] = useState<StoryArc | null>(null);
  const [outline, setOutline] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/arc`);
      if (response.ok) {
        const data = (await response.json()) as { arc: StoryArc | null; dmOutline: string };
        setArc(data.arc);
        setOutline(data.dmOutline);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      void load();
    }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/arc`, { method: "POST" });
    } finally {
      // The arc is written on the DM queue; a short hold avoids
      // double-submits, then the view refetches.
      setTimeout(() => {
        setRegenerating(false);
        void load();
      }, 6_000);
    }
  }

  const openThreads = arc?.subArcs.filter(
    (subArc) => subArc.status === "active" || subArc.status === "pending",
  );
  const cast = arc?.cast.filter((npc) => npc.status === "active");
  const plannedEvents = arc?.events.filter((event) => event.status === "pending");
  // Beats carry their act, so the flat list renders as act groups while the
  // displayed numbers stay the arc's own 1-based beat numbers.
  const actGroups = arc
    ? Array.from(new Set(arc.beats.map((beat) => beat.act))).sort((a, b) => a - b)
    : [];
  // Acts still ahead exist only as saga sketches; they render as muted rows
  // below the detailed acts.
  const aheadSketches =
    arc?.saga?.sketches.filter((sketch) => sketch.status === "sketch" && sketch.act > arc.acts) ??
    [];
  const currentAct = arc
    ? (arc.beats.find((beat) => beat.status === "active")?.act ?? arc.acts)
    : 0;

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <button type="button" onClick={toggle} className="flex w-full items-start gap-1.5 text-left">
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        )}
        <span className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
          <Compass className="size-3.5 text-amber-600" /> DM story arc (secret)
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 space-y-2 pl-5">
          {loading ? (
            <p className="flex items-center gap-1 text-[11px] text-stone-500">
              <Loader2 className="size-3 animate-spin" /> Loading...
            </p>
          ) : arc ? (
            <>
              {arc.saga ? (
                <p className="text-[11px] font-medium leading-4 text-amber-200">
                  {arc.saga.sagaIndex > 1 ? `Saga ${arc.saga.sagaIndex} (sequel): ` : ""}
                  &ldquo;{arc.saga.title}&rdquo;
                  <span className="font-normal text-stone-400">
                    {" "}
                    &middot; act {currentAct} of {arc.saga.plannedActs}
                  </span>
                </p>
              ) : null}
              <p className="text-[11px] leading-4 text-stone-300">{arc.premise}</p>
              {arc.stakes ? (
                <p className="text-[11px] leading-4 text-stone-400">Stakes: {arc.stakes}</p>
              ) : null}
              {arc.antagonist ? (
                <p className="text-[11px] leading-4 text-stone-400">Antagonist: {arc.antagonist}</p>
              ) : null}
              {actGroups.map((act) => (
                <div key={act}>
                  <p className="text-[11px] font-medium text-stone-400">Act {act}</p>
                  <ol className="mt-0.5 space-y-0.5">
                    {arc.beats.map((beat, index) =>
                      beat.act === act ? (
                        <li
                          key={index}
                          className={`text-[11px] leading-4 ${
                            beat.status === "done" || beat.status === "skipped"
                              ? "text-stone-600 line-through"
                              : beat.status === "active"
                                ? "text-amber-200"
                                : "text-stone-400"
                          }`}
                        >
                          {index + 1}. {beat.status === "active" ? "(now) " : ""}
                          {beat.status === "skipped" ? "(skipped) " : ""}
                          {beat.text}
                          {beat.detail ? (
                            <span className="text-stone-500"> [{beat.detail}]</span>
                          ) : null}
                        </li>
                      ) : null,
                    )}
                  </ol>
                </div>
              ))}
              {aheadSketches.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-500">Acts ahead (sketches)</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {aheadSketches.map((sketch) => (
                      <li key={sketch.act} className="list-none text-[11px] leading-4 text-stone-500">
                        Act {sketch.act}: {sketch.milestone}
                        {sketch.boss ? (
                          <span className="text-stone-600"> &middot; boss: {sketch.boss.name}</span>
                        ) : null}
                        {sketch.allies.length ? (
                          <span className="text-stone-600">
                            {" "}
                            &middot; {sketch.allies.length} planned all
                            {sketch.allies.length === 1 ? "y" : "ies"}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {arc.finale ? (
                <p className="text-[11px] leading-4 text-stone-400">
                  Finale: {arc.finale}
                  {arc.saga?.finaleBoss ? (
                    <span className="text-stone-500">
                      {" "}
                      &middot; final boss: {arc.saga.finaleBoss.name}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {cast?.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-400">Recurring cast</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {cast.map((npc) => (
                      <li key={npc.id} className="list-none text-[11px] leading-4 text-stone-400">
                        {npc.name}
                        {npc.role ? `, ${npc.role}` : ""}
                        {npc.agenda ? (
                          <span className="text-stone-500"> wants: {npc.agenda}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {plannedEvents?.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-400">
                    Planned events (may never fire)
                  </p>
                  <ul className="mt-0.5 space-y-0.5">
                    {plannedEvents.map((event) => (
                      <li key={event.id} className="list-none text-[11px] leading-4 text-stone-400">
                        {event.name}
                        <span className="text-stone-500">
                          {" "}
                          [{event.kind.replaceAll("_", " ")}]
                          {event.trigger ? ` when ${event.trigger}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {openThreads?.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-400">Open threads</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {openThreads.map((subArc) => (
                      <li key={subArc.id} className="list-none text-[11px] leading-4 text-stone-400">
                        {subArc.name}: {subArc.goal}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {arc.saga?.priorSagas.length ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-500">Previous sagas</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {arc.saga.priorSagas.map((prior, index) => (
                      <li key={index} className="list-none text-[11px] leading-4 text-stone-500">
                        &ldquo;{prior.title}&rdquo;
                        {prior.resolution ? (
                          <span className="text-stone-600"> &middot; {prior.resolution}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : outline ? (
            <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-400">{outline}</p>
          ) : (
            <p className="text-[11px] italic text-stone-600">
              No story arc yet. It is written when the adventure begins, or generate one now.
            </p>
          )}
          {!loading ? (
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              title="Discard the current arc and have the DM plot a fresh one from the premise"
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
            >
              {regenerating ? (
                <>
                  <Loader2 className="size-3 animate-spin" /> Plotting a new arc...
                </>
              ) : (
                <>
                  <RefreshCw className="size-3" /> Regenerate arc
                </>
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function StoryPanel({
  campaignId,
  chapters,
  isLead,
}: {
  campaignId: string;
  chapters: Chapter[];
  isLead: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const closed = chapters.filter((chapter) => chapter.status === "closed");
  const open = chapters.find((chapter) => chapter.status === "open");

  async function closeChapter() {
    setClosing(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/chapters`, { method: "POST" });
    } finally {
      // The chapter_closed event updates the list; a short hold avoids
      // double-submits while the summary is being written.
      setTimeout(() => setClosing(false), 4_000);
    }
  }

  if (!closed.length && !open) {
    return (
      <div className="space-y-2">
        {isLead ? <ArcCard campaignId={campaignId} /> : null}
        <p className="px-1 py-6 text-center text-xs text-stone-600">
          The story has not begun. Chapters appear here as the adventure unfolds.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {isLead ? <ArcCard campaignId={campaignId} /> : null}
      <ExportMenu campaignId={campaignId} />
      <div className="rounded-lg border border-dashed border-stone-800 p-2.5">
        <p className="flex items-center gap-1.5 text-xs text-stone-400">
          <BookOpen className="size-3.5 text-amber-600" />
          Chapter {open?.index ?? closed.length + 1} in progress
        </p>
        {isLead ? (
          <button
            type="button"
            onClick={closeChapter}
            disabled={closing}
            title="Seal this chapter; the DM writes its title and summary"
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
          >
            {closing ? (
              <>
                <Loader2 className="size-3 animate-spin" /> Writing the chapter...
              </>
            ) : (
              <>
                <Scissors className="size-3" /> Close chapter
              </>
            )}
          </button>
        ) : null}
      </div>
      <ol className="space-y-2">
        {[...closed].reverse().map((chapter) => (
          <ChapterCard
            key={chapter.id}
            campaignId={campaignId}
            chapter={chapter}
            isLead={isLead}
          />
        ))}
      </ol>
    </div>
  );
}
