"use client";

import { BookMarked, Loader2, Pin, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  WORLD_LORE_CATEGORIES,
  type WorldLoreCategory,
} from "@/lib/dm/world-lore-logic";
import { Sheet } from "@/components/ui/Sheet";
import { LoreEntryActions } from "@/app/workshop/lore/LoreEntryActions";
import { LoreRows } from "@/app/workshop/lore/LoreRows";
import { CATEGORY_LABELS, type LoreEntryView } from "@/app/workshop/lore/types";

// World lore builder: the lead's world bible. Entries feed the DM prompt
// (pinned always, the rest retrieved by relevance) and the search_lore
// tool. Party-visible, lead-edited, usable before and during the campaign.
//
// Two layouts over one set of requests. "list" is the campaign's: entries
// grouped by category, each expanding in place, the author form inline at
// the top. "rows" is the workshop's: a search box over full-width rows, and
// the same form with the same buttons in a sheet.
export function LorePanel({
  campaignId,
  steersStory,
  layout = "list",
}: {
  campaignId: string;
  steersStory: boolean;
  layout?: "list" | "rows";
}) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LoreEntryView[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Rows only: an entry opened by somebody who cannot edit it, so they can
  // still read the whole of it.
  const [readingId, setReadingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    category: WorldLoreCategory;
    title: string;
    body: string;
    tags: string;
  }>({ category: "geography", title: "", body: "", tags: "" });
  const [busy, setBusy] = useState(false);
  const rows = layout === "rows";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/lore`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.entries)) {
          setEntries(data.entries);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  function startAdd() {
    setDraft({ category: "geography", title: "", body: "", tags: "" });
    setEditingId(null);
    setAdding(true);
  }

  function startEdit(entry: LoreEntryView) {
    setDraft({
      category: entry.category,
      title: entry.title,
      body: entry.body,
      tags: entry.tags.join(", "),
    });
    setAdding(false);
    setEditingId(entry.id);
  }

  function closeEditor() {
    setAdding(false);
    setEditingId(null);
    setReadingId(null);
  }

  async function submitDraft() {
    if (!draft.title.trim() || !draft.body.trim()) {
      return;
    }
    setBusy(true);
    try {
      const payload = {
        category: draft.category,
        title: draft.title,
        body: draft.body,
        tags: draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      const response = editingId
        ? await fetch(`/api/campaigns/${campaignId}/lore/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/campaigns/${campaignId}/lore`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (response.ok) {
        const data = await response.json();
        if (data.entry) {
          setEntries((current) =>
            editingId
              ? current.map((entry) => (entry.id === editingId ? data.entry : entry))
              : [...current, data.entry],
          );
        }
        setAdding(false);
        setEditingId(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(entry: LoreEntryView) {
    const response = await fetch(`/api/campaigns/${campaignId}/lore/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !entry.pinned }),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.entry) {
        setEntries((current) => current.map((e) => (e.id === entry.id ? data.entry : e)));
      }
    }
  }

  async function remove(entryId: string) {
    const response = await fetch(`/api/campaigns/${campaignId}/lore/${entryId}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setEntries((current) => current.filter((entry) => entry.id !== entryId));
    }
  }

  // Same create route as submitDraft, with the copy landing in the list the
  // same way a new entry does.
  async function duplicate(entry: LoreEntryView) {
    setBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/lore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: entry.category,
          title: `${entry.title} (copy)`,
          body: entry.body,
          tags: entry.tags,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.entry) {
          setEntries((current) => [...current, data.entry]);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const categories = WORLD_LORE_CATEGORIES.filter((category) =>
    entries.some((entry) => entry.category === category),
  );

  const editorOpen = adding || editingId !== null;

  // The author form is the same fields in both layouts; only what wraps it
  // differs.
  const editorForm = (
    <>
      <div className="flex gap-1.5">
        <select
          value={draft.category}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              category: event.target.value as WorldLoreCategory,
            }))
          }
          className="rounded border border-stone-700 bg-stone-900 px-1.5 py-1 text-[11px] outline-none focus:border-amber-600"
        >
          {WORLD_LORE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <input
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          maxLength={120}
          placeholder="Title (The Ashen League, The Sundering...)"
          className="flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
        />
      </div>
      <textarea
        value={draft.body}
        onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
        rows={4}
        maxLength={4000}
        placeholder="What is established about it..."
        className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
      />
      <input
        value={draft.tags}
        onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
        placeholder="Tags, comma separated (optional)"
        className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={submitDraft}
          disabled={busy || !draft.title.trim() || !draft.body.trim()}
          className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-300 hover:bg-stone-900 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          {editingId ? "Save" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            setEditingId(null);
          }}
          className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-900"
        >
          <X className="size-3" /> Cancel
        </button>
      </div>
    </>
  );

  if (rows) {
    const editing = editingId ? entries.find((entry) => entry.id === editingId) ?? null : null;
    const reading = readingId ? entries.find((entry) => entry.id === readingId) ?? null : null;
    return (
      <div className="space-y-3">
        {loading ? (
          <p className="flex items-center gap-1 text-[11px] text-stone-500">
            <Loader2 className="size-3 animate-spin" /> Loading...
          </p>
        ) : (
          <LoreRows
            entries={entries}
            steersStory={steersStory}
            onOpen={(entry) => (steersStory ? startEdit(entry) : setReadingId(entry.id))}
            onNew={startAdd}
          />
        )}
        <Sheet
          open={editorOpen || reading !== null}
          onOpenChange={(next) => {
            if (!next) {
              closeEditor();
            }
          }}
          title={editing?.title || reading?.title || "New entry"}
          className="lg:w-[min(92vw,40rem)]"
        >
          {editorOpen ? (
            <div className="space-y-1.5">
              {editorForm}
              {editing ? (
                <LoreEntryActions
                  entry={editing}
                  onPin={() => void togglePin(editing)}
                  onDuplicate={() => void duplicate(editing)}
                  onDelete={() => void remove(editing.id).then(closeEditor)}
                />
              ) : null}
            </div>
          ) : reading ? (
            <div className="space-y-1">
              <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-400">
                {reading.body}
              </p>
              {reading.tags.length ? (
                <p className="text-[10px] text-stone-600">{reading.tags.join(" · ")}</p>
              ) : null}
            </div>
          ) : null}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <BookMarked className="size-3.5 text-amber-600" /> World lore
        </p>
        {steersStory && !editorOpen ? (
          <button
            type="button"
            onClick={startAdd}
            className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900"
          >
            <Plus className="size-3" /> Add entry
          </button>
        ) : null}
      </div>
      {loading ? (
        <p className="flex items-center gap-1 text-[11px] text-stone-500">
          <Loader2 className="size-3 animate-spin" /> Loading...
        </p>
      ) : null}
      {!loading && !entries.length && !editorOpen ? (
        <p className="text-[11px] italic text-stone-600">
          {steersStory
            ? "No lore yet. Write your world's places, factions, and history; the DM treats it as canon."
            : "The party lead has not written any world lore yet."}
        </p>
      ) : null}
      {editorOpen ? (
        <div className="mb-2 space-y-1.5 rounded border border-stone-800 bg-stone-950/60 p-2">
          {editorForm}
        </div>
      ) : null}
      {categories.map((category) => (
        <div key={category} className="mb-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-500">
            {CATEGORY_LABELS[category]}
          </p>
          <ul className="space-y-1">
            {entries
              .filter((entry) => entry.category === category)
              .map((entry) => (
                <LoreEntryRow
                  key={entry.id}
                  entry={entry}
                  steersStory={steersStory}
                  onEdit={() => startEdit(entry)}
                  onPin={() => void togglePin(entry)}
                  onDuplicate={() => void duplicate(entry)}
                  onDelete={() => void remove(entry.id)}
                />
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LoreEntryRow({
  entry,
  steersStory,
  onEdit,
  onPin,
  onDuplicate,
  onDelete,
}: {
  entry: LoreEntryView;
  steersStory: boolean;
  onEdit: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded border border-stone-800/70 bg-stone-950/40 p-1.5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {entry.pinned ? <Pin className="size-3 shrink-0 text-amber-400" /> : null}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-stone-300">
          {entry.title}
        </span>
      </button>
      {expanded ? (
        <div className="mt-1 space-y-1">
          <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-400">{entry.body}</p>
          {entry.tags.length ? (
            <p className="text-[10px] text-stone-600">{entry.tags.join(" · ")}</p>
          ) : null}
          {steersStory ? (
            <LoreEntryActions
              entry={entry}
              onEdit={onEdit}
              onPin={onPin}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
