"use client";

import { BookMarked, Loader2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTourPrepare } from "@/lib/tours/prepare";
import { collectTags } from "@/lib/workshop/pickers";
import { WORLD_LORE_CATEGORIES, type LoreLinkTarget } from "@/lib/dm/world-lore-logic";
import { Sheet } from "@/components/ui/Sheet";
import { LoreEntryActions } from "@/app/workshop/lore/LoreEntryActions";
import { LoreEditorForm } from "@/app/workshop/lore/LoreEditorForm";
import { LoreEntryRow, MentionedIn } from "@/app/workshop/lore/LoreEntryRow";
import { LoreBody } from "@/app/workshop/lore/LoreFields";
import { LoreRows } from "@/app/workshop/lore/LoreRows";
import { blankLoreDraft, CATEGORY_LABELS, draftFromEntry, type LoreDraft, type LoreEntryView } from "@/app/workshop/lore/types";

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
  members,
}: {
  campaignId: string;
  steersStory: boolean;
  layout?: "list" | "rows";
  // The table, for the "some players" audience. Absent in the workshop.
  members?: Array<{ userId: string; username: string }>;
}) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LoreEntryView[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Rows only: an entry opened by somebody who cannot edit it, so they can
  // still read the whole of it.
  const [readingId, setReadingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LoreDraft>(blankLoreDraft());
  const [busy, setBusy] = useState(false);
  // Names beyond the lore itself that a [[link]] can point at.
  const [linkTargets, setLinkTargets] = useState<{ cast: string[]; monsters: string[] } | null>(
    null,
  );
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
    setDraft(blankLoreDraft());
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
    setDraft(draftFromEntry(entry));
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
        audience: draft.audience && draft.audience.length ? draft.audience : null,
        attachmentPath: draft.attachmentPath,
        style: draft.style,
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
          audience: entry.audience ?? null,
          attachmentPath: entry.attachmentPath ?? "",
          style: entry.style ?? "plain",
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

  // Show this now (section 5.2): the same engine call the model makes.
  async function showNow(entry: LoreEntryView) {
    await fetch(`/api/campaigns/${campaignId}/dm/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "show_handout", args: { loreId: entry.id } }),
    });
  }

  // The author form is the same fields in both layouts; only what wraps it
  // differs.
  const editorForm = (
    <>
      <LoreEditorForm
        draft={draft}
        onChange={setDraft}
        linkable={linkable}
        knownTags={knownTags}
        members={members}
        targets={targets}
        rows={rows}
      />
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
              <LoreBody entry={reading} targets={targets} onLink={followLink} dmView={steersStory} />
              {reading.tags.length ? (
                <p className="text-[10px] text-stone-600">{reading.tags.join(" · ")}</p>
              ) : null}
              <MentionedIn campaignId={campaignId} entryId={reading.id} onOpen={followLink} />
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
                  campaignId={campaignId}
                  onShow={steersStory && entry.visibility === "party" ? () => void showNow(entry) : undefined}
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
