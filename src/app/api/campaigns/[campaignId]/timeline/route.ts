import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { latestSeq } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { listFactsVisibleTo } from "@/lib/db/facts";
import { listScheduledSessions } from "@/lib/db/scheduling";
import { listSheets } from "@/lib/db/sheets";
import { listCalendarEvents } from "@/lib/db/calendar-events";
import { describeInstant, formatDate } from "@/lib/dm/calendar";
import { buildTimeline } from "@/lib/dm/timeline-logic";
import { publicActs } from "@/lib/dm/arc-logic";

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
  const chapters = listChapters(campaignId);
  // Acts that ended, placed at the close of their last chapter. Chapters
  // sealed before acts were stamped carry none and draw no act rows.
  const acts = campaign.storyArc
    ? publicActs(campaign.storyArc)
        .filter((act) => act.status === "done")
        .map((act) => {
          const last = chapters
            .filter((chapter) => chapter.status === "closed" && chapter.act === act.act && (chapter.saga ?? 1) === act.sagaIndex)
            .at(-1);
          return { ...act, endedSeq: last?.seqEnd ?? 0, clockLabel: last?.clockLabel ?? "" };
        })
        .filter((act) => act.endedSeq > 0)
    : [];
  const rows = buildTimeline(
    {
      chapters,
      acts,
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
