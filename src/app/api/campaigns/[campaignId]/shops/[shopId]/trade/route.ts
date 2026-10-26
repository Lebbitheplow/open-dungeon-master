import { z } from "zod";
import { isDm, isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getCurrentLocation } from "@/lib/db/locations";
import { getSheetForUser } from "@/lib/db/sheets";
import { getShop, shopOpenToParty } from "@/lib/db/shops";
import { handleBuyItem, handleHaggle, handleSellItem } from "@/lib/dm/shop-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A member at the counter (docs/vtt-parity-implementation-plan.md 11.1):
// buy, sell or haggle with their own character, through the same handlers
// the model and the console use, so the price and the ledger are one.
const bodySchema = z.object({
  action: z.enum(["buy", "sell", "haggle"]),
  item: z.string().trim().max(80).default(""),
  qty: z.number().int().min(1).max(99).default(1),
  characterId: z.string().trim().max(80).optional(),
  // A haggle's skill: persuasion, intimidation or deception. From the
  // Market a character haggles alone: the panel cannot see who else stands
  // at the counter, which the story says through the DM's haggle.
  skill: z.enum(["persuasion", "intimidation", "deception"]).default("persuasion"),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string; shopId: string }> }) {
  const { campaignId, shopId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const shop = getShop(shopId);
  if (!shop || shop.campaignId !== campaignId) {
    return Response.json({ error: "No such shop." }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say what you are doing at the counter." }, { status: 400 });
  }
  // The counter is where the shop stands. The lead of an AI table sees every
  // shop in the world, but trades only where the party is; a person running
  // the game may still work a far counter by hand.
  if (!isDm(context) && !shopOpenToParty(shop, getCurrentLocation(campaignId))) {
    return Response.json({ error: `The party is not at ${shop.locationName || "that shop"}.`, away: true }, { status: 409 });
  }
  // Players trade as themselves; the DM seat may act for any character.
  const own = getSheetForUser(campaignId, context.user.id);
  const characterId = steersStory(context) && parsed.data.characterId ? parsed.data.characterId : own?.id;
  if (!characterId) {
    return Response.json({ error: "You have no character to trade with." }, { status: 400 });
  }
  const raw = JSON.stringify({ characterId, shop: shop.id, item: parsed.data.item, qty: parsed.data.qty });
  const result =
    parsed.data.action === "buy"
      ? handleBuyItem(context.campaign, raw)
      : parsed.data.action === "sell"
        ? handleSellItem(context.campaign, raw)
        : handleHaggle(context.campaign, JSON.stringify({ characterId, shop: shop.id, skill: parsed.data.skill }));
  if ("error" in result) {
    // Something nobody has priced: the keeper names a price, through the DM.
    if (result.unpriced === true) {
      return Response.json({ error: "The shopkeeper will name a price.", unpriced: true }, { status: 409 });
    }
    return Response.json({ error: String(result.error) }, { status: 409 });
  }
  return Response.json({ result });
}
