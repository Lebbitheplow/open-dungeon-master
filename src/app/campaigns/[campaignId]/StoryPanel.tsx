"use client";

import { EmptyState } from "@/components/EmptyState";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Crosshair, Loader2, Pencil, Plus, RefreshCw, Rewind, Scissors, SkipForward, X } from "lucide-react";
import { Book } from "@/components/ui/Book";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { KitButton, PanelError, PanelLoading, RowMenu, panelField } from "./PanelKit";
import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { Chapter } from "@/lib/db/chapters";
import { romanNumeral, type PublicAct, type StoryArc } from "@/lib/dm/arc-logic";
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
        <AlertDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[#05030d]/70 backdrop-blur-sm" />
        <AlertDialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <AlertDialog.Title className="gold-title font-display text-lg tracking-wide">
            Rewind to Chapter {chapterIndex}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-xs text-stone-400">
            The story returns to the start of Chapter {chapterIndex}. Sheets, NPCs, facts, and the
            world roll back with it. This cannot be undone.
          </AlertDialog.Description>
          <ul className="stagger mt-2 space-y-1">
            {warnings.slice(0, 8).map((warning, index) => (
              <li key={index} className="text-xs leading-5 text-amber-300/80">
                {warning}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel className={ui.btnSmall}>Cancel</AlertDialog.Cancel>
            <button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Rewind
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// The rule between acts in the chapter list: the act's number in small
// caps on a gold hairline, its name, and the recap the table heard when
// it ended. Reveals with the list's stagger.
function ActHeading({ act, title, recap }: { act: number; title: string; recap: string }) {
  return (
    <li className="reveal pt-2">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-500/60" aria-hidden="true" />
        <span className="font-display text-[11px] uppercase tracking-[0.22em] text-amber-300">
          Act {romanNumeral(act)}
        </span>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-500/60" aria-hidden="true" />
      </div>
      {title ? <p className="mt-1 text-center font-display text-base text-amber-100">{title}</p> : null}
      {recap ? <p className="mt-1 text-center text-xs leading-5 text-stone-400">{recap}</p> : null}
    </li>
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
    <li className="panel group rounded-lg p-2.5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="pk-tap flex w-full items-start gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 motion-press"
      >
        {expanded ? (
          <ChevronDown className="mt-1 size-3.5 shrink-0 text-amber-400/80" />
        ) : (
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-amber-400/80" />
        )}
        <span className="min-w-0">
          <span className="gold-title block font-display text-sm">
            {chapter.index}. {chapter.title || `Chapter ${chapter.index}`}
          </span>
        </span>
      </button>
      {chapter.highlights.length && !editing ? (
        <ul className="reveal mt-1.5 space-y-0.5 pl-5">
          {(expanded ? chapter.highlights : chapter.highlights.slice(0, 2)).map(
            (highlight, index) => (
              <li key={index} className="list-disc text-xs leading-5 text-stone-400">
                {highlight}
              </li>
            ),
          )}
        </ul>
      ) : null}
      {expanded && !editing ? (
        <div className="reveal mt-2 space-y-1.5 pl-5">
          {chapter.summary ? (
            <p className="reveal whitespace-pre-wrap font-serif text-xs leading-5 text-stone-300">
              {chapter.summary}
            </p>
          ) : (
            <p className="text-xs italic text-stone-500">No summary recorded.</p>
          )}
          {steersStory ? (
            <div className="reveal flex flex-wrap items-center gap-1.5">
              <KitButton onClick={() => setEditing(true)}>
                <Pencil className="size-3" /> Edit
              </KitButton>
              {onRewind ? (
                <KitButton tone="danger" onClick={onRewind} title="Rewind the whole campaign to the start of this chapter">
                  <Rewind className="size-3" /> Rewind to start
                </KitButton>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <div className="reveal mt-2 space-y-1.5 pl-5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            aria-label="Chapter title"
            className={panelField}
          />
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={6}
            maxLength={4000}
            aria-label="Chapter summary"
            className={cn(panelField, "leading-5")}
          />
          <div className="flex gap-1.5">
            <KitButton tone="primary" onClick={save} disabled={busy} busy={busy}>
              {busy ? null : <Check className="size-3.5" />}
              Save
            </KitButton>
            <KitButton
              onClick={() => {
                setEditing(false);
                setTitle(chapter.title);
                setSummary(chapter.summary);
              }}
            >
              <X className="size-3.5" /> Cancel
            </KitButton>
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
    <div className="panel rounded-lg p-2.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="pk-tap flex w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 motion-press"
      >
        {expanded ? (
          <ChevronDown className="mt-1 size-3.5 shrink-0 text-amber-400/80" />
        ) : (
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-amber-400/80" />
        )}
        <span className="flex items-center gap-1.5">
          <GameIcon icon={{ kind: "glyph", key: "system-cast" }} size="size-6" />
          <span className="section-head-title">NPC roster</span>
        </span>
      </button>
      {expanded ? (
        <div className="reveal mt-2 pl-5">
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
    <div className="panel ornate rounded-lg p-2.5">
      <button type="button" onClick={toggle} aria-expanded={expanded} className="pk-tap flex w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 motion-press">
        {expanded ? (
          <ChevronDown className="mt-1 size-3.5 shrink-0 text-amber-400/80" />
        ) : (
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-amber-400/80" />
        )}
        <span className="flex items-center gap-1.5">
          <GameIcon icon={{ kind: "glyph", key: "system-storyboard" }} size="size-6" />
          <span className="section-head-title">DM story arc (secret)</span>
        </span>
      </button>
      {expanded ? (
        <div className="reveal mt-2 space-y-2 pl-5">
          {loading ? (
            <PanelLoading label="Loading..." rows={2} />
          ) : arc ? (
            <>
              {arc.saga ? (
                <p className="reveal text-[11px] font-medium leading-4 text-amber-200">
                  {arc.saga.sagaIndex > 1 ? `Saga ${arc.saga.sagaIndex} (sequel): ` : ""}
                  &ldquo;{arc.saga.title}&rdquo;
                  <span className="font-normal text-stone-400">
                    {" "}
                    &middot; act {currentAct} of {arc.saga.plannedActs}
                  </span>
                </p>
              ) : null}
              <p className="text-xs leading-5 text-stone-300">{arc.premise}</p>
              {arc.stakes ? (
                <p className="reveal text-xs leading-5 text-stone-400">Stakes: {arc.stakes}</p>
              ) : null}
              {arc.antagonist ? (
                <p className="reveal text-xs leading-5 text-stone-400">Antagonist: {arc.antagonist}</p>
              ) : null}
              {actGroups.map((act) => (
                <div key={act}>
                  <SectionHead title={`Act ${act}`} glyph="tab-story" level="h4" className="mb-1" />
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
                              className={panelField}
                            />
                            <div className="mt-1 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void submitDraft()}
                                disabled={beatBusy || !draft.trim()}
                                className={cn(ui.btnSmall, "pk-tap px-2.5 py-1 text-xs")}
                              >
                                <Check className="size-3" /> Save
                              </button>
                              <button
                                type="button"
                                onClick={closeEditor}
                                className={cn(ui.btnSmall, "pk-tap px-2.5 py-1 text-xs")}
                              >
                                Cancel
                              </button>
                            </div>
                          </li>
                        );
                      }
                      const beatItems: ContextMenuItem[] = settled
                        ? []
                        : [
                            ...(beat.status === "active"
                              ? []
                              : [{ id: "now", label: "Make this the beat in play", glyph: "quest-active", disabled: beatBusy, onSelect: () => void editBeat({ op: "setNow", beat: number }) }]),
                            { id: "up", label: "Move up", glyph: "pace-fast", disabled: beatBusy, onSelect: () => void editBeat({ op: "move", beat: number, direction: "up" }) },
                            { id: "down", label: "Move down", glyph: "pace-slow", disabled: beatBusy, onSelect: () => void editBeat({ op: "move", beat: number, direction: "down" }) },
                            {
                              id: "reword",
                              label: "Reword this beat",
                              glyph: "tab-notes",
                              disabled: beatBusy,
                              onSelect: () => {
                                closeEditor();
                                setEditingBeat(number);
                                setDraft(beat.text);
                              },
                            },
                            { id: "skip", label: "Skip this beat", glyph: "quest-failed", separated: true, disabled: beatBusy, onSelect: () => void editBeat({ op: "skip", beat: number }) },
                          ];
                      return (
                        <ContextMenu
                          as="li"
                          items={beatItems}
                          label={`Beat ${number}`}
                          key={index}
                          className={`group flex items-start gap-1 text-xs leading-5 ${
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
                            {/* The beat's checklist: the server ticks these from the DM's tools; the lead corrects it by hand. */}
                            {!settled && beat.waypoints?.length ? (
                              <ul className="stagger mt-1 space-y-0.5">
                                {beat.waypoints.map((waypoint, at) => (
                                  <li key={at}>
                                    <label className="flex cursor-pointer items-start gap-1.5 text-[11px] leading-4 text-stone-400">
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 size-3 shrink-0 accent-amber-400"
                                        checked={waypoint.done}
                                        disabled={beatBusy}
                                        aria-label={`Waypoint: ${waypoint.text}`}
                                        onChange={(event) =>
                                          void editBeat({ op: "waypoint", beat: number, index: at, done: event.target.checked })
                                        }
                                      />
                                      <span className={waypoint.done ? "text-stone-600 line-through" : ""}>
                                        {waypoint.text} <span className="text-stone-600">({waypoint.kind})</span>
                                      </span>
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </span>
                          {settled ? null : (
                            <span className="flex shrink-0 items-center">
                              {/* A mouse gets the five on hover; a finger gets the kebab and the long press. */}
                              <span className="flex items-center [@media(pointer:coarse)]:hidden">
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
                              <RowMenu items={beatItems} label={`Beat ${number}`} className="p-1" />
                            </span>
                          )}
                        </ContextMenu>
                      );
                    })}
                  </ol>
                  {addingToAct === act ? (
                    <div className="reveal mt-1">
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
                        className={panelField}
                      />
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void submitDraft()}
                          disabled={beatBusy || !draft.trim()}
                          className={cn(ui.btnSmall, "pk-tap px-2.5 py-1 text-xs")}
                        >
                          <Check className="size-3" /> Add
                        </button>
                        <button
                          type="button"
                          onClick={closeEditor}
                          className={cn(ui.btnSmall, "pk-tap px-2.5 py-1 text-xs")}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <KitButton
                      tone="link"
                      onClick={() => {
                        closeEditor();
                        setAddingToAct(act);
                      }}
                      className="mt-0.5"
                    >
                      <Plus className="size-3" /> Add a beat
                    </KitButton>
                  )}
                </div>
              ))}
              {beatError ? <PanelError>{beatError}</PanelError> : null}
              {aheadSketches.length ? (
                <div>
                  <SectionHead title="Acts ahead (sketches)" glyph="quest-hidden" level="h4" className="mb-1" />
                  <ul className="mt-0.5 space-y-0.5">
                    {aheadSketches.map((sketch) => (
                      <li key={sketch.act} className="list-none text-xs leading-5 text-stone-500">
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
                <p className="reveal text-xs leading-5 text-stone-400">
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
                  <SectionHead title="Recurring cast" glyph="system-cast" level="h4" className="mb-1" />
                  <ul className="mt-0.5 space-y-0.5">
                    {cast.map((npc) => (
                      <li key={npc.id} className="list-none text-xs leading-5 text-stone-400">
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
                  <SectionHead title="Planned events (may never fire)" glyph="tab-timeline" level="h4" className="mb-1" />
                  <ul className="mt-0.5 space-y-0.5">
                    {plannedEvents.map((event) => (
                      <li key={event.id} className="list-none text-xs leading-5 text-stone-400">
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
                  <SectionHead title="Open threads" glyph="quest-active" level="h4" className="mb-1" />
                  <ul className="mt-0.5 space-y-0.5">
                    {openThreads.map((subArc) => (
                      <li key={subArc.id} className="list-none text-xs leading-5 text-stone-400">
                        {subArc.name}: {subArc.goal}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {arc.saga?.priorSagas.length ? (
                <div>
                  <SectionHead title="Previous sagas" glyph="quest-done" level="h4" className="mb-1" />
                  <ul className="mt-0.5 space-y-0.5">
                    {arc.saga.priorSagas.map((prior, index) => (
                      <li key={index} className="list-none text-xs leading-5 text-stone-500">
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
            <p className="reveal whitespace-pre-wrap text-xs leading-5 text-stone-400">{outline}</p>
          ) : (
            <EmptyState size="sm" art="scrolls" title={canPlot ? "No story arc yet. It is written when the adventure begins, or generate one now." : "No story arc yet."} />
          )}
          {!loading && canPlot ? (
            <KitButton onClick={regenerate} disabled={regenerating} title="Discard the current arc and have the DM plot a fresh one from the premise">
              {regenerating ? (
                <>
                  <Loader2 className="size-3 animate-spin" /> Plotting a new arc...
                </>
              ) : (
                <>
                  <RefreshCw className="size-3" /> Regenerate arc
                </>
              )}
            </KitButton>
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
  const [reading, setReading] = useState(false);
  // The acts the table has been told about: names and recaps for the
  // headings between chapters (issue #31). Player-safe by construction.
  const [acts, setActs] = useState<PublicAct[]>([]);
  const closed = chapters.filter((chapter) => chapter.status === "closed");
  const open = chapters.find((chapter) => chapter.status === "open");

  // The acts for everyone; which chapters have a boundary snapshot to
  // rewind to is lead-only UI and only arrives for the lead.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/chapters`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) {
          return;
        }
        if (Array.isArray(data.acts)) {
          setActs(data.acts as PublicAct[]);
        }
        if (steersStory && Array.isArray(data.rewindableChapters)) {
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
        <EmptyState art="scrolls" size="sm" title="The story has not begun" hint="Chapters appear here as the adventure unfolds." />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {steersStory ? <ArcCard campaignId={campaignId} /> : null}
      {steersStory ? <NpcReviewCard campaignId={campaignId} /> : null}
      <ExportMenu campaignId={campaignId} />
      {closed.length ? (
        <KitButton tone="secondary" onClick={() => setReading(true)} title="Read the closed chapters as a book, one spread each" className="h-10 w-full border-amber-500/50 text-amber-100">
          <GameIcon icon={{ kind: "glyph", key: "tab-story" }} size="size-6" /> Open the chronicle
        </KitButton>
      ) : null}
      <div className="panel rounded-lg p-2.5">
        <SectionHead
          title={`${open?.act ? `Act ${romanNumeral(open.act)}, ` : ""}Chapter ${open?.index ?? closed.length + 1} in progress`}
          glyph="tab-journal"
          className="mb-0"
        />
        {steersStory ? (
          <KitButton onClick={closeChapter} disabled={closing} title="Seal this chapter; the DM writes its title and summary" className="mt-2 w-full justify-center">
            {closing ? (
              <>
                <Loader2 className="size-3 animate-spin" /> Writing the chapter...
              </>
            ) : (
              <>
                <Scissors className="size-3" /> Close chapter
              </>
            )}
          </KitButton>
        ) : null}
        {steersStory && open && rewindable.includes(open.index) ? (
          <KitButton tone="danger" onClick={() => void postRewind(open.index, false)} disabled={rewindBusy} busy={rewindBusy} title="Discard this chapter's progress and return to how it began" className="mt-1.5 w-full justify-center">
            {rewindBusy ? null : <Rewind className="size-3" />} Restart this chapter
          </KitButton>
        ) : null}
      </div>
      <ol className="stagger space-y-2">
        {[...closed].reverse().map((chapter, index, list) => {
          // Newest first, so an act's heading sits above the newest chapter
          // of that act. Chapters sealed before acts were stamped have none
          // and run on without a heading.
          const previous = index > 0 ? list[index - 1] : null;
          const boundary =
            chapter.act !== null &&
            (!previous || previous.act !== chapter.act || (previous.saga ?? 1) !== (chapter.saga ?? 1));
          const act = boundary
            ? acts.find((entry) => entry.act === chapter.act && entry.sagaIndex === (chapter.saga ?? 1))
            : undefined;
          return (
            <Fragment key={chapter.id}>
              {boundary && chapter.act !== null ? (
                <ActHeading act={chapter.act} title={act?.title ?? ""} recap={act?.recap ?? ""} />
              ) : null}
              <ChapterCard
                campaignId={campaignId}
                chapter={chapter}
                steersStory={steersStory}
                onRewind={
                  steersStory && rewindable.includes(chapter.index)
                    ? () => void postRewind(chapter.index, false)
                    : undefined
                }
              />
            </Fragment>
          );
        })}
      </ol>
      <Book
        open={reading}
        onOpenChange={setReading}
        title="The chronicle"
        startAt={closed.length - 1}
        entries={closed.map((chapter) => ({
          id: chapter.id,
          kicker: `${chapter.act ? `Act ${romanNumeral(chapter.act)}, ` : ""}Chapter ${chapter.index}`,
          heading: chapter.title || `Chapter ${chapter.index}`,
          body: chapter.summary || "No summary was recorded for this chapter.",
          note: chapter.highlights.length ? chapter.highlights.join("\n") : undefined,
        }))}
      />
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
