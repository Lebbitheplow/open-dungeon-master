import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { runningDmJob, stopDmJob } from "@/lib/dm/queue";
import { LEAD_STOPPED_REASON } from "@/lib/dm/job-stage-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The lead's Stop on the DM's status line (issue #383): ends whatever the
// DM is doing now. A turn stops with the halted notice and its Retry
// (src/lib/dm/turn-halt.ts); other work just lets go. Lead only, like Retry.
// The job the button was showing is named, so a click that lands after that
// job finished never stops the next one.

const stopSchema = z.object({
  jobId: z.string().min(1).max(80),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = stopSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid stop request." }, { status: 400 });
  }
  const job = runningDmJob(campaignId);
  if (!job || job.id !== parsed.data.jobId) {
    return Response.json({ error: "The DM already finished that." }, { status: 409 });
  }
  if (job.stopping) {
    return Response.json({ ok: true, stopping: true });
  }
  stopDmJob(campaignId, LEAD_STOPPED_REASON);
  return Response.json({ ok: true, stopping: true });
}
