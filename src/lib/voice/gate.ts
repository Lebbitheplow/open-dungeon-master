import {
  isErrorResponse,
  requireMember,
  type MemberContext,
} from "@/lib/campaign-api";
import { voiceConfig } from "@/lib/voice/config";

// Voice is off unless BOTH switches allow it: the server owner's (they may not
// have opened the media port) and the table's. The stricter one wins, and the
// reason is reported so the UI can say which, rather than showing a control
// that silently never connects.
export function voiceAvailability(campaign: { gameSettings: { voice: { enabled: boolean } } }): {
  available: boolean;
  reason: "" | "server" | "campaign";
} {
  if (!voiceConfig().enabled) {
    return { available: false, reason: "server" };
  }
  if (!campaign.gameSettings.voice.enabled) {
    return { available: false, reason: "campaign" };
  }
  return { available: true, reason: "" };
}

// Membership plus both voice switches. Every voice route that touches the SFU
// goes through this; the GET state route uses requireMember directly, because
// it still has to report WHY voice is unavailable.
export async function requireVoiceMember(
  campaignId: string,
): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const availability = voiceAvailability(context.campaign);
  if (!availability.available) {
    return Response.json(
      {
        error:
          availability.reason === "server"
            ? "Voice chat is switched off on this server."
            : "Voice chat is switched off for this campaign.",
      },
      { status: 403 },
    );
  }
  return context;
}
