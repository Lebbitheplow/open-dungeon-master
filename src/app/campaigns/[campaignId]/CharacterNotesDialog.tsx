"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Trash2, X, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { KitButton, panelField, panelRow } from "./PanelKit";
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
    <li className={panelRow}>
      {editing ? (
        <div className="reveal space-y-1.5">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={2000}
            aria-label="Note"
            className={cn(panelField, "leading-5")}
          />
          <div className="flex gap-1.5">
            <KitButton
              tone="primary"
              disabled={busy || !body.trim()}
              busy={busy}
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
            >
              {busy ? null : <Check className="size-3.5" />}
              Save
            </KitButton>
            <KitButton
              onClick={() => {
                setEditing(false);
                setBody(note.body);
              }}
            >
              <X className="size-3.5" /> Cancel
            </KitButton>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-xs leading-5 text-stone-300">{note.body}</p>
          <div className="mt-1 flex min-h-6 items-center gap-2 text-[11px] text-stone-500">
            <span className="truncate">{authorName}</span>
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              {canEdit ? (
                <KitButton tone="icon" always onClick={() => setEditing(true)} title="Edit" aria-label="Edit">
                  <Pencil className="size-3.5" />
                </KitButton>
              ) : null}
              {canDelete ? (
                <KitButton
                  tone="iconDanger"
                  always
                  disabled={busy}
                  busy={busy}
                  aria-label="Delete note"
                  onClick={() =>
                    run(() =>
                      fetch(`/api/campaigns/${campaignId}/notes/${note.id}`, {
                        method: "DELETE",
                      }),
                    )
                  }
                  title="Delete note"
                >
                  {busy ? null : <Trash2 className="size-3.5" />}
                </KitButton>
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
  steersStory,
  refreshNotes,
  onClose,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  notes: Note[];
  members: CampaignMember[];
  meUserId: string;
  steersStory: boolean;
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

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[#05030d]/70 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide">
              <GameIcon icon={{ kind: "glyph", key: "tab-notes" }} size="size-7" />
              <span className="gold-title">Notes on {sheet.name}</span>
            </Dialog.Title>
            <Dialog.Close aria-label="Close" className="pk-tap rounded p-1 text-stone-500 hover:text-amber-200 motion-nudge">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <NoteComposer
              campaignId={campaignId}
              characterId={sheet.id}
              steersStory={steersStory}
              refreshNotes={refreshNotes}
            />

            <div className="space-y-1.5">
              <SectionHead title="Party notes" glyph="tab-party" aside={publicNotes.length || null} />
              {publicNotes.length ? (
                <ul className="stagger space-y-1.5">
                  {publicNotes.map((note) => (
                    <CharacterNoteRow
                      key={note.id}
                      campaignId={campaignId}
                      note={note}
                      authorName={nameFor(note.authorUserId)}
                      canEdit={note.authorUserId === meUserId}
                      canDelete={note.authorUserId === meUserId || steersStory || ownsCharacter}
                      refreshNotes={refreshNotes}
                    />
                  ))}
                </ul>
              ) : (
                <EmptyState size="sm" art="scrolls" title={`No party notes on ${sheet.name} yet.`} />
              )}
            </div>

            <div className="space-y-1.5">
              <SectionHead title="My notes (only you see these)" glyph="tab-journal" aside={myNotes.length || null} />
              {myNotes.length ? (
                <ul className="stagger space-y-1.5">
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
                <EmptyState size="sm" art="scrolls" title="No private notes yet." />
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
