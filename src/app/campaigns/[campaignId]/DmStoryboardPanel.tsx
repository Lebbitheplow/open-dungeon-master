"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  BEAT_HINTS,
  BEAT_KINDS,
  BEAT_LABELS,
  TITLE_MAX,
  type Beat,
  type BeatKind,
  type Board,
  type BoardInventory,
  type Suggestion,
} from "@/lib/workshop/board";
import type { CompiledBoard, CompileSummary } from "@/lib/workshop/board-compile";
import { Sheet } from "@/components/ui/Sheet";
import { KIND_TONE, beatInput as input } from "@/app/workshop/storyboard/beat-fields";
import { BeatBoard } from "@/app/workshop/storyboard/BeatBoard";
import { BeatEditor } from "@/app/workshop/storyboard/BeatEditor";
import { CompileCard, SuggestionsCard } from "@/app/workshop/storyboard/BoardAsides";

// The storyboard: cards for the things that are going to happen, and arrows
// between them.
//
// Two things make it worth more than a text file. The arrows, because a hook
// with no payoff is only detectable if the board knows which way the story
// runs. And the suggestions, which are arithmetic over what is on the board
// rather than a model call, so a DM can check them and disagree.
//
// Two layouts over one set of requests. "list" is the DM console's: cards
// keep their x and y so a canvas can be added later without a migration, but
// a list is what reads on a phone, and prep gets done on a phone. "board" is
// the workshop's: the same cards as a card grid, the editor in a sheet, and
// the suggestions and the compile folded into cards beside the board.

type Payload = {
  board: Board;
  inventory: BoardInventory;
  suggestions: Suggestion[];
  compiled: CompiledBoard & { summary: CompileSummary };
};

