import { z } from "zod";
import { isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { deleteNote, getNoteById, updateNote, type Note } from "@/lib/db/notes";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  pinned: z.boolean().optional(),
  status: z.literal("active").optional(),
});

function isCharacterOwner(note: Note, userId: string): boolean {
  if (!note.characterId) {
    return false;
  }
  return getSheetById(note.characterId)?.userId === userId;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; noteId: string }> },
) {
  const { campaignId, noteId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const note = getNoteById(noteId);
  if (!note || note.campaignId !== campaignId) {
    return Response.json({ error: "Note not found." }, { status: 404 });
  }
  const lead = isLead(context);
  const author = note.authorUserId === context.user.id;
  // Non-authors can only reach notes they can see: public ones, or pending
  // suggestions when they lead.
  if (!author && !(note.visibility === "public" && (note.status === "active" || lead))) {
    return Response.json({ error: "Note not found." }, { status: 404 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid note update." }, { status: 400 });
  }
  const patch = parsed.data;

  const campaignPublic = !note.characterId && note.visibility === "public";
  if (patch.title !== undefined || patch.body !== undefined) {
    const canEdit = author || (lead && campaignPublic);
    if (!canEdit) {
      return Response.json({ error: "Only the author can edit this note." }, { status: 403 });
    }
  }
  if (patch.pinned !== undefined) {
    if (!lead || !campaignPublic || note.status !== "active") {
      return Response.json({ error: "Only the party lead can pin party notes." }, { status: 403 });
    }
  }
  if (patch.status !== undefined) {
    if (!lead || note.status !== "pending") {
      return Response.json({ error: "Only the party lead can approve suggestions." }, { status: 403 });
    }
  }

  const updated = updateNote(noteId, patch);
  if (!updated) {
    return Response.json({ error: "Note not found." }, { status: 404 });
  }
  if (updated.visibility === "public" && updated.status === "active") {
    publishPersisted(campaignId, "note_updated", { note: updated });
  }
  return Response.json({ note: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; noteId: string }> },
) {
  const { campaignId, noteId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const note = getNoteById(noteId);
  if (!note || note.campaignId !== campaignId) {
    return Response.json({ error: "Note not found." }, { status: 404 });
  }

  const lead = isLead(context);
  const author = note.authorUserId === context.user.id;
  const allowed =
    author ||
    (note.visibility === "public" &&
      (lead || (note.status === "active" && isCharacterOwner(note, context.user.id))));
  if (!allowed) {
    return Response.json({ error: "You cannot delete this note." }, { status: 403 });
  }

  deleteNote(noteId);
  // Broadcast removals of anything other members may have seen: public
  // active notes everywhere, and pending suggestions on the lead's queue.
  if (note.visibility === "public") {
    publishPersisted(campaignId, "note_deleted", {
      noteId: note.id,
      characterId: note.characterId,
    });
  }
  return Response.json({ ok: true });
}
