import { latestSeq } from "@/lib/db/campaigns";
import { dueCalendarEvents, markCalendarEventFired } from "@/lib/db/calendar-events";
import { insertFact } from "@/lib/db/facts";
import { formatDate, type CalendarDefinition, type Instant } from "@/lib/dm/calendar";
import { publishTitleCard } from "@/lib/dm/scene-state";
import { publishEphemeral } from "@/lib/events";

// Firing calendar events the clock crossed (docs/vtt-parity-implementation-plan.md
// 7.2). A party-visible event becomes a world fact and a title card; a
// DM-only one becomes a fact only the DM seat reads, which the prompt
// carries as a nudge. Never throws: the clock moving must not wedge on a
// reminder.
export function fireCalendarEvents(campaignId: string, calendar: CalendarDefinition, from: Instant, to: Instant): number {
  try {
    const due = dueCalendarEvents(campaignId, calendar, from, to);
    if (!due.length) {
      return 0;
    }
    const seq = latestSeq(campaignId);
    for (const { event, at } of due) {
      const when = formatDate(calendar, at);
      insertFact({
        campaignId,
        category: "world",
        subject: event.title,
        fact: event.body ? `${event.title} (${when}): ${event.body}` : `${event.title} (${when}).`,
        knownBy: event.visibility === "dm" ? "dm" : "party",
        source: "manual",
        sourceSeq: seq,
      });
      markCalendarEventFired(event.id, at, seq);
      if (event.visibility === "party") {
        publishTitleCard(campaignId, { title: event.title, subtitle: when, tone: "plain" });
      }
    }
    publishEphemeral(campaignId, "facts_updated", {});
    publishEphemeral(campaignId, "calendar_updated", { at: Date.now() });
    return due.length;
  } catch (error) {
    console.error("[calendar] firing events failed", error);
    return 0;
  }
}
