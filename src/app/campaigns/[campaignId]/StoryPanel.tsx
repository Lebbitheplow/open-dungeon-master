"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, Compass, Crosshair, Loader2, Pencil, Plus, RefreshCw, Rewind, Scissors, SkipForward, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { Chapter } from "@/lib/db/chapters";
import type { StoryArc } from "@/lib/dm/arc-logic";
import { MAX_BEAT_TEXT, type BeatEdit } from "@/lib/dm/arc-edit-logic";
import { offersStoryModel, useCapabilities } from "@/lib/use-capabilities";
import { ExportMenu } from "./ExportMenu";
import { NpcReviewPanel } from "./NpcReviewPanel";

// Confirmation for a chapter rewind (the server answered 409 with the
// consequences). Rewinds are destructive: everything after the boundary is
// deleted and the world snaps back to how it stood.
function ConfirmRewindDialog({
  chapterIndex,
  warnings,
  busy,
  onConfirm,
  onCancel,
}: {
  chapterIndex: number;
  warnings: string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <AlertDialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <AlertDialog.Title className="font-display text-lg tracking-wide text-amber-50">
            Rewind to Chapter {chapterIndex}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-xs text-stone-400">
            The story returns to the start of Chapter {chapterIndex}. Sheets, NPCs, facts, and the
            world roll back with it. This cannot be undone.
          </AlertDialog.Description>
          <ul className="mt-2 space-y-1">
            {warnings.slice(0, 8).map((warning, index) => (
              <li key={index} className="text-[11px] leading-4 text-amber-300/80">
                {warning}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel className={ui.btnSmall}>Cancel</AlertDialog.Cancel>
            <button type="button" onClick={onConfirm} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Rewind
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// Story-so-far browser: every closed chapter with its title, highlights,
// and expandable summary, plus the chapter in progress. The party lead can
// close the open chapter and touch up recorded history.
function ChapterCard({
  campaignId,
  chapter,
  steersStory,
  onRewind,
}: {
  campaignId: string;
  chapter: Chapter;
  steersStory: boolean;
  onRewind?: () => void;
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
          {steersStory ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300"
              >
                <Pencil className="size-3" /> Edit
              </button>
              {onRewind ? (
                <button
                  type="button"
                  onClick={onRewind}
                  title="Rewind the whole campaign to the start of this chapter"
                  className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-amber-300"
                >
                  <Rewind className="size-3" /> Rewind to start
                </button>
              ) : null}
            </div>
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


// Lead-only NPC roster hygiene, collapsed by default so it costs nothing
// until asked for: the panel fetches the roster the moment it mounts.
function NpcReviewCard({ campaignId }: { campaignId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        )}
        <span className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
          <Users className="size-3.5 text-amber-600" /> NPC roster
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 pl-5">
          <NpcReviewPanel campaignId={campaignId} />
        </div>
      ) : null}
    </div>
  );
}

// Lead-only view of the DM's secret story arc: the main beats the AI is
// steering by plus the open quest threads, editable a beat at a time, with a
// regenerate escape hatch for when the whole spine no longer fits.
//
// Beats that already played are deliberately not editable. They are a record
// of what happened at the table rather than a plan, and the server refuses
// those edits regardless; the UI just does not offer them.
function ArcCard({ campaignId }: { campaignId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [arc, setArc] = useState<StoryArc | null>(null);
  const [outline, setOutline] = useState("");
  // 1-based beat number being renamed, or an act number being added to.
  const [editingBeat, setEditingBeat] = useState<number | null>(null);
  const [addingToAct, setAddingToAct] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [beatBusy, setBeatBusy] = useState(false);
  const [beatError, setBeatError] = useState("");
  // Plotting an arc is the story model's work; with none configured the
  // button and the promise that one gets written both go.
  const canPlot = offersStoryModel(useCapabilities());

  async function editBeat(edit: BeatEdit) {
    setBeatBusy(true);
    setBeatError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/arc`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBeatError(data.error ?? "That edit did not go through.");
        return false;
      }
      setArc(data.arc);
      return true;
    } catch {
      setBeatError("That edit did not go through.");
      return false;
    } finally {
      setBeatBusy(false);
    }
  }

  function closeEditor() {
    setEditingBeat(null);
    setAddingToAct(null);
    setDraft("");
    setBeatError("");
  }

  async function submitDraft() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    const edit: BeatEdit =
      addingToAct !== null
        ? { op: "add", act: addingToAct, text }
        : { op: "rename", beat: editingBeat ?? 0, text };
    if (await editBeat(edit)) {
      closeEditor();
    }
  }

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
                    {arc.beats.map((beat, index) => {
                      if (beat.act !== act) {
                        return null;
                      }
                      const number = index + 1;
                      const settled = beat.status === "done" || beat.status === "skipped";
                      if (editingBeat === number) {
                        return (
                          <li key={index} className="list-none">
                            <input
                              value={draft}
                              autoFocus
                              maxLength={MAX_BEAT_TEXT}
                              onChange={(event) => setDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void submitDraft();
                                } else if (event.key === "Escape") {
                                  closeEditor();
                                }
                              }}
                              className={cn(ui.input, "px-2 py-1 text-[11px]")}
                            />
                            <div className="mt-1 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void submitDraft()}
                                disabled={beatBusy || !draft.trim()}
                                className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                              >
                                <Check className="size-3" /> Save
                              </button>
                              <button
                                type="button"
                                onClick={closeEditor}
                                className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                              >
                                Cancel
                              </button>
                            </div>
                          </li>
                        );
                      }
                      return (
                        <li
                          key={index}
                          className={`group flex items-start gap-1 text-[11px] leading-4 ${
                            settled
                              ? "text-stone-600 line-through"
                              : beat.status === "active"
                                ? "text-amber-200"
                                : "text-stone-400"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            {number}. {beat.status === "active" ? "(now) " : ""}
                            {beat.status === "skipped" ? "(skipped) " : ""}
                            {beat.text}
                            {beat.detail ? (
                              <span className="text-stone-500"> [{beat.detail}]</span>
                            ) : null}
                          </span>
                          {settled ? null : (
                            <span className="flex shrink-0 items-center">
                              {beat.status === "active" ? null : (
                                <button
                                  type="button"
                                  disabled={beatBusy}
                                  onClick={() => void editBeat({ op: "setNow", beat: number })}
                                  className={cn(ui.iconAction, "p-1")}
                                  title="Make this the beat in play"
                                  aria-label="Make this the beat in play"
                                >
                                  <Crosshair className="size-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={beatBusy}
                                onClick={() =>
                                  void editBeat({ op: "move", beat: number, direction: "up" })
                                }
                                className={cn(ui.iconAction, "p-1")}
                                title="Move up"
                                aria-label="Move up"
                              >
                                <ArrowUp className="size-3" />
                              </button>
                              <button
                                type="button"
                                disabled={beatBusy}
                                onClick={() =>
                                  void editBeat({ op: "move", beat: number, direction: "down" })
                                }
                                className={cn(ui.iconAction, "p-1")}
                                title="Move down"
                                aria-label="Move down"
                              >
                                <ArrowDown className="size-3" />
                              </button>
                              <button
                                type="button"
                                disabled={beatBusy}
                                onClick={() => {
                                  closeEditor();
                                  setEditingBeat(number);
                                  setDraft(beat.text);
                                }}
                                className={cn(ui.iconAction, "p-1")}
                                title="Reword this beat"
                                aria-label="Reword this beat"
                              >
                                <Pencil className="size-3" />
                              </button>
                              <button
                                type="button"
                                disabled={beatBusy}
                                onClick={() => void editBeat({ op: "skip", beat: number })}
                                className={cn(ui.iconAction, "p-1")}
                                title="Skip this beat"
                                aria-label="Skip this beat"
                              >
                                <SkipForward className="size-3" />
                              </button>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {addingToAct === act ? (
                    <div className="mt-1">
                      <input
                        value={draft}
                        autoFocus
                        maxLength={MAX_BEAT_TEXT}
                        placeholder="What happens in this beat"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void submitDraft();
                          } else if (event.key === "Escape") {
                            closeEditor();
                          }
                        }}
                        className={cn(ui.input, "px-2 py-1 text-[11px]")}
                      />
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void submitDraft()}
                          disabled={beatBusy || !draft.trim()}
                          className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                        >
                          <Check className="size-3" /> Add
                        </button>
                        <button
                          type="button"
                          onClick={closeEditor}
                          className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        closeEditor();
                        setAddingToAct(act);
                      }}
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-stone-600 hover:text-amber-200"
                    >
                      <Plus className="size-3" /> Add a beat
                    </button>
                  )}
                </div>
              ))}
              {beatError ? <p className="text-[11px] text-red-400">{beatError}</p> : null}
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
              {canPlot
                ? "No story arc yet. It is written when the adventure begins, or generate one now."
                : "No story arc yet."}
            </p>
          )}
          {!loading && canPlot ? (
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
  steersStory,
}: {
  campaignId: string;
  chapters: Chapter[];
  steersStory: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const [rewindable, setRewindable] = useState<number[]>([]);
  const [rewindTarget, setRewindTarget] = useState<{
    chapterIndex: number;
    warnings: string[];
  } | null>(null);
  const [rewindBusy, setRewindBusy] = useState(false);
  const closed = chapters.filter((chapter) => chapter.status === "closed");
  const open = chapters.find((chapter) => chapter.status === "open");

  // Which chapters have a boundary snapshot to rewind to; lead-only UI.
  useEffect(() => {
    if (!steersStory) {
      return;
    }
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/chapters`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.rewindableChapters)) {
          setRewindable(data.rewindableChapters as number[]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId, steersStory, chapters.length]);

  async function postRewind(chapterIndex: number, confirm: boolean) {
    setRewindBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/chapters/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterIndex, confirm }),
      });
      if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        setRewindTarget({
          chapterIndex,
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        });
        return;
      }
      // Success or failure, the confirm dialog is done; the campaign_rewound
      // event reloads the whole view.
      setRewindTarget(null);
    } finally {
      setRewindBusy(false);
    }
  }

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
        {steersStory ? <ArcCard campaignId={campaignId} /> : null}
        {steersStory ? <NpcReviewCard campaignId={campaignId} /> : null}
        <p className="px-1 py-6 text-center text-xs text-stone-600">
          The story has not begun. Chapters appear here as the adventure unfolds.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {steersStory ? <ArcCard campaignId={campaignId} /> : null}
      {steersStory ? <NpcReviewCard campaignId={campaignId} /> : null}
      <ExportMenu campaignId={campaignId} />
      <div className="rounded-lg border border-dashed border-stone-800 p-2.5">
        <p className="flex items-center gap-1.5 text-xs text-stone-400">
          <BookOpen className="size-3.5 text-amber-600" />
          Chapter {open?.index ?? closed.length + 1} in progress
        </p>
        {steersStory ? (
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
        {steersStory && open && rewindable.includes(open.index) ? (
          <button
            type="button"
            onClick={() => void postRewind(open.index, false)}
            disabled={rewindBusy}
            title="Discard this chapter's progress and return to how it began"
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
          >
            <Rewind className="size-3" /> Restart this chapter
          </button>
        ) : null}
      </div>
      <ol className="space-y-2">
        {[...closed].reverse().map((chapter) => (
          <ChapterCard
            key={chapter.id}
            campaignId={campaignId}
            chapter={chapter}
            steersStory={steersStory}
            onRewind={
              steersStory && rewindable.includes(chapter.index)
                ? () => void postRewind(chapter.index, false)
                : undefined
            }
          />
        ))}
      </ol>
      {rewindTarget ? (
        <ConfirmRewindDialog
          chapterIndex={rewindTarget.chapterIndex}
          warnings={rewindTarget.warnings}
          busy={rewindBusy}
          onConfirm={() => void postRewind(rewindTarget.chapterIndex, true)}
          onCancel={() => setRewindTarget(null)}
        />
      ) : null}
    </div>
  );
}
