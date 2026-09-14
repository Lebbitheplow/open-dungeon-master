import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { deleteShop, getShop, normalizeStock, updateShop } from "@/lib/db/shops";
import { publishEphemeral } from "@/lib/events";
import { shopView } from "@/app/api/campaigns/[campaignId]/shops/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  kind: z.string().optional(),
  size: z.string().optional(),
  keeperNpcId: z.string().trim().max(80).optional(),
  buys: z.boolean().optional(),
  restockDays: z.number().int().min(0).max(365).optional(),
  markup: z.number().min(0.5).max(3).optional(),
  stock: z.array(z.object({ itemName: z.string().trim().min(1).max(80), qty: z.number().int().min(0).max(999), priceCp: z.number().int().min(1), note: z.string().max(120).default("") })).max(60).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string; shopId: string }> }) {
  const { campaignId, shopId } = await params;
  const context = await requireDm(campaignId);
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
  const updated = updateShop(shopId, { ...parsed.data, stock: parsed.data.stock ? normalizeStock(parsed.data.stock) : undefined });
  publishEphemeral(campaignId, "shops_updated", { at: Date.now() });
  return Response.json({ shop: updated ? shopView(updated) : null });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ campaignId: string; shopId: string }> }) {
  const { campaignId, shopId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!deleteShop(campaignId, shopId)) {
    return Response.json({ error: "No such shop." }, { status: 404 });
  }
  publishEphemeral(campaignId, "shops_updated", { at: Date.now() });
  return Response.json({ ok: true });
}
