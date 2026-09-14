import { z } from "zod";
import { isErrorResponse, requireDm, requireMember, steersStory } from "@/lib/campaign-api";
import { insertCalendarEvent, listCalendarEvents } from "@/lib/db/calendar-events";
import { formatDate, toInstant } from "@/lib/dm/calendar";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Calendar events (docs/vtt-parity-implementation-plan.md 7.2). Members
// read what the party may see; whoever steers the story reads all and
// writes.

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(600).default(""),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(24).default(1),
  day: z.number().int().min(1).max(400).default(1),
  hour: z.number().int().min(0).max(23).default(8),
  visibility: z.enum(["party", "dm"]).default("party"),
  repeat: z.enum(["none", "yearly", "monthly"]).default("none"),
});

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const calendar = context.campaign.clock.calendar;
  const events = listCalendarEvents(campaignId, steersStory(context)).map((event) => ({
    ...event,
    when: formatDate(calendar, event.atInstant),
    fired: event.firedAt >= 0,
  }));
  return Response.json({ events });
}

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "An event needs a title and a day." }, { status: 400 });
  }
  const calendar = context.campaign.clock.calendar;
  const body = parsed.data;
  const event = insertCalendarEvent({
    campaignId,
    atInstant: toInstant(calendar, { year: body.year, month: body.month, day: body.day, hour: body.hour }),
    title: body.title,
    body: body.body,
    visibility: body.visibility,
    repeat: body.repeat,
  });
  publishEphemeral(campaignId, "calendar_updated", { at: Date.now() });
  return Response.json({ event: { ...event, when: formatDate(calendar, event.atInstant), fired: false } });
}
