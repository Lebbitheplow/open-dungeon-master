"use client";

import {
  Check,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { CampaignMember } from "@/lib/campaign-types";
import type { Note } from "@/lib/db/notes";

// Campaign notes tab: the lead's public party notes and pinned events, the
// suggestion queue, and each member's private notes. Character-scoped notes
// live in CharacterNotesDialog; this panel shows campaign-scope only.

function byPinnedThenNewest(a: Note, b: Note): number {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }
  return b.seq - a.seq;
}

function NoteCard({
  campaignId,
  note,
  authorName,
  canEdit,
  canDelete,
  canPin,
  canApprove,
  deleteLabel,
  refreshNotes,
}: {
  campaignId: string;
  note: Note;
  authorName: string;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  canApprove: boolean;
  deleteLabel: string;
  refreshNotes: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refreshNotes();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/notes/${note.id}`, { method: "DELETE" });
      await refreshNotes();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      {editing ? (
        <div className="space-y-1.5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="Title (optional)"
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || !body.trim()}
              onClick={async () => {
                await patch({ title: title.trim(), body: body.trim() });
                setEditing(false);
              }}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTitle(note.title);
                setBody(note.body);
              }}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-900"
            >
              <X className="size-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {note.title ? (
            <p className="flex items-center gap-1 text-xs font-medium text-amber-200">
              {note.pinned ? <Pin className="size-3 shrink-0 text-amber-400" /> : null}
              {note.title}
            </p>
          ) : note.pinned ? (
            <Pin className="mb-0.5 size-3 text-amber-400" />
          ) : null}
          <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-300">{note.body}</p>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-stone-600">
            <span className="truncate">{authorName}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {canApprove ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ status: "active" })}
                  title="Approve: publish to the whole party"
                  className="flex items-center gap-0.5 rounded border border-emerald-900 px-1.5 py-0.5 text-emerald-400 hover:bg-emerald-950/50"
                >
                  <Check className="size-3" /> Approve
                </button>
              ) : null}
              {canPin ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ pinned: !note.pinned })}
                  title={note.pinned ? "Unpin" : "Pin to the top (the DM treats pinned notes as key canon)"}
                  className="text-stone-500 hover:text-amber-300"
                >
                  {note.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                </button>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="Edit"
                  className="text-stone-500 hover:text-stone-300"
                >
                  <Pencil className="size-3" />
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={remove}
                  title={deleteLabel}
                  className="text-stone-500 hover:text-red-400"
                >
                  <Trash2 className="size-3" />
                </button>
              ) : null}
            </span>
          </div>
        </>
      )}
    </li>
  );
}

export function NoteComposer({
  campaignId,
  characterId = null,
  isLead,
  refreshNotes,
}: {
  campaignId: string;
  characterId?: string | null;
  isLead: boolean;
  refreshNotes: () => Promise<void>;
}) {
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const publicLabel = characterId
    ? "Party note"
    : isLead
      ? "Party note"
      : "Suggest party note";

  async function submit() {
    if (!body.trim() || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(characterId ? { characterId } : {}),
          visibility,
          title: title.trim(),
          body: body.trim(),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not save the note.");
        return;
      }
      setTitle("");
      setBody("");
      await refreshNotes();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-stone-800 p-2.5">
      <div className="mb-1.5 flex gap-1">
        {(
          [
            ["private", "Private note"],
            ["public", publicLabel],
          ] as Array<["private" | "public", string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setVisibility(value)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px]",
              visibility === value
                ? "border-amber-700 bg-amber-950/40 text-amber-200"
                : "border-stone-800 text-stone-500 hover:text-stone-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {!characterId ? (
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          placeholder="Title (optional)"
          className="mb-1.5 w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600"
        />
      ) : null}
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        maxLength={2000}
        placeholder={
          visibility === "private"
            ? "Only you will see this"
            : isLead || characterId
              ? "Visible to the whole party"
              : "Sent to the party lead for approval"
        }
        className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
      />
      {error ? <p className="mt-1 text-[10px] text-red-400">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !body.trim()}
        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <StickyNote className="size-3" />}
        Add note
      </button>
    </div>
  );
}

export function NotesPanel({
  campaignId,
  notes,
  members,
  meUserId,
  isLead,
  refreshNotes,
}: {
  campaignId: string;
  notes: Note[];
  members: CampaignMember[];
  meUserId: string;
  isLead: boolean;
  refreshNotes: () => Promise<void>;
}) {
  const nameFor = (userId: string) =>
    members.find((member) => member.userId === userId)?.username ?? "Unknown";

  const campaignNotes = notes.filter((note) => note.characterId === null);
  const partyNotes = campaignNotes
    .filter((note) => note.visibility === "public" && note.status === "active")
    .sort(byPinnedThenNewest);
  const pending = campaignNotes
    .filter((note) => note.status === "pending")
    .sort((a, b) => b.seq - a.seq);
  const leadQueue = isLead ? pending : [];
  const mySuggestions = isLead ? [] : pending.filter((note) => note.authorUserId === meUserId);
  const myPrivate = campaignNotes
    .filter((note) => note.visibility === "private" && note.authorUserId === meUserId)
    .sort((a, b) => b.seq - a.seq);

  const section = "px-1 text-[10px] font-medium uppercase tracking-wide text-stone-500";

  return (
    <div className="space-y-3">
      <NoteComposer campaignId={campaignId} isLead={isLead} refreshNotes={refreshNotes} />

      {leadQueue.length ? (
        <div className="space-y-1.5">
          <h3 className={cn(section, "text-amber-400")}>Suggestions awaiting you</h3>
          <ul className="space-y-1.5">
            {leadQueue.map((note) => (
              <NoteCard
                key={note.id}
                campaignId={campaignId}
                note={note}
                authorName={nameFor(note.authorUserId)}
                canEdit={note.authorUserId === meUserId}
                canDelete
                canPin={false}
                canApprove
                deleteLabel="Reject suggestion"
                refreshNotes={refreshNotes}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {mySuggestions.length ? (
        <div className="space-y-1.5">
          <h3 className={section}>My suggestions (awaiting the lead)</h3>
          <ul className="space-y-1.5">
            {mySuggestions.map((note) => (
              <NoteCard
                key={note.id}
                campaignId={campaignId}
                note={note}
                authorName="You"
                canEdit
                canDelete
                canPin={false}
                canApprove={false}
                deleteLabel="Withdraw suggestion"
                refreshNotes={refreshNotes}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <h3 className={section}>Party notes</h3>
        {partyNotes.length ? (
          <ul className="space-y-1.5">
            {partyNotes.map((note) => (
              <NoteCard
                key={note.id}
                campaignId={campaignId}
                note={note}
                authorName={nameFor(note.authorUserId)}
                canEdit={isLead || note.authorUserId === meUserId}
                canDelete={isLead || note.authorUserId === meUserId}
                canPin={isLead}
                canApprove={false}
                deleteLabel="Delete note"
                refreshNotes={refreshNotes}
              />
            ))}
          </ul>
        ) : (
          <p className="px-1 text-[11px] text-stone-600">
            {isLead
              ? "Pin key events and facts here; the DM treats them as canon."
              : "Nothing recorded yet. Suggest a note and the party lead can publish it."}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className={section}>My private notes</h3>
        {myPrivate.length ? (
          <ul className="space-y-1.5">
            {myPrivate.map((note) => (
              <NoteCard
                key={note.id}
                campaignId={campaignId}
                note={note}
                authorName="Only you can see this"
                canEdit
                canDelete
                canPin={false}
                canApprove={false}
                deleteLabel="Delete note"
                refreshNotes={refreshNotes}
              />
            ))}
          </ul>
        ) : (
          <p className="px-1 text-[11px] text-stone-600">No private notes yet.</p>
        )}
      </div>
    </div>
  );
}
