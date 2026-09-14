import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { latestSeq } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { listFactsVisibleTo } from "@/lib/db/facts";
import { listScheduledSessions } from "@/lib/db/scheduling";
import { listSheets } from "@/lib/db/sheets";
import { listCalendarEvents } from "@/lib/db/calendar-events";
import { describeInstant, formatDate } from "@/lib/dm/calendar";
import { buildTimeline } from "@/lib/dm/timeline-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The campaign on one axis (docs/vtt-parity-implementation-plan.md 5.5).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const dm = steersStory(context);
  const owned = listSheets(campaignId)
    .filter((sheet) => sheet.userId === context.user.id)
    .map((sheet) => sheet.id);
  const { campaign } = context;
  const rows = buildTimeline(
    {
      chapters: listChapters(campaignId),
      facts: listFactsVisibleTo(campaignId, owned, dm),
      sessions: listScheduledSessions(campaignId),
      arcs: dm ? (campaign.storyArc?.worldArcs ?? []) : [],
      events: listCalendarEvents(campaignId, dm).map((event) => ({
        id: event.id,
        title: event.title,
        body: event.body,
        when: formatDate(campaign.clock.calendar, event.atInstant),
        firedSeq: event.firedSeq,
        fired: event.firedAt >= 0,
        visibility: event.visibility,
      })),
      now: { seq: latestSeq(campaignId), clockLabel: describeInstant(campaign.clock.calendar, campaign.clock.instant) },
    },
    dm,
  );
  return Response.json({ rows });
}
