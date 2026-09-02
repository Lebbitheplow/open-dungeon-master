import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { imagesAvailable } from "@/lib/capabilities";
import { getLocation, setLocationMap } from "@/lib/db/locations";
import { uploadedImageRecord } from "@/lib/dm/images";
import { enqueueLocationMap } from "@/lib/dm/maps";
import { publishPersisted } from "@/lib/events";
import { isUploadedImagePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A body naming an uploaded file replaces the map with that file; an empty
// body asks for a redraw. The two are one route because they end the same
// way: the same column written, the same location_map_ready published, so
// the panel and the transcript update live either way.
const bodySchema = z.object({
  imageUrl: z.string().refine(isUploadedImagePath, "That is not an uploaded image.").optional(),
});

// Story authority: re-render an area's map (queued; the client gets
// location_map_ready when it lands), or set it to a picture the DM uploaded.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; locationId: string }> },
) {
  const { campaignId, locationId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const location = getLocation(locationId);
  if (!location || location.campaignId !== campaignId) {
    return Response.json({ error: "Location not found." }, { status: 404 });
  }
  // The redraw path has always taken an empty POST; an unreadable body still
  // means "redraw", so only a body that is present and wrong is refused.
  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "That is not an uploaded image." },
      { status: 400 },
    );
  }

  if (parsed.data.imageUrl) {
    const image = uploadedImageRecord(parsed.data.imageUrl, "landscape");
    if (!setLocationMap(locationId, image)) {
      return Response.json({ error: "Location not found." }, { status: 404 });
    }
    publishPersisted(campaignId, "location_map_ready", { locationId, image });
    return Response.json({ ok: true, image });
  }

  // No image backend means the queue would only ever publish "failed"; say
  // so up front, and the panel offers the upload instead.
  if (!(await imagesAvailable())) {
    return Response.json(
      { error: "This server has no image model to draw with. Upload a map instead." },
      { status: 409 },
    );
  }
  void enqueueLocationMap(context.campaign, locationId);
  return Response.json({ ok: true }, { status: 202 });
}
