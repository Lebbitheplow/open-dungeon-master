import { z } from "zod";
import { isErrorResponse, requirePrepAuthority } from "@/lib/campaign-api";
import { getClock } from "@/lib/db/clock";
import { getLocation } from "@/lib/db/locations";
import { deleteShop, getShop, normalizeStock, shopRefProblem, stockLineSchema, updateShop, type ShopInput } from "@/lib/db/shops";
import { restockShop } from "@/lib/dm/shop-tools";
import { publishEphemeral } from "@/lib/events";
import { shopView } from "@/app/api/campaigns/[campaignId]/shops/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One shop, for whoever holds the prep (#171): its place and keeper, its
// policy, and its shelf. A shelf written here is also the one it restocks
// to; `stockFromPack` hands restocking back to the pack, and `restock` is
// the one explicit restock, refilling or rerolling now.
const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  kind: z.string().optional(),
  size: z.string().optional(),
  // "" takes the shop off its place.
  locationId: z.string().trim().max(80).optional(),
  keeperNpcId: z.string().trim().max(80).optional(),
  buys: z.boolean().optional(),
  restockDays: z.number().int().min(0).max(365).optional(),
  markup: z.number().min(0.5).max(3).optional(),
  stock: z.array(stockLineSchema).max(60).optional(),
  stockFromPack: z.literal(true).optional(),
  restock: z.literal(true).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string; shopId: string }> }) {
  const { campaignId, shopId } = await params;
  const context = await requirePrepAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const shop = getShop(shopId);
  if (!shop || shop.campaignId !== campaignId) {
    return Response.json({ error: "No such shop." }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That is not a change a shop can take." }, { status: 400 });
  }
  const { stock, stockFromPack, restock, locationId, ...rest } = parsed.data;
  const problem = shopRefProblem(campaignId, { locationId, keeperNpcId: rest.keeperNpcId });
  if (problem) {
    return Response.json({ error: problem }, { status: 400 });
  }
  const patch: Partial<ShopInput> = { ...rest };
  if (locationId !== undefined) {
    const place = locationId ? getLocation(locationId) : null;
    patch.locationId = place?.id ?? "";
    patch.locationName = place?.name ?? "";
  }
  if (stock) {
    patch.stock = normalizeStock(stock);
    patch.preparedStock = patch.stock;
  } else if (stockFromPack) {
    patch.preparedStock = null;
  }
  let updated = updateShop(shopId, patch);
  if (updated && restock) {
    updated = restockShop(updated, getClock(campaignId).instant);
  }
  publishEphemeral(campaignId, "shops_updated", { at: Date.now() });
  return Response.json({ shop: updated ? shopView(updated) : null });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ campaignId: string; shopId: string }> }) {
  const { campaignId, shopId } = await params;
  const context = await requirePrepAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!deleteShop(campaignId, shopId)) {
    return Response.json({ error: "No such shop." }, { status: 404 });
  }
  publishEphemeral(campaignId, "shops_updated", { at: Date.now() });
  return Response.json({ ok: true });
}
