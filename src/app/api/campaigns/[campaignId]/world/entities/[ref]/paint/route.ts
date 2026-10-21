import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { acceptPaintJob, cancelPaintJob, paintStatus, rejectPaintJob, reusePaintedPicture, type PaintStatus } from "@/lib/db/world-paint-jobs";
import { publishEphemeral } from "@/lib/events";
import { mediaQueueStats } from "@/lib/media-queue";
import { parseRef } from "@/lib/worldforge/model";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One entry's Paint jobs (src/lib/db/world-paint-jobs.ts, audit WF-16), the
// DM's alone like the rest of the world's routes. GET is what the entry
// page reads on open and while a picture is on its way, so a reload finds
// it queued, working, waiting for a decision or failed with its reason.
// POST decides: accept a finished picture (refused while the entry's
// picture has changed since it was asked for, unless `replace`), reject it,
// cancel one still waiting for the queue, or put back a picture the entry
// had. Paint itself is asked on the world/ai route.

function refFrom(value: string): string | null {
  const ref = value.includes("%") ? decodeURIComponent(value) : value;
  return parseRef(ref) ? ref : null;
}

// This server's picture queue, the one every table's scene art, maps and
// portraits share: whether a picture is being painted now, and how many
// wait (a queued job here among them).
function withQueue(status: PaintStatus) {
  const gpu = mediaQueueStats().gpu;
  return { ...status, queue: { painting: gpu?.running ?? 0, waiting: gpu?.waiting ?? 0 } };
}

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = refFrom(rawRef);
  if (!ref) {
    return Response.json({ error: "No such entry." }, { status: 404 });
  }
  return Response.json(withQueue(paintStatus(campaignId, ref)));
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), job: z.string().max(80), replace: z.boolean().default(false) }),
  z.object({ action: z.literal("reject"), job: z.string().max(80) }),
  z.object({ action: z.literal("cancel"), job: z.string().max(80) }),
  z.object({ action: z.literal("reuse"), picture: z.string().max(300) }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = refFrom(rawRef);
  if (!ref) {
    return Response.json({ error: "No such entry." }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That is not something Paint can do." }, { status: 400 });
  }
  const body = parsed.data;
  // A job is this entry's, or it is not found.
  if (body.action !== "reuse" && !paintStatus(campaignId, ref).jobs.some((job) => job.id === body.job)) {
    return Response.json({ error: "No such picture for this entry." }, { status: 404 });
  }
  const result =
    body.action === "accept"
      ? acceptPaintJob(campaignId, body.job, body.replace)
      : body.action === "reject"
        ? rejectPaintJob(campaignId, body.job)
        : body.action === "cancel"
          ? cancelPaintJob(campaignId, body.job)
          : reusePaintedPicture(campaignId, ref, body.picture);
  if ("error" in result) {
    const { status, ...rest } = result;
    return Response.json(rest, { status });
  }
  if (body.action === "accept" || body.action === "reuse") {
    const shelf = parseRef(ref)!.shelf;
    publishEphemeral(campaignId, shelf === "faction" ? "factions_updated" : "world_updated", { at: Date.now() });
    recordsChanged(campaignId, shelf, "world");
  }
  return Response.json({ ...("job" in result ? { job: result.job } : {}), status: withQueue(result.status) });
}
