"use client";

import { BookMarked, Loader2, Pencil, Pin, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import {
  WORLD_LORE_CATEGORIES,
  type WorldLoreCategory,
} from "@/lib/dm/world-lore-logic";

type LoreEntryView = {
  id: string;
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
};

const CATEGORY_LABELS: Record<WorldLoreCategory, string> = {
  geography: "Geography",
  factions: "Factions",
  history: "History",
  magic: "Magic",
  culture: "Culture",
  religion: "Religion",
  other: "Other",
};

// World lore builder: the lead's world bible. Entries feed the DM prompt
// (pinned always, the rest retrieved by relevance) and the search_lore
// tool. Party-visible, lead-edited, usable before and during the campaign.
export function LorePanel({
  campaignId,
  isLead,
}: {
  campaignId: string;
  isLead: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LoreEntryView[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    category: WorldLoreCategory;
    title: string;
    body: string;
    tags: string;
  }>({ category: "geography", title: "", body: "", tags: "" });
  const [busy, setBusy] = useState(false);

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

  const categories = WORLD_LORE_CATEGORIES.filter((category) =>
    entries.some((entry) => entry.category === category),
  );

  const editorOpen = adding || editingId !== null;

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <BookMarked className="size-3.5 text-amber-600" /> World lore
        </p>
        {isLead && !editorOpen ? (
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
          {isLead
            ? "No lore yet. Write your world's places, factions, and history; the DM treats it as canon."
            : "The party lead has not written any world lore yet."}
        </p>
      ) : null}
      {editorOpen ? (
        <div className="mb-2 space-y-1.5 rounded border border-stone-800 bg-stone-950/60 p-2">
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
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
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
                  isLead={isLead}
                  onEdit={() => startEdit(entry)}
                  onPin={() => void togglePin(entry)}
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
  isLead,
  onEdit,
  onPin,
  onDelete,
}: {
  entry: LoreEntryView;
  isLead: boolean;
  onEdit: () => void;
  onPin: () => void;
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
          {isLead ? (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onEdit}
                className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300"
              >
                <Pencil className="size-3" /> Edit
              </button>
              <button
                type="button"
                onClick={onPin}
                title={
                  entry.pinned
                    ? "Unpin: retrieved only when relevant"
                    : "Pin: included in every DM turn"
                }
                className={cn(
                  "flex items-center gap-1 text-[11px]",
                  entry.pinned ? "text-amber-300" : "text-stone-500 hover:text-stone-300",
                )}
              >
                <Pin className="size-3" /> {entry.pinned ? "Pinned" : "Pin"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-red-400"
              >
                <Trash2 className="size-3" /> Delete
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
