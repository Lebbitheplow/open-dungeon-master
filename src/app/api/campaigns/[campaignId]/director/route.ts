import { z } from "zod";
import { isErrorResponse, requireStoryAuthority, requireMember } from "@/lib/campaign-api";
import {
  clearDirectorArm,
  getDirectorArm,
  setDirectorArm,
} from "@/lib/db/director-arms";
import {
  buildDirectorBlock,
  clampAbsoluteCommand,
  isArmed,
  isOneShotEventId,
  MAX_ABSOLUTE_COMMAND_LENGTH,
  ONE_SHOT_EVENT_IDS,
} from "@/lib/dm/director-logic";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Director controls: the party lead arms a one-turn steer (a canned event
// type, a free-text command, or both) that the next DM turn consumes.
// Changing it is lead only, like every other story-steering control.
//
// Reading splits. Every member may learn THAT something is armed, so the
// table sees the badge and nobody is surprised by a nudged scene. Only the
// lead may read WHAT it says: the directive is a spoiler for the turn it is
// about to bend.

const armSchema = z
  .object({
    oneShot: z.enum(ONE_SHOT_EVENT_IDS as unknown as [string, ...string[]]).nullish(),
    absoluteCommand: z.string().max(MAX_ABSOLUTE_COMMAND_LENGTH * 4).default(""),
  })
  .refine(
    (value) => Boolean(value.oneShot) || clampAbsoluteCommand(value.absoluteCommand).length > 0,
    { message: "Nothing to arm." },
  );

// The full directive, for the lead who wrote it.
function armPayload(campaignId: string) {
  const arm = getDirectorArm(campaignId);
  return {
    armed: isArmed(arm),
    oneShot: arm?.oneShot ?? null,
    absoluteCommand: arm?.absoluteCommand ?? "",
  };
}

// What everyone else may see: THAT a steer is armed, never what it says.
//
// The content is a spoiler. "Have the cultist turn on them when they reach
// the shrine" is exactly the sort of thing a player must not read before it
// happens, and the one-shot event id ("betrayal", "windfall") gives away
// nearly as much. The armed light stays visible because the table knowing the
// lead nudged the DM is honest; the text is not theirs to read.
function redactedArmPayload(campaignId: string) {
  return {
    armed: isArmed(getDirectorArm(campaignId)),
    oneShot: null,
    absoluteCommand: "",
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
  // Members may poll this to light the armed badge; only the lead reads the
  // directive itself.
  const lead = await requireStoryAuthority(campaignId);
  return Response.json(
    isErrorResponse(lead) ? redactedArmPayload(campaignId) : armPayload(campaignId),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
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
  // zod's enum widens back to string on the parsed output, so narrow through
  // the same guard the prompt builder uses rather than casting.
  const oneShot = isOneShotEventId(parsed.data.oneShot) ? parsed.data.oneShot : null;
  setDirectorArm({
    campaignId,
    oneShot,
    absoluteCommand,
    armedByUserId: context.user.id,
  });

  // Contentless on the wire: publishPersisted reaches every connected client,
  // so the directive's text would land in every player's browser.
  publishPersisted(campaignId, "director_armed", redactedArmPayload(campaignId));
  // The response, which only the lead receives, carries the real thing: the
  // block is returned so the lead sees precisely what the DM will be told
  // rather than trusting a label.
  const payload = armPayload(campaignId);
  return Response.json({ ...payload, preview: buildDirectorBlock(getDirectorArm(campaignId)) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  clearDirectorArm(campaignId);
  const payload = armPayload(campaignId);
  publishPersisted(campaignId, "director_armed", redactedArmPayload(campaignId));
  return Response.json(payload);
}
