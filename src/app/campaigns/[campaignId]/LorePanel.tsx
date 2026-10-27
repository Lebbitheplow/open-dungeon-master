"use client";

import { EmptyState } from "@/components/EmptyState";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTourPrepare } from "@/lib/tours/prepare";
import { collectTags } from "@/lib/workshop/pickers";
import { LORE_TITLE_MAX, WORLD_LORE_CATEGORIES, type LoreLinkTarget } from "@/lib/dm/world-lore-logic";
import { SectionHead } from "@/components/ui/SectionHead";
import { Sheet } from "@/components/ui/Sheet";
import { KitButton, LoadFailed, PanelError, PanelLoading } from "./PanelKit";
import { WorldEntryLink, useOpenOnArrival } from "@/app/workshop/world/WorldEntryLink";
import { useUnsavedDraft } from "@/app/workshop/unsaved";
import { findLostCreate, readLoad, readWrite, useLoadStatus } from "@/lib/load-state";
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
  isDm = false,
  layout = "list",
  members,
  openId,
  onWorldEntry,
  refreshKey = 0,
}: {
  campaignId: string;
  steersStory: boolean;
  // Holds the DM seat. "Show this now" and the cast and bestiary link
  // lists go through DM-only routes, so an AI campaign's lead edits the
  // binder without them.
  isDm?: boolean;
  layout?: "list" | "rows";
  // The table, for the "some players" audience. Absent in the workshop.
  members?: Array<{ userId: string; username: string }>;
  // Bumped when the lore changed elsewhere (the workshop's live versions).
  refreshKey?: number;
  // In the workshop only (src/app/workshop/world/WorldEntryLink.tsx): the
  // record to open on arrival, and the way to its WorldForge entry.
  openId?: string | null;
  onWorldEntry?: (id: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  // Whether a load has landed and what the last one said (issue 140): a
  // refused list is shown in the server's words, never as "no lore yet".
  const { loaded, loadError, settle } = useLoadStatus();
  const [reload, setReload] = useState(0);
  const [entries, setEntries] = useState<LoreEntryView[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Rows only: an entry opened by somebody who cannot edit it, so they can
  // still read the whole of it.
  const [readingId, setReadingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LoreDraft>(blankLoreDraft());
  const [busy, setBusy] = useState(false);
  // What the server refused and why (an entry over its cap, issue #302); a
  // refusal used to close nothing and say nothing.
  const [saveError, setSaveError] = useState("");
  // Names beyond the lore itself that a [[link]] can point at.
  const [linkTargets, setLinkTargets] = useState<{ cast: string[]; monsters: string[] } | null>(
    null,
  );
  const rows = layout === "rows";

  useEffect(() => {
    let cancelled = false;
    readLoad<{ entries?: LoreEntryView[] }>(fetch(`/api/campaigns/${campaignId}/lore`), "The lore").then((outcome) => {
      if (cancelled) {
        return;
      }
      settle(outcome);
      if (outcome.payload && Array.isArray(outcome.payload.entries)) {
        setEntries(outcome.payload.entries);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, reload, refreshKey, settle]);
  const retry = () => {
    setLoading(true);
    setReload((current) => current + 1);
  };

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
    setSaveError("");
    setDraft(blankLoreDraft());
    setEditingId(null);
    setAdding(true);
  }

  // The tour's "open the editor" step, answered where the editor is a sheet.
  // Answered once the list is in (so Create's later ask finds it open, or
  // closed by the author since, and leaves it so).
  useTourPrepare((name) => {
    if (name !== "open-lore-editor" || !rows || !steersStory) return;
    if (!adding && editingId === null) {
      startAdd();
    }
    return true;
  });

  function startEdit(entry: LoreEntryView) {
    setSaveError("");
    setDraft(draftFromEntry(entry));
    setAdding(false);
    setEditingId(entry.id);
  }

  useOpenOnArrival(openId, loaded ? entries : null, (entry) => (steersStory ? startEdit(entry) : setReadingId(entry.id)));
  // In the workshop, an editor with changes is asked about before leaving.
  const openEntry = editingId ? entries.find((entry) => entry.id === editingId) ?? null : null;
  useUnsavedDraft(
    Boolean(onWorldEntry) && (adding || editingId !== null) &&
      JSON.stringify(draft) !== JSON.stringify(openEntry ? draftFromEntry(openEntry) : blankLoreDraft()),
  );

  function closeEditor() {
    setSaveError("");
    setAdding(false);
    setEditingId(null);
    setReadingId(null);
  }

  async function submitDraft() {
    if (!draft.title.trim() || !draft.body.trim()) {
      return;
    }
    setBusy(true);
    setSaveError("");
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
      const sent = await readWrite<{ entry?: LoreEntryView }>(
        fetch(editingId ? `/api/campaigns/${campaignId}/lore/${editingId}` : `/api/campaigns/${campaignId}/lore`, {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        "That entry could not be saved.",
      );
      if (sent.error !== null) {
        // A new entry whose answer was lost is looked for before anything is
        // said, so a second press never makes two (WA-05). The form keeps
        // the draft unless the entry is there.
        if (sent.unanswered && !editingId) {
          const title = draft.title.trim().slice(0, LORE_TITLE_MAX);
          const found = await findLostCreate(loaded ? entries : null, reread, (entry) => entry.title === title);
          if (found === "made") {
            setAdding(false);
            return;
          }
          setSaveError(
            found === "missing"
              ? "The server did not answer and the entry is not in the list, so it was not added. Your words are kept; press Add again."
              : "The server could not be reached, so it is not known yet whether the entry was added. Your words are kept. Check the list before adding it again.",
          );
          return;
        }
        setSaveError(sent.unanswered ? `${sent.error} Your words are kept here.` : sent.error);
        return;
      }
      const saved = sent.payload.entry;
      if (saved) {
        setEntries((current) =>
          editingId ? current.map((entry) => (entry.id === editingId ? saved : entry)) : [...current, saved],
        );
      }
      setAdding(false);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  }

  // The list read again outside the load effect, for a create whose answer
  // was lost: the entries it found, or null when it could not read them.
  const reread = () =>
    readLoad<{ entries?: LoreEntryView[] }>(fetch(`/api/campaigns/${campaignId}/lore`), "The lore").then((outcome) => {
      if (!outcome.payload || !Array.isArray(outcome.payload.entries)) {
        return null;
      }
      setEntries(outcome.payload.entries);
      return outcome.payload.entries;
    });

  // Pin, delete and duplicate say what the server refused, or that it was
  // not reached, where the editor's own refusals show.
  async function togglePin(entry: LoreEntryView) {
    setSaveError("");
    const sent = await readWrite<{ entry?: LoreEntryView }>(
      fetch(`/api/campaigns/${campaignId}/lore/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !entry.pinned }),
      }),
      "That entry could not be pinned.",
    );
    if (sent.error !== null) {
      setSaveError(sent.error);
      if (sent.unanswered) void reread();
      return;
    }
    const saved = sent.payload.entry;
    if (saved) {
      setEntries((current) => current.map((e) => (e.id === entry.id ? saved : e)));
    }
  }

  async function remove(entryId: string): Promise<boolean> {
    setSaveError("");
    const sent = await readWrite(fetch(`/api/campaigns/${campaignId}/lore/${entryId}`, { method: "DELETE" }), "That entry could not be deleted.");
    if (sent.error !== null) {
      setSaveError(sent.error);
      if (sent.unanswered) void reread();
      return false;
    }
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    return true;
  }

  // Same create route as submitDraft, with the copy landing in the list the
  // same way a new entry does.
  async function duplicate(entry: LoreEntryView) {
    setBusy(true);
    setSaveError("");
    try {
      const title = `${entry.title} (copy)`;
      const sent = await readWrite<{ entry?: LoreEntryView }>(
        fetch(`/api/campaigns/${campaignId}/lore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: entry.category,
            title,
            body: entry.body,
            tags: entry.tags,
            visibility: entry.visibility,
            imagePath: entry.imagePath,
            audience: entry.audience ?? null,
            attachmentPath: entry.attachmentPath ?? "",
            style: entry.style ?? "plain",
          }),
        }),
        "That entry could not be copied.",
      );
      if (sent.error !== null) {
        if (sent.unanswered) {
          const found = await findLostCreate(loaded ? entries : null, reread, (row) => row.title === title.trim().slice(0, LORE_TITLE_MAX));
          if (found !== "made") {
            setSaveError(
              found === "missing"
                ? "The server did not answer and the copy is not in the list, so it was not made. Duplicate it again."
                : "The server could not be reached, so it is not known yet whether the copy was made. Check the list before duplicating it again.",
            );
          }
          return;
        }
        setSaveError(sent.error);
        return;
      }
      const copy = sent.payload.entry;
      if (copy) {
        setEntries((current) => [...current, copy]);
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
    // Not the DM: the lists stay empty and no DM route is asked.
    if (!editorOpen || linkTargets !== null || !isDm) {
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
  }, [editorOpen, linkTargets, campaignId, isDm]);
  const linkable = [
    ...entries
      .filter((entry) => entry.id !== editingId)
      .map((entry) => ({ value: entry.title, label: `Lore: ${entry.title}` })),
    ...(linkTargets?.cast ?? []).map((name) => ({ value: name, label: `Cast: ${name}` })),
    ...(linkTargets?.monsters ?? []).map((name) => ({ value: name, label: `Monster: ${name}` })),
  ];
  const knownTags = collectTags(entries);

  // Show this now (section 5.2): the same engine call the model makes. A
  // refusal, or a request that never arrived, is said rather than dropped.
  async function showNow(entry: LoreEntryView) {
    setSaveError("");
    const sent = await readWrite(
      fetch(`/api/campaigns/${campaignId}/dm/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "show_handout", args: { lore: entry.id } }),
      }),
      "That handout could not be shown.",
    );
    if (sent.error !== null) {
      setSaveError(sent.unanswered ? `${sent.error} The party may have it already; look at the table before showing it again.` : sent.error);
    }
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
      {saveError ? <PanelError className="text-[11px]">{saveError}</PanelError> : null}
      <div className="flex gap-1.5" data-tour="lore-save">
        <KitButton tone="primary" onClick={submitDraft} disabled={busy || !draft.title.trim() || !draft.body.trim()} busy={busy}>
          {editingId ? "Save" : "Add"}
        </KitButton>
        <KitButton
          onClick={() => {
            setAdding(false);
            setEditingId(null);
          }}
        >
          <X className="size-3.5" /> Cancel
        </KitButton>
      </div>
    </>
  );

  if (rows) {
    const editing = editingId ? entries.find((entry) => entry.id === editingId) ?? null : null;
    const reading = readingId ? entries.find((entry) => entry.id === readingId) ?? null : null;
    return (
      <div className="space-y-3">
        {loaded && loadError ? <LoadFailed error={loadError} onRetry={retry} /> : null}
        {saveError && !editorOpen ? <PanelError>{saveError}</PanelError> : null}
        {loading ? (
          <PanelLoading label="Loading..." />
        ) : !loaded && loadError ? (
          <LoadFailed error={loadError} onRetry={retry} />
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
            <div className="reveal space-y-1.5">
              {editorForm}
              {editing ? (
                <LoreEntryActions
                  entry={editing}
                  onPin={() => void togglePin(editing)}
                  onDuplicate={() => void duplicate(editing)}
                  onDelete={() => void remove(editing.id).then((gone) => gone && closeEditor())}
                />
              ) : null}
              {editing && onWorldEntry ? <WorldEntryLink onOpen={() => onWorldEntry(editing.id)} /> : null}
            </div>
          ) : reading ? (
            <div className="reveal space-y-1">
              <LoreBody entry={reading} targets={targets} onLink={followLink} dmView={steersStory} />
              {reading.tags.length ? (
                <p className="reveal text-[11px] text-stone-500">{reading.tags.join(" · ")}</p>
              ) : null}
              <MentionedIn campaignId={campaignId} entryId={reading.id} onOpen={followLink} />
            </div>
          ) : null}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="panel rounded-lg p-3">
      <SectionHead
        title="World lore"
        glyph="system-lore"
        aside={
          steersStory && !editorOpen ? (
            <KitButton onClick={startAdd}>
              <Plus className="size-3.5" /> Add entry
            </KitButton>
          ) : null
        }
      />
      {loading ? (
        <PanelLoading label="Loading..." />
      ) : null}
      {!loading && loadError ? <LoadFailed error={loadError} onRetry={retry} /> : null}
      {saveError && !editorOpen ? <PanelError className="mb-2">{saveError}</PanelError> : null}
      {!loading && loaded && !entries.length && !editorOpen ? (
        <EmptyState size="sm" art="scrolls" title={steersStory ? "No lore yet. Write your world's places, factions, and history; the GM treats it as canon." : "The party lead has not written any world lore yet."} />
      ) : null}
      {editorOpen ? (
        <div className="reveal mb-2 space-y-1.5 rounded-lg border border-amber-500/20 bg-stone-950/60 p-2.5">
          {editorForm}
        </div>
      ) : null}
      {categories.map((category) => (
        <div key={category} className="mb-2">
          <SectionHead title={CATEGORY_LABELS[category]} glyph="tab-journal" level="h4" aside={entries.filter((entry) => entry.category === category).length} />
          <ul className="stagger space-y-1">
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
                  onShow={isDm && entry.visibility === "party" ? () => void showNow(entry) : undefined}
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
