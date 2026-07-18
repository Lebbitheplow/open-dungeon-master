import { z } from "zod";
import { isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertNote, listNotesVisibleTo } from "@/lib/db/notes";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  characterId: z.string().max(80).optional(),
  visibility: z.enum(["public", "private"]),
  title: z.string().trim().max(120).default(""),
  body: z.string().trim().min(1).max(2000),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    notes: listNotesVisibleTo(campaignId, context.user.id, isLead(context)),
  });
}

// Creates a note. A public campaign-scope note from a non-lead member is
// stored as a pending suggestion for the lead to approve.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid note." }, { status: 400 });
  }
  const input = parsed.data;

  let characterId: string | null = null;
  if (input.characterId) {
    const sheet = getSheetById(input.characterId);
    if (!sheet || sheet.campaignId !== campaignId) {
      return Response.json({ error: "Character not found." }, { status: 404 });
    }
    characterId = sheet.id;
  }

  const suggestion =
    !characterId && input.visibility === "public" && !isLead(context);
  const note = insertNote({
    campaignId,
    characterId,
    authorUserId: context.user.id,
    visibility: input.visibility,
    status: suggestion ? "pending" : "active",
    title: input.title,
    body: input.body,
    seq: allocateSeq(campaignId),
  });

  // Private content never rides the event stream; see notes.ts.
  if (note.visibility === "public" && note.status === "active") {
    publishPersisted(campaignId, "note_updated", { note });
  } else if (suggestion) {
    publishPersisted(campaignId, "note_suggested", {
      noteId: note.id,
      authorUserId: note.authorUserId,
    });
  }

  return Response.json({ note });
}
