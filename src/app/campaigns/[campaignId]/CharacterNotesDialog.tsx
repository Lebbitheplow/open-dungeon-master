"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Pencil, StickyNote, Trash2, X, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { NoteComposer } from "@/app/campaigns/[campaignId]/NotesPanel";
import type { CampaignMember } from "@/lib/campaign-types";
import type { Note } from "@/lib/db/notes";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Notes attached to one character: public party notes (anyone can write;
// the author, the party lead, and the character's owner can delete) and the
// viewer's own private notes.
function CharacterNoteRow({
  campaignId,
  note,
  authorName,
  canEdit,
  canDelete,
  refreshNotes,
}: {
  campaignId: string;
  note: Note;
  authorName: string;
  canEdit: boolean;
  canDelete: boolean;
  refreshNotes: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);

  async function run(request: () => Promise<Response>) {
    setBusy(true);
    try {
      await request();
      await refreshNotes();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-stone-800 bg-stone-950/40 px-2.5 py-1.5">
      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || !body.trim()}
              onClick={async () => {
                await run(() =>
                  fetch(`/api/campaigns/${campaignId}/notes/${note.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ body: body.trim() }),
                  }),
                );
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
          <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-300">{note.body}</p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-stone-600">
            <span className="truncate">{authorName}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
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
                  onClick={() =>
                    run(() =>
                      fetch(`/api/campaigns/${campaignId}/notes/${note.id}`, {
                        method: "DELETE",
                      }),
                    )
                  }
                  title="Delete note"
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

export function CharacterNotesDialog({
  campaignId,
  sheet,
  notes,
  members,
  meUserId,
  isLead,
  refreshNotes,
  onClose,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  notes: Note[];
  members: CampaignMember[];
  meUserId: string;
  isLead: boolean;
  refreshNotes: () => Promise<void>;
  onClose: () => void;
}) {
  const nameFor = (userId: string) =>
    userId === meUserId
      ? "You"
      : members.find((member) => member.userId === userId)?.username ?? "Unknown";

  const characterNotes = notes.filter((note) => note.characterId === sheet.id);
  const publicNotes = characterNotes
    .filter((note) => note.visibility === "public")
    .sort((a, b) => b.seq - a.seq);
  const myNotes = characterNotes
    .filter((note) => note.visibility === "private" && note.authorUserId === meUserId)
    .sort((a, b) => b.seq - a.seq);
  const ownsCharacter = sheet.userId === meUserId;

  const section = "text-[10px] font-medium uppercase tracking-wide text-stone-500";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[22rem] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-serif text-lg text-stone-100">
              <StickyNote className="size-4 text-amber-300" /> Notes on {sheet.name}
            </Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <NoteComposer
              campaignId={campaignId}
              characterId={sheet.id}
              isLead={isLead}
              refreshNotes={refreshNotes}
            />

            <div className="space-y-1.5">
              <h3 className={section}>Party notes</h3>
              {publicNotes.length ? (
                <ul className="space-y-1.5">
                  {publicNotes.map((note) => (
                    <CharacterNoteRow
                      key={note.id}
                      campaignId={campaignId}
                      note={note}
                      authorName={nameFor(note.authorUserId)}
                      canEdit={note.authorUserId === meUserId}
                      canDelete={note.authorUserId === meUserId || isLead || ownsCharacter}
                      refreshNotes={refreshNotes}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-stone-600">
                  No party notes on {sheet.name} yet.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <h3 className={section}>My notes (only you see these)</h3>
              {myNotes.length ? (
                <ul className="space-y-1.5">
                  {myNotes.map((note) => (
                    <CharacterNoteRow
                      key={note.id}
                      campaignId={campaignId}
                      note={note}
                      authorName="You"
                      canEdit
                      canDelete
                      refreshNotes={refreshNotes}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-stone-600">No private notes yet.</p>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
