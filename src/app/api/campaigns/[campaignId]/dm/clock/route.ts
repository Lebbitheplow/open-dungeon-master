import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { advanceClock, getClock, setCalendar, setClockInstant } from "@/lib/db/clock";
import {
  ADVANCE_UNITS,
  CALENDAR_PRESETS,
  calendarPreset,
  describeInstant,
  toInstant,
} from "@/lib/dm/calendar";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The in-world clock's DM controls: move it, set it, or change what a year
// means. Time also moves on its own through travel, rests and pass_time; this
// is for the DM setting where the campaign starts and correcting a drift.

const clockSchema = z.discriminatedUnion("do", [
  z.object({
    do: z.literal("advance"),
    amount: z.number().int().min(1).max(10000),
    unit: z.enum(ADVANCE_UNITS),
  }),
  z.object({
    do: z.literal("set"),
    year: z.number().int().optional(),
    month: z.number().int().min(1).max(24).optional(),
    day: z.number().int().min(1).max(400).optional(),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z.number().int().min(0).max(59).optional(),
  }),
  z.object({ do: z.literal("calendar"), preset: z.string().max(40) }),
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const clock = getClock(campaignId);
  return Response.json({
    clock,
    reads: describeInstant(clock.calendar, clock.instant),
    presets: CALENDAR_PRESETS.map((preset) => ({ id: preset.id, name: preset.name })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const parsed = clockSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say how to move the clock." }, { status: 400 });
  }
  const body = parsed.data;

  if (body.do === "advance") {
    const moved = advanceClock(campaignId, body.amount, body.unit);
    if ("error" in moved) {
      return Response.json({ error: moved.error }, { status: 409 });
    }
    publishPersisted(campaignId, "clock_changed", { clock: moved.clock });
    return Response.json({
      clock: moved.clock,
      reads: describeInstant(moved.clock.calendar, moved.clock.instant),
    });
  }

  if (body.do === "calendar") {
    const clock = setCalendar(campaignId, calendarPreset(body.preset));
    publishPersisted(campaignId, "clock_changed", { clock });
    return Response.json({ clock, reads: describeInstant(clock.calendar, clock.instant) });
  }

  // Setting the date by hand is the one place time may move backwards, and
  // only a DM can do it: it is a correction, not a game action.
  const current = getClock(campaignId);
  const clock = setClockInstant(campaignId, toInstant(current.calendar, body));
  publishPersisted(campaignId, "clock_changed", { clock });
  return Response.json({ clock, reads: describeInstant(clock.calendar, clock.instant) });
}