export function DmStoryboardPanel({
  campaignId,
  layout = "list",
}: {
  campaignId: string;
  layout?: "list" | "board";
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Beat | null>(null);
  const [newKind, setNewKind] = useState<BeatKind>("hook");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const board = layout === "board";

  const load = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/storyboard`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: Payload | null) => {
          if (payload) {
            setData(payload);
          }
        })
        .catch(() => {
          // transient; the next action reloads
        }),
    [campaignId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function add(kind: BeatKind, title: string) {
    if (!title.trim()) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/storyboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "That card could not be added.");
        return;
      }
      setNewTitle("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function save(beat: Beat) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/storyboard/${beat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(beat),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "That card could not be saved.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/campaigns/${campaignId}/dm/storyboard/${id}`, { method: "DELETE" });
    if (openId === id) {
      setOpenId(null);
      setEdit(null);
    }
    await load();
  }

  function close() {
    setOpenId(null);
    setEdit(null);
  }

  if (!data) {
    return <Loader2 className="size-5 animate-spin text-stone-500" />;
  }

  const nodes = data.board.nodes;
  const nameOf = (id: string) => nodes.find((node) => node.id === id)?.title ?? "";

  // The add row is the same controls in both layouts; only the card around
  // it differs.
  const addRow = (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">Card</span>
          <select
            value={newKind}
            onChange={(event) => setNewKind(event.target.value as BeatKind)}
            className={cn(input, "w-48")}
          >
            {BEAT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {BEAT_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">In a few words</span>
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value.slice(0, TITLE_MAX))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void add(newKind, newTitle);
              }
            }}
            placeholder="The miller's daughter has not come home"
            className={cn(input, "w-full")}
          />
        </label>
        <button
          type="button"
          disabled={busy || !newTitle.trim()}
          onClick={() => void add(newKind, newTitle)}
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-3 py-1 text-xs text-amber-100 hover:bg-stone-800 disabled:opacity-40"
        >
          <Plus className="size-3.5" /> Add
        </button>
      </div>
      <p className="text-[10px] text-stone-600">{BEAT_HINTS[newKind]}</p>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </>
  );

  const editorFor = (beat: Beat, onDelete?: () => void) => (
    <BeatEditor
      edit={beat}
      onChange={setEdit}
      inventory={data.inventory}
      others={nodes.filter((other) => other.id !== beat.id)}
      busy={busy}
      onSave={() => void save(beat)}
      onDelete={onDelete}
    />
  );

  if (board) {
    const open = openId ? nodes.find((node) => node.id === openId) ?? null : null;
    return (
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-4">
          <section className={cn(ui.card, "flex flex-col gap-2 p-3")}>{addRow}</section>
          <BeatBoard
            board={data.board}
            inventory={data.inventory}
            onOpen={(node) => {
              setOpenId(node.id);
              setEdit(node);
            }}
          />
        </div>
        <div className="flex flex-col gap-3">
          <SuggestionsCard
            suggestions={data.suggestions}
            busy={busy}
            onAdd={(kind, title) => void add(kind, title)}
          />
          {nodes.length ? <CompileCard summary={data.compiled.summary} /> : null}
        </div>

        <Sheet
          open={open !== null && edit !== null}
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          title={open?.title || "Card"}
          className="lg:w-[min(92vw,40rem)]"
        >
          {open && edit ? (
            <div className="flex flex-col gap-2">
              {editorFor(edit, () => void remove(open.id))}
              {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
            </div>
          ) : null}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-stone-800 bg-stone-900/40 p-3">
        {addRow}
      </div>

      {data.suggestions.length ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-stone-800 bg-stone-900/40 p-3">
          <h3 className="flex items-center gap-1.5 text-sm text-amber-100">
            <Lightbulb className="size-4" /> What this board is missing
          </h3>
          <p className="text-[10px] text-stone-600">
            Counted, not guessed. Nothing here asked a model what your story needs.
          </p>
          {data.suggestions.map((suggestion) => (
            <div key={suggestion.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-[11px] text-stone-400">{suggestion.reason}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void add(suggestion.kind, suggestion.title)}
                className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-amber-100 disabled:opacity-40"
              >
                + {BEAT_LABELS[suggestion.kind]}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {nodes.length === 0 ? (
          <p className="text-xs text-stone-500">
            Nothing on the board. Start with a reason the party would go somewhere.
          </p>
        ) : null}
        {data.board.order.map((id) => {
          const node = nodes.find((entry) => entry.id === id);
          if (!node) {
            return null;
          }
          return (
            <div
              key={node.id}
              className={cn("rounded-lg border bg-stone-900/40", KIND_TONE[node.kind])}
            >
              <div className="flex items-center gap-2 p-2">
                <button
                  type="button"
                  onClick={() => {
                    if (openId === node.id) {
                      close();
                    } else {
                      setOpenId(node.id);
                      setEdit(node);
                    }
                  }}
                  className="flex-1 text-left"
                >
                  <span className="text-[10px] uppercase tracking-wide text-stone-500">
                    {BEAT_LABELS[node.kind]}
                  </span>
                  <span className="ml-2 text-sm text-stone-200">{node.title}</span>
                  {node.out.length ? (
                    <span className="ml-2 text-[10px] text-stone-600">
                      leads to {node.out.map(nameOf).filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(node.id)}
                  className="text-stone-600 hover:text-red-300"
                  aria-label={`Delete ${node.title}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {openId === node.id && edit ? (
                <div className="flex flex-col gap-2 border-t border-stone-800 p-3">
                  {editorFor(edit)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {nodes.length ? (
        <div className="flex flex-col gap-1 rounded-lg border border-stone-800 bg-stone-950/60 p-3">
          <h3 className="text-sm text-amber-100">What this becomes</h3>
          <p className="text-[11px] text-stone-500">
            {data.compiled.summary.lines.length
              ? `Imported into a campaign, this board becomes ${data.compiled.summary.lines.join(", ")}.`
              : "Nothing yet. Cards become lore, quests, prepared fights, DM notes and the story arc."}
          </p>
          {data.compiled.summary.arcRefusal ? (
            <p className="text-[10px] text-amber-300/70">{data.compiled.summary.arcRefusal}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
