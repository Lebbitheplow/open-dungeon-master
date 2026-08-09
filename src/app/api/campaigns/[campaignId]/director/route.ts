import { z } from "zod";
import { isErrorResponse, requireLead, requireMember } from "@/lib/campaign-api";
import {
  clearDirectorArm,
  getDirectorArm,
  setDirectorArm,
} from "@/lib/db/director-arms";
import {
  buildDirectorBlock,
  clampAbsoluteCommand,
  isArmed,
  MAX_ABSOLUTE_COMMAND_LENGTH,
  ONE_SHOT_EVENT_IDS,
} from "@/lib/dm/director-logic";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Director controls: the party lead arms a one-turn steer (a canned event
// type, a free-text command, or both) that the next DM turn consumes. Reading
// the armed state is open to every member so the whole table sees the badge;
// changing it is lead only, like every other story-steering control.

const armSchema = z
  .object({
    oneShot: z.enum(ONE_SHOT_EVENT_IDS as unknown as [string, ...string[]]).nullish(),
    absoluteCommand: z.string().max(MAX_ABSOLUTE_COMMAND_LENGTH * 4).default(""),
  })
  .refine(
    (value) => Boolean(value.oneShot) || clampAbsoluteCommand(value.absoluteCommand).length > 0,
    { message: "Nothing to arm." },
  );

function armPayload(campaignId: string) {
  const arm = getDirectorArm(campaignId);
  return {
    armed: isArmed(arm),
    oneShot: arm?.oneShot ?? null,
    absoluteCommand: arm?.absoluteCommand ?? "",
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(armPayload(campaignId));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = armSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Nothing to arm." }, { status: 400 });
  }

  // Clamp before storing, not just before prompting, so what the lead reads
  // back in the armed banner is exactly the text the DM will receive.
  const absoluteCommand = clampAbsoluteCommand(parsed.data.absoluteCommand);
  const oneShot = parsed.data.oneShot ?? null;
  setDirectorArm({
    campaignId,
    oneShot,
    absoluteCommand,
    armedByUserId: context.user.id,
  });

  const payload = armPayload(campaignId);
  publishPersisted(campaignId, "director_armed", payload);
  // The block is returned so the lead can see precisely what the DM will be
  // told, rather than trusting a label.
  return Response.json({ ...payload, preview: buildDirectorBlock(getDirectorArm(campaignId)) });
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
  clearDirectorArm(campaignId);
  const payload = armPayload(campaignId);
  publishPersisted(campaignId, "director_armed", payload);
  return Response.json(payload);
}
