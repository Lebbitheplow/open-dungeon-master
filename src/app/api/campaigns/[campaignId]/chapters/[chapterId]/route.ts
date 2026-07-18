import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getChapter, updateChapter } from "@/lib/db/chapters";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  summary: z.string().max(4000).optional(),
  highlights: z.array(z.string().min(1).max(200)).max(6).optional(),
});

// Party lead touch-ups to a chapter's recorded history.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; chapterId: string }> },
) {
  const { campaignId, chapterId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const chapter = getChapter(chapterId);
  if (!chapter || chapter.campaignId !== campaignId) {
    return Response.json({ error: "Chapter not found." }, { status: 404 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid chapter update." }, { status: 400 });
  }

  const updated = updateChapter(chapterId, parsed.data);
  publishPersisted(campaignId, "chapter_updated", { chapter: updated });
  return Response.json({ chapter: updated });
}
