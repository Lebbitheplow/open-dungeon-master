import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { setMemberActiveCharacter } from "@/lib/db/campaigns";
import { listSheetsForUser } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Switching which of their characters a player runs
// (docs/vtt-parity-implementation-plan.md 11.3).
const bodySchema = z.object({ characterId: z.string().trim().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (context.campaign.gameSettings.multiCharacter === "off") {
    return Response.json({ error: "This table plays one character each." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say which character." }, { status: 400 });
  }
  const own = listSheetsForUser(campaignId, context.user.id).find((sheet) => sheet.id === parsed.data.characterId && !sheet.isCompanion);
  if (!own) {
    return Response.json({ error: "That is not one of your characters." }, { status: 404 });
  }
  setMemberActiveCharacter(campaignId, context.user.id, own.id);
  publishEphemeral(campaignId, "roster_updated", { userId: context.user.id, activeSheetId: own.id, at: Date.now() });
  return Response.json({ ok: true, activeSheetId: own.id });
}
