"use client";

import { BookMarked, EyeOff, Loader2, Pin, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTourPrepare } from "@/lib/tours/prepare";
import { appendTerm, collectTags, insertAt } from "@/lib/workshop/pickers";
import { AddFromList } from "@/components/ui/AddFromList";
import {
  WORLD_LORE_CATEGORIES,
  type LoreLinkTarget,
  type LoreVisibility,
  type WorldLoreCategory,
} from "@/lib/dm/world-lore-logic";
import { Sheet } from "@/components/ui/Sheet";
import { LoreEntryActions } from "@/app/workshop/lore/LoreEntryActions";
import { LoreBody, LoreImageField, VisibilitySelect } from "@/app/workshop/lore/LoreFields";
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
    visibility: LoreVisibility;
    imagePath: string;
  }>({ category: "geography", title: "", body: "", tags: "", visibility: "party", imagePath: "" });
  const [busy, setBusy] = useState(false);
  // Names beyond the lore itself that a [[link]] can point at.
  const [linkTargets, setLinkTargets] = useState<{ cast: string[]; monsters: string[] } | null>(
    null,
  );
  const rows = layout === "rows";
  // The body field, so a picked link lands at the caret rather than the end.
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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

  // What [[links]] in a body may point at: the other entries. An NPC or a
  // place by that name is the workshop's to resolve later; here a link to
  // an entry opens it.
  const targets: LoreLinkTarget[] = entries.map((entry) => ({ kind: "lore", id: entry.id, name: entry.title }));
  function followLink(target: LoreLinkTarget) {
    const entry = entries.find((candidate) => candidate.id === target.id);
    if (entry) {
      if (steersStory) {
        startEdit(entry);
      } else {
        setReadingId(entry.id);
      }
    }
  }

  function startAdd() {
    setDraft({ category: "geography", title: "", body: "", tags: "", visibility: "party", imagePath: "" });
    setEditingId(null);
    setAdding(true);
  }

  // The tour's "open the editor" step, answered where the editor is a sheet.
  useTourPrepare((name) => {
    if (name === "open-lore-editor" && rows && steersStory && !adding && editingId === null) {
      startAdd();
    }
  });

  function startEdit(entry: LoreEntryView) {
    setDraft({
      category: entry.category,
      title: entry.title,
      body: entry.body,
      tags: entry.tags.join(", "),
      visibility: entry.visibility,
      imagePath: entry.imagePath,
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
        visibility: draft.visibility,
        imagePath: draft.imagePath,
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
          visibility: entry.visibility,
          imagePath: entry.imagePath,
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

  // [[Link]] another entry by picking it: every name the body renderer
  // resolves, not only other lore. The cast and the DM's own monsters are
  // read once the editor opens, since they are only needed for this list.
  useEffect(() => {
    if (!editorOpen || linkTargets !== null) {
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`/api/campaigns/${campaignId}/dm/npcs`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { npcs?: Array<{ name: string }> } | null) =>
          (data?.npcs ?? []).map((npc) => npc.name),
        )
        .catch(() => [] as string[]),
      fetch(`/api/campaigns/${campaignId}/dm/bestiary`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { monsters?: Array<{ draft: { name: string } }> } | null) =>
          (data?.monsters ?? []).map((monster) => monster.draft.name),
        )
        .catch(() => [] as string[]),
    ]).then(([cast, monsters]) => {
      if (!cancelled) {
        setLinkTargets({ cast, monsters });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editorOpen, linkTargets, campaignId]);
  const linkable = [
    ...entries
      .filter((entry) => entry.id !== editingId)
      .map((entry) => ({ value: entry.title, label: `Lore: ${entry.title}` })),
    ...(linkTargets?.cast ?? []).map((name) => ({ value: name, label: `Cast: ${name}` })),
    ...(linkTargets?.monsters ?? []).map((name) => ({ value: name, label: `Monster: ${name}` })),
  ];
  const knownTags = collectTags(entries);
  function insertLink(title: string) {
    const field = bodyRef.current;
    const at = field?.selectionStart ?? draft.body.length;
    const next = insertAt(draft.body, at, `[[${title}]]`);
    setDraft((current) => ({ ...current, body: next.text }));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.caret, next.caret);
    });
  }

  // The author form is the same fields in both layouts; only what wraps it
  // differs.
  const editorForm = (
    <>
      <div className="flex gap-1.5" data-tour="lore-title">
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
        ref={bodyRef}
        value={draft.body}
        onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
        rows={rows ? 8 : 4}
        maxLength={4000}
        placeholder={"What is established about it...\n\n# Headings, **bold**, - lists, and [[The Mill]] to link another entry."}
        data-tour="lore-body"
        className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
      />
      {linkable.length ? (
        <div className="flex flex-wrap items-center gap-1.5" data-tour="lore-link">
          <AddFromList prompt="Link another entry" options={linkable} onPick={insertLink} />
          <span className="text-[10px] text-stone-600">Drops a [[link]] where the cursor is.</span>
        </div>
      ) : null}
      <VisibilitySelect
        value={draft.visibility}
        onChange={(visibility) => setDraft((current) => ({ ...current, visibility }))}
      />
      <LoreImageField
        imagePath={draft.imagePath}
        onChange={(imagePath) => setDraft((current) => ({ ...current, imagePath }))}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={draft.tags}
          onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
          placeholder="Tags, comma separated (optional)"
          className="min-w-40 flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
        />
        <AddFromList
          prompt="Add a tag you already use"
          options={knownTags}
          onPick={(tag) => setDraft((current) => ({ ...current, tags: appendTerm(current.tags, tag) }))}
        />
      </div>
      <div className="flex gap-1.5" data-tour="lore-save">
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
              <LoreBody entry={reading} targets={targets} onLink={followLink} />
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
                  targets={targets}
                  onLink={followLink}
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
  targets,
  onLink,
  onEdit,
  onPin,
  onDuplicate,
  onDelete,
}: {
  entry: LoreEntryView;
  steersStory: boolean;
  targets: LoreLinkTarget[];
  onLink: (target: LoreLinkTarget) => void;
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
        {entry.visibility === "dm" ? <EyeOff className="size-3 shrink-0 text-violet-300" /> : null}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-stone-300">
          {entry.title}
        </span>
      </button>
      {expanded ? (
        <div className="mt-1 space-y-1">
          <LoreBody entry={entry} targets={targets} onLink={onLink} />
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
