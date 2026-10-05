import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getMember } from "@/lib/db/campaigns";
import { setMemberMuted } from "@/lib/db/moderation";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const muteSchema = z.object({
  userId: z.string().min(1).max(80),
  muted: z.boolean(),
});

// The party lead (or the owner, their safety valve) silences a member at
// this table, or lets them speak again. The mute travels with the member
// row, so every seat sees the badge through member_updated.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign, user } = context;
  if (user.id !== campaign.leadUserId && user.id !== campaign.ownerUserId) {
    return Response.json({ error: "Only the party lead can mute players." }, { status: 403 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = muteSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const { userId, muted } = parsed.data;
  if (userId === user.id) {
    return Response.json({ error: "You cannot mute yourself." }, { status: 400 });
  }
  if (userId === campaign.ownerUserId) {
    return Response.json({ error: "The owner of the campaign cannot be muted." }, { status: 400 });
  }
  if (!setMemberMuted(campaignId, userId, muted)) {
    return Response.json({ error: "That user is not in this campaign." }, { status: 404 });
  }
  // The mute covers the voice call as well. Only when voice has been used in
  // this process is there a call to reach (the hook is set by the voice
  // layer's first load), and a mute must never fail because voice is unhappy.
  if (globalThis.__odmVoiceEventHook) {
    try {
      // The server relays this call's audio, so it pauses or resumes theirs.
      const { applyVoiceFloor } = await import("@/lib/voice/turns");
      await applyVoiceFloor(campaignId);
      // A mesh call's audio runs between the players' own devices, where the
      // server has nothing to pause: the muted member leaves the call.
      if (muted) {
        const { meshLeave } = await import("@/lib/voice/mesh");
        meshLeave(campaignId, userId);
      }
    } catch (error) {
      console.error("[voice] could not apply a table mute", error);
    }
  }
  const member = getMember(campaignId, userId);
  publishPersisted(campaignId, "member_updated", { member });
  return Response.json({ member });
}
