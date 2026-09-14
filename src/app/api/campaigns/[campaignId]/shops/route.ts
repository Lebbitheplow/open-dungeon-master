import { z } from "zod";
import { isErrorResponse, requireDm, requireMember, steersStory } from "@/lib/campaign-api";
import { getCurrentLocation, listLocations } from "@/lib/db/locations";
import { getNpcById } from "@/lib/db/npcs";
import { insertShop, listShops, listShopsAt } from "@/lib/db/shops";
import { askingPriceCp, SIZE_MARKUP, type Shop } from "@/lib/dm/shop-logic";
import { stockPool } from "@/lib/dm/shop-tools";
import { stockFromPool } from "@/lib/dm/shop-logic";
import { getClock } from "@/lib/db/clock";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shops (docs/vtt-parity-implementation-plan.md 11.1). A member reads the
// shops at the party's place with asking prices worked out; whoever steers
// the story reads all of them and may open one anywhere.

export function shopView(shop: Shop) {
  return {
    ...shop,
    keeperName: shop.keeperNpcId ? getNpcById(shop.keeperNpcId)?.name ?? "" : "",
    keeperPortrait: shop.keeperNpcId ? getNpcById(shop.keeperNpcId)?.portraitUrl ?? "" : "",
    stock: shop.stock.map((line) => ({ ...line, askingCp: askingPriceCp(line.priceCp, shop.markup) })),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const here = getCurrentLocation(campaignId);
  const dm = steersStory(context);
  const shops = dm ? listShops(campaignId) : here ? listShopsAt(campaignId, here.id, here.name) : [];
  return Response.json({
    shops: shops.map(shopView),
    here: here ? { id: here.id, name: here.name } : null,
    places: dm ? listLocations(campaignId).map((location) => ({ id: location.id, name: location.name })) : [],
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.string().default("general"),
  size: z.string().default("village"),
  locationId: z.string().trim().max(80).default(""),
  locationName: z.string().trim().max(120).default(""),
  keeperNpcId: z.string().trim().max(80).default(""),
  buys: z.boolean().default(true),
  restockDays: z.number().int().min(0).max(365).default(7),
  // Stock the shelves from the pack, or start bare.
  stockFromPack: z.boolean().default(true),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "A shop needs a name." }, { status: 400 });
  }
  const body = parsed.data;
  const place = body.locationId ? listLocations(campaignId).find((location) => location.id === body.locationId) : getCurrentLocation(campaignId);
  const size = (["hamlet", "village", "town", "city"] as const).includes(body.size as "village") ? (body.size as keyof typeof SIZE_MARKUP) : "village";
  const shop = insertShop(campaignId, {
    name: body.name,
    kind: body.kind,
    size,
    locationId: place?.id ?? "",
    locationName: place?.name ?? body.locationName,
    keeperNpcId: body.keeperNpcId,
    buys: body.buys,
    restockDays: body.restockDays,
    stock: body.stockFromPack ? stockFromPool(stockPool(body.kind), size) : [],
    markup: SIZE_MARKUP[size],
    restockedAt: getClock(campaignId).instant,
  });
  publishEphemeral(campaignId, "shops_updated", { at: Date.now() });
  return Response.json({ shop: shopView(shop) });
}
