import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { getPendingRoll, publicPendingRoll, setPendingAdvantage } from "@/lib/db/dm-turns";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { inspiredRoll } from "@/lib/dm/pending-inspiration";
import { spendInspirationCounter } from "@/lib/dm/roll-riders";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The roller spends their character's Inspiration on a roll parked for them:
// advantage on its d20 (SRD 5.1), before any die is thrown. The refusal is
// the rule's own sentence (src/lib/dm/pending-inspiration.ts); nothing is
// spent when it refuses.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; pendingRollId: string }> },
) {
  const { campaignId, pendingRollId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const pending = getPendingRoll(pendingRollId);
  if (!pending || pending.campaignId !== campaignId) {
    return Response.json({ error: "Roll not found." }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }
  if (pending.userId !== context.user.id) {
    return Response.json({ error: "This is not your roll." }, { status: 403 });
  }
  const sheet = pending.characterId ? getSheetById(pending.characterId) : null;
  if (sheet && sheet.userId !== context.user.id) {
    return Response.json({ error: "Only the character's own player spends their Inspiration." }, { status: 403 });
  }

  const inspired = inspiredRoll(pending, sheet);
  if ("error" in inspired) {
    return Response.json({ error: inspired.error }, { status: 409 });
  }
  // The roll first, so a roll resolved a moment ago never costs the award.
  const updated = setPendingAdvantage(pending.id, inspired.expression, inspired.advantage);
  if (!updated || !sheet) {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }
  const patch = { resources: spendInspirationCounter(sheet.resources) };
  const spent = patchSheet(sheet.id, patch);
  if (spent) {
    const entry = insertSheetAudit({
      campaignId,
      characterId: sheet.id,
      turnId: pending.turnId,
      actor: "player",
      kind: "player_adjust",
      delta: { inspiration: "spent" },
      reason: `Inspiration spent on ${pending.detail || pending.kind.replaceAll("_", " ")}`,
      seq: allocateSeq(campaignId),
      before: sheet,
      patch,
    });
    publishPersisted(campaignId, "sheet_audit", { entry, characterName: sheet.name });
    publishPersisted(campaignId, "sheet_updated", { sheet: spent });
  }
  publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(updated) });
  return Response.json({ pendingRoll: publicPendingRoll(updated) });
}
