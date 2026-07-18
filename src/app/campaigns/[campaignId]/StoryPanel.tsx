"use client";

import { BookOpen, Check, ChevronDown, ChevronRight, Loader2, Pencil, Scissors, X } from "lucide-react";
import { useState } from "react";
import type { Chapter } from "@/lib/db/chapters";

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
      <p className="px-1 py-6 text-center text-xs text-stone-600">
        The story has not begun. Chapters appear here as the adventure unfolds.
      </p>
    );
  }

  return (
    <div className="space-y-2">
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
