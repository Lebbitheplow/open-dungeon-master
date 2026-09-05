import { z } from "zod";
import { isErrorResponse, requireLead, requireMember } from "@/lib/campaign-api";
import { coverStatus, queueCampaignCover } from "@/lib/campaign-cover";
import { imagesAvailable } from "@/lib/capabilities";
import { setCampaignCover } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";
import { isUploadedImagePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The campaign's cover art. Any member may read it; changing it is the party
// lead's, the same seat that edits the title and premise, because the cover
// is campaign info and not story authority (a human DM does not own it).
//
// Every way of painting a picture in this app also accepts an upload, so
// PATCH takes a file /api/upload wrote and POST asks the image backend for
// one; on a host with no backend POST says so plainly instead of queueing a
// render that can never land.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ cover: context.campaign.cover, status: coverStatus(campaignId) });
}

const patchSchema = z.object({
  // A path this app wrote through /api/upload; anything else is refused
  // rather than sanitized (src/lib/uploads.ts).
  imageUrl: z.string().refine(isUploadedImagePath, "Not an uploaded file."),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "The cover must be an image uploaded to this server." },
      { status: 400 },
    );
  }
  const url = parsed.data.imageUrl;
  const cover = { id: url.slice("/uploads/".length).replace(/\.[a-z]+$/, ""), url };
  if (!setCampaignCover(campaignId, cover)) {
    return Response.json({ error: "Could not save the cover." }, { status: 400 });
  }
  publishPersisted(campaignId, "campaign_updated", { cover });
  return Response.json({ ok: true, cover, status: null });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!(await imagesAvailable())) {
    return Response.json(
      { error: "This server has no image backend, so it cannot paint a cover. Upload one instead." },
      { status: 409 },
    );
  }
  const pending = coverStatus(campaignId);
  if (pending === "queued" || pending === "generating") {
    return Response.json({ ok: true, cover: context.campaign.cover, status: pending });
  }
  queueCampaignCover(context.campaign);
  return Response.json({ ok: true, cover: context.campaign.cover, status: "queued" });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  setCampaignCover(campaignId, null);
  publishPersisted(campaignId, "campaign_updated", { cover: null });
  return Response.json({ ok: true, cover: null, status: coverStatus(campaignId) });
}
