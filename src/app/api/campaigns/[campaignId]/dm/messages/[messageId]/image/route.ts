import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { getCampaignMessage, setMessageGeneratedImage } from "@/lib/db/messages";
import { uploadedImageRecord } from "@/lib/dm/images";
import { publishPersisted } from "@/lib/events";
import { isUploadedImagePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The upload counterpart to the Illustrate adjudication: whoever runs the
// story hangs a picture of their own under a DM passage. It writes the same
// column and publishes the same image_ready event the media queue does when
// a render lands, so the transcript updates live for everyone without a
// second code path on the client. Only the uploader's own file is accepted;
// the path shape is the whole proof that /api/upload wrote it.
const bodySchema = z.object({
  url: z.string().refine(isUploadedImagePath, "That is not an uploaded image."),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; messageId: string }> },
) {
  const { campaignId, messageId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "That is not an uploaded image." },
      { status: 400 },
    );
  }
  const message = getCampaignMessage(messageId);
  if (!message || message.campaignId !== campaignId) {
    return Response.json({ error: "That passage is no longer there." }, { status: 404 });
  }
  // Pictures belong under narration. A player's words and the table's
  // system notes are never illustrated, by the AI or by hand.
  if (message.authorType !== "dm") {
    return Response.json({ error: "Only a DM passage can carry a picture." }, { status: 400 });
  }
  const image = uploadedImageRecord(parsed.data.url, context.campaign.settings.aspect);
  if (!setMessageGeneratedImage(messageId, image)) {
    return Response.json({ error: "That passage is no longer there." }, { status: 404 });
  }
  publishPersisted(campaignId, "image_ready", { messageId, image });
  return Response.json({ ok: true, image });
}
