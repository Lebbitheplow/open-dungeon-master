import { isErrorResponse, requireLead, requireMember } from "@/lib/campaign-api";
import { ensureOpenChapter, listChapters } from "@/lib/db/chapters";
import { listRewindableChapters } from "@/lib/db/snapshots";
import { countMessagesUpToSeq } from "@/lib/db/messages";
import { latestSeq } from "@/lib/db/campaigns";
import { maybeCloseChapter } from "@/lib/dm/chapter-close";
import { enqueueDmJob } from "@/lib/dm/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Story so far: every chapter plus how far the open one has progressed.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const open = ensureOpenChapter(campaignId);
  const openMessageCount =
    countMessagesUpToSeq(campaignId, latestSeq(campaignId)) -
    (open.seqStart > 0 ? countMessagesUpToSeq(campaignId, open.seqStart - 1) : 0);
  return Response.json({
    chapters: listChapters(campaignId),
    openMessageCount,
    // Chapters the lead may rewind to (a boundary snapshot exists).
    rewindableChapters: listRewindableChapters(campaignId),
  });
}

// Party lead: close the current chapter now. Runs on the DM queue so the
// summarizing model call never interleaves with a turn in flight.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  enqueueDmJob(campaignId, () => maybeCloseChapter(campaignId, { beatCompleted: false, manual: true }));
  return Response.json({ ok: true }, { status: 202 });
}
