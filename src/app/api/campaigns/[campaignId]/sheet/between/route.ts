import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getSheetById, getSheetForUser } from "@/lib/db/sheets";
import { ownSheetFor } from "@/lib/character-seat";
import { afflictionLines } from "@/lib/dm/between-lines";
import { liveAfflictions } from "@/lib/dm/afflictions";
import { lifestyleLine } from "@/lib/dm/lifestyle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A character's life between adventures, as the sheet shows it: the lifestyle
// they pay for at each dawn, crafting, training, research and recuperating
// progress, and the diseases, madness and poisons the engine holds
// (src/lib/dm/between-lines.ts, the same lines the narrator reads).
//
// A player asks for any of their own characters and the DM for anyone's. What has
// not shown itself yet (a disease still incubating, a poison waiting for
// midnight: an affliction with no condition on the sheet) is the DM's alone,
// since the character does not know it is there (SRD 5.1, Diseases).
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const dm = capsFor(context).role === "dm";
  const asked = new URL(request.url).searchParams.get("characterId")?.slice(0, 80) ?? "";
  const sheet = asked
    ? dm
      ? getSheetById(asked)
      : ownSheetFor(campaignId, context.user.id, asked)
    : getSheetForUser(campaignId, context.user.id);
  if (!sheet || sheet.campaignId !== campaignId) {
    return Response.json({ lines: [] });
  }
  // afflictionLines maps liveAfflictions one to one, in order.
  const entries = liveAfflictions(campaignId, sheet);
  const lines = afflictionLines(campaignId, sheet)
    .map((text, index) => ({ text, hidden: (entries[index]?.conditions.length ?? 0) === 0 }))
    .filter((line) => dm || !line.hidden);
  const living = lifestyleLine(campaignId, sheet.id);
  return Response.json({
    lines: [
      ...lines.map((line) => ({ text: line.text, kind: "affliction" as const, ...(line.hidden ? { secret: true } : {}) })),
      ...(living ? living.split("; ").map((text) => ({ text, kind: "between" as const })) : []),
    ],
  });
}
