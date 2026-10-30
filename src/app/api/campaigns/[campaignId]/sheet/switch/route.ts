import { z } from "zod";
import { getActiveEncounter } from "@/lib/db/encounters";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { setMemberActiveCharacter } from "@/lib/db/campaigns";
import { getSheetForUser, listSheetsForUser } from "@/lib/db/sheets";
import { heroFell, switchesHeroes } from "@/lib/characters/fallen-logic";
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
  const multiCharacter = context.campaign.gameSettings.multiCharacter;
  const mine = listSheetsForUser(campaignId, context.user.id);
  // One character each, unless a fallen hero was raised after their
  // replacement joined: then the player picks which of the two plays on
  // (src/lib/characters/fallen-logic.ts switchesHeroes).
  if (!switchesHeroes(mine, multiCharacter)) {
    return Response.json({ error: "This table plays one character each." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say which character." }, { status: 400 });
  }
  const own = mine.find((sheet) => sheet.id === parsed.data.characterId && !sheet.isCompanion);
  if (!own) {
    return Response.json({ error: "That is not one of your characters." }, { status: 404 });
  }
  if (multiCharacter === "off" && heroFell(own)) {
    return Response.json({ error: `${own.name} has fallen; play on with your living hero.` }, { status: 400 });
  }
  // A fielded hero who has fallen holds no seat: the player may field
  // another mid-fight rather than wait out the fight behind the dead.
  const encounter = getActiveEncounter(campaignId);
  const fielded = getSheetForUser(campaignId, context.user.id);
  if (multiCharacter === "one_active" && encounter && encounter.kind !== "scene" && fielded?.id !== own.id && !(fielded && heroFell(fielded))) {
    return Response.json({ error: "Wait until the fight ends to change your fielded character." }, { status: 409 });
  }
  setMemberActiveCharacter(campaignId, context.user.id, own.id);
  publishEphemeral(campaignId, "roster_updated", { userId: context.user.id, activeSheetId: own.id, at: Date.now() });
  publishBattleMapUpdate(campaignId);
  return Response.json({ ok: true, activeSheetId: own.id });
}
