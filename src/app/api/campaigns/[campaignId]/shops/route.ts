import { z } from "zod";
import { hasPrepAuthority, isErrorResponse, requireMember, requirePrepAuthority, steersStory } from "@/lib/campaign-api";
import { getCurrentLocation, listLocations } from "@/lib/db/locations";
import { getNpcById, listNpcs } from "@/lib/db/npcs";
import { insertShop, listShops, listShopsAt, normalizeStock, shopRefProblem, stockLineSchema } from "@/lib/db/shops";
import { askingPriceCp, SIZE_MARKUP, type Shop } from "@/lib/dm/shop-logic";
import { stockPool } from "@/lib/dm/shop-tools";
import { stockFromPool } from "@/lib/dm/shop-logic";
import { getClock } from "@/lib/db/clock";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shops (docs/vtt-parity-implementation-plan.md 11.1). A member reads the
// shops at the party's place with asking prices worked out; whoever steers
// the story reads all of them. Whoever holds the prep (the DM seat, or the
// lead of an AI-narrated table, #171) opens, stocks and closes them, and
// reads the places and cast a shop can stand at and be kept by.

// The prepared shelf is prep: the people at the counter see what is on the
// shelf now, not what the keeper restocks to.
export function shopView(shop: Shop, prep = true) {
  return {
    ...shop,
    preparedStock: prep ? shop.preparedStock : null,
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
  const prep = hasPrepAuthority(context);
  const shops = dm ? listShops(campaignId) : here ? listShopsAt(campaignId, here.id, here.name) : [];
  return Response.json({
    shops: shops.map((shop) => shopView(shop, prep)),
    here: here ? { id: here.id, name: here.name } : null,
    places: dm ? listLocations(campaignId).map((location) => ({ id: location.id, name: location.name })) : [],
    // Who may keep a shop: the cast, for the prep holder's editor.
    keepers: prep ? listNpcs(campaignId).filter((npc) => !npc.archived).map((npc) => ({ id: npc.id, name: npc.name })) : [],
    canPrep: prep,
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
  markup: z.number().min(0.5).max(3).optional(),
  // Stock the shelves from the pack, or start bare.
  stockFromPack: z.boolean().default(true),
  // Or start with a shelf written line by line, which is also what the
  // shop restocks to.
  stock: z.array(stockLineSchema).max(60).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requirePrepAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "A shop needs a name." }, { status: 400 });
  }
  const body = parsed.data;
  const problem = shopRefProblem(campaignId, { locationId: body.locationId, keeperNpcId: body.keeperNpcId });
  if (problem) {
    return Response.json({ error: problem }, { status: 400 });
  }
  const place = body.locationId ? listLocations(campaignId).find((location) => location.id === body.locationId) : getCurrentLocation(campaignId);
  const size = (["hamlet", "village", "town", "city"] as const).includes(body.size as "village") ? (body.size as keyof typeof SIZE_MARKUP) : "village";
  // A shelf written by hand, or a bare one, is the shop's prepared shelf; a
  // shop stocked from the pack rerolls from it.
  const written = body.stock ? normalizeStock(body.stock) : body.stockFromPack ? null : [];
  const shop = insertShop(campaignId, {
    name: body.name,
    kind: body.kind,
    size,
    locationId: place?.id ?? "",
    locationName: place?.name ?? body.locationName,
    keeperNpcId: body.keeperNpcId,
    buys: body.buys,
    restockDays: body.restockDays,
    stock: written ?? stockFromPool(stockPool(body.kind), size),
    preparedStock: written,
    markup: body.markup ?? SIZE_MARKUP[size],
    restockedAt: getClock(campaignId).instant,
  });
  publishEphemeral(campaignId, "shops_updated", { at: Date.now() });
  return Response.json({ shop: shopView(shop) });
}
