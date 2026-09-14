import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  clampMarkup,
  normalizeShopKind,
  normalizeShopSize,
  type Shop,
  type StockLine,
} from "@/lib/dm/shop-logic";

// Shops (docs/vtt-parity-implementation-plan.md 11.1): one row per shop,
// tied to a campaign location by id and remembered by name so a place
// renamed keeps its market.

type Row = {
  id: string;
  campaign_id: string;
  location_id: string;
  location_name: string;
  name: string;
  keeper_npc_id: string;
  kind: string;
  size: string;
  stock_json: string;
  markup: number;
  buys: number;
  restock_days: number;
  restocked_at: number;
  haggled_json: string;
  created_at: string;
  updated_at: string;
};

export function normalizeStock(raw: unknown): StockLine[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((line) => {
      const record = (line ?? {}) as Record<string, unknown>;
      return {
        itemName: String(record.itemName ?? record.name ?? "").trim().slice(0, 80),
        qty: Math.max(0, Math.min(999, Math.round(Number(record.qty) || 0))),
        priceCp: Math.max(1, Math.round(Number(record.priceCp) || 1)),
        note: String(record.note ?? "").slice(0, 120),
      };
    })
    .filter((line) => line.itemName && line.qty > 0)
    .slice(0, 60);
}

function map(row: Row): Shop {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    locationId: row.location_id,
    locationName: row.location_name,
    name: row.name,
    keeperNpcId: row.keeper_npc_id,
    kind: normalizeShopKind(row.kind),
    size: normalizeShopSize(row.size),
    stock: normalizeStock(parseJson(row.stock_json, [])),
    markup: clampMarkup(Number(row.markup) || 1),
    buys: row.buys === 1,
    restockDays: Math.max(0, Number(row.restock_days) || 0),
    restockedAt: Number(row.restocked_at) || 0,
    haggledBy: parseJson<string[]>(row.haggled_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listShops(campaignId: string): Shop[] {
  return (getDatabase().prepare(`SELECT * FROM shops WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`).all(campaignId) as Row[]).map(map);
}

// The shops at a place, by id first and by name for a place that was
// written before it had an id.
export function listShopsAt(campaignId: string, locationId: string, locationName: string): Shop[] {
  return listShops(campaignId).filter(
    (shop) => (shop.locationId && shop.locationId === locationId) || (!shop.locationId && shop.locationName.toLowerCase() === locationName.toLowerCase()),
  );
}

export function getShop(shopId: string): Shop | null {
  const row = getDatabase().prepare(`SELECT * FROM shops WHERE id = ?`).get(shopId) as Row | undefined;
  return row ? map(row) : null;
}

export function findShopByName(campaignId: string, name: string): Shop | null {
  const wanted = name.trim().toLowerCase();
  const shops = listShops(campaignId);
  return shops.find((shop) => shop.name.toLowerCase() === wanted) ?? shops.filter((shop) => shop.name.toLowerCase().includes(wanted)).at(0) ?? null;
}

export type ShopInput = {
  name: string;
  locationId?: string;
  locationName?: string;
  keeperNpcId?: string;
  kind?: string;
  size?: string;
  stock?: StockLine[];
  markup?: number;
  buys?: boolean;
  restockDays?: number;
  restockedAt?: number;
  haggledBy?: string[];
};

export function insertShop(campaignId: string, input: ShopInput): Shop {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO shops (id, campaign_id, location_id, location_name, name, keeper_npc_id, kind, size, stock_json, markup, buys, restock_days, restocked_at, haggled_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
    )
    .run(
      id,
      campaignId,
      input.locationId ?? "",
      (input.locationName ?? "").trim().slice(0, 120),
      input.name.trim().slice(0, 80) || "The shop",
      input.keeperNpcId ?? "",
      normalizeShopKind(input.kind),
      normalizeShopSize(input.size),
      JSON.stringify(normalizeStock(input.stock ?? [])),
      clampMarkup(input.markup ?? 1),
      input.buys === false ? 0 : 1,
      Math.max(0, Math.round(input.restockDays ?? 7)),
      Math.max(0, Math.round(input.restockedAt ?? 0)),
      now,
      now,
    );
  return getShop(id)!;
}

export function updateShop(shopId: string, patch: ShopInput | Partial<ShopInput>): Shop | null {
  const current = getShop(shopId);
  if (!current) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE shops SET location_id = ?, location_name = ?, name = ?, keeper_npc_id = ?, kind = ?, size = ?, stock_json = ?, markup = ?, buys = ?, restock_days = ?, restocked_at = ?, haggled_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      patch.locationId ?? current.locationId,
      (patch.locationName ?? current.locationName).trim().slice(0, 120),
      (patch.name ?? current.name).trim().slice(0, 80) || current.name,
      patch.keeperNpcId ?? current.keeperNpcId,
      normalizeShopKind(patch.kind ?? current.kind),
      normalizeShopSize(patch.size ?? current.size),
      JSON.stringify(normalizeStock(patch.stock ?? current.stock)),
      clampMarkup(patch.markup ?? current.markup),
      (patch.buys ?? current.buys) ? 1 : 0,
      Math.max(0, Math.round(patch.restockDays ?? current.restockDays)),
      Math.max(0, Math.round(patch.restockedAt ?? current.restockedAt)),
      JSON.stringify((patch.haggledBy ?? current.haggledBy).slice(0, 40)),
      nowIso(),
      shopId,
    );
  return getShop(shopId);
}

export function deleteShop(campaignId: string, shopId: string): boolean {
  return getDatabase().prepare(`DELETE FROM shops WHERE id = ? AND campaign_id = ?`).run(shopId, campaignId).changes > 0;
}
