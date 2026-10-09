import { z } from "zod";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  clampMarkup,
  MAX_STOCK_PRICE_CP,
  normalizeShopKind,
  normalizeShopSize,
  type Shop,
  type StockLine,
} from "@/lib/dm/shop-logic";

// Shops (docs/vtt-parity-implementation-plan.md 11.1): one row per shop,
// tied to a campaign location by id and remembered by name so a place
// renamed keeps its market. A shelf a person writes is also kept as the
// shop's prepared shelf (#171), which restocks refill and imports carry.

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
  prepared_stock_json: string;
  markup: number;
  buys: number;
  restock_days: number;
  restocked_at: number;
  haggled_json: string;
  created_at: string;
  updated_at: string;
};

// One shelf line as a person writes it, for the shop routes (#171).
export const stockLineSchema = z.object({
  itemName: z.string().trim().min(1).max(80),
  qty: z.number().int().min(0).max(999),
  priceCp: z.number().int().min(1).max(MAX_STOCK_PRICE_CP),
  note: z.string().max(120).default(""),
});

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
        priceCp: Math.min(MAX_STOCK_PRICE_CP, Math.max(1, Math.round(Number(record.priceCp) || 1))),
        note: String(record.note ?? "").slice(0, 120),
      };
    })
    .filter((line) => line.itemName && line.qty > 0)
    .reduce<StockLine[]>((shelf, line) => {
      // One line per item: a second "Lantern" line would never be found by
      // name, and could never be bought.
      const same = shelf.find((entry) => entry.itemName.toLowerCase() === line.itemName.toLowerCase());
      if (same) {
        same.qty = Math.min(999, same.qty + line.qty);
      } else {
        shelf.push(line);
      }
      return shelf;
    }, [])
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
    preparedStock: row.prepared_stock_json ? normalizeStock(parseJson(row.prepared_stock_json, [])) : null,
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

function byName(shops: Shop[], name: string): Shop | null {
  const wanted = name.trim().toLowerCase();
  return shops.find((shop) => shop.name.toLowerCase() === wanted) ?? shops.filter((shop) => shop.name.toLowerCase().includes(wanted)).at(0) ?? null;
}

export function findShopByName(campaignId: string, name: string): Shop | null {
  return byName(listShops(campaignId), name);
}

// A shop by name as the party would mean it: one at the place they stand
// first, then anywhere. Two towns can each have a "General Store", and the
// one across the map is not the one being shopped in.
export function findShopNear(campaignId: string, place: { id: string; name: string } | null, name: string): Shop | null {
  return (place ? byName(listShopsAt(campaignId, place.id, place.name), name) : null) ?? findShopByName(campaignId, name);
}

// A shop's place and keeper must be rows of its own campaign: an id from
// another table would read that table's names into this one. Returns the
// reason when one is not.
export function shopRefProblem(campaignId: string, refs: { locationId?: string; keeperNpcId?: string }): string | null {
  const db = getDatabase();
  if (refs.locationId && !db.prepare(`SELECT 1 FROM locations WHERE id = ? AND campaign_id = ?`).get(refs.locationId, campaignId)) {
    return "That place is not in this campaign.";
  }
  if (refs.keeperNpcId && !db.prepare(`SELECT 1 FROM npcs WHERE id = ? AND campaign_id = ?`).get(refs.keeperNpcId, campaignId)) {
    return "That keeper is not in this campaign's cast.";
  }
  return null;
}

export type ShopInput = {
  name: string;
  locationId?: string;
  locationName?: string;
  keeperNpcId?: string;
  kind?: string;
  size?: string;
  stock?: StockLine[];
  // The shelf as a person wrote it; null stocks from the pack again.
  preparedStock?: StockLine[] | null;
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
      `INSERT INTO shops (id, campaign_id, location_id, location_name, name, keeper_npc_id, kind, size, stock_json, prepared_stock_json, markup, buys, restock_days, restocked_at, haggled_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
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
      preparedColumn(input.preparedStock ?? null),
      clampMarkup(input.markup ?? 1),
      input.buys === false ? 0 : 1,
      Math.max(0, Math.round(input.restockDays ?? 7)),
      Math.max(0, Math.round(input.restockedAt ?? 0)),
      now,
      now,
    );
  return getShop(id)!;
}

function preparedColumn(prepared: StockLine[] | null): string {
  return prepared ? JSON.stringify(normalizeStock(prepared)) : "";
}

export function updateShop(shopId: string, patch: ShopInput | Partial<ShopInput>): Shop | null {
  const current = getShop(shopId);
  if (!current) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE shops SET location_id = ?, location_name = ?, name = ?, keeper_npc_id = ?, kind = ?, size = ?, stock_json = ?, prepared_stock_json = ?, markup = ?, buys = ?, restock_days = ?, restocked_at = ?, haggled_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      patch.locationId ?? current.locationId,
      (patch.locationName ?? current.locationName).trim().slice(0, 120),
      (patch.name ?? current.name).trim().slice(0, 80) || current.name,
      patch.keeperNpcId ?? current.keeperNpcId,
      normalizeShopKind(patch.kind ?? current.kind),
      normalizeShopSize(patch.size ?? current.size),
      JSON.stringify(normalizeStock(patch.stock ?? current.stock)),
      preparedColumn(patch.preparedStock === undefined ? current.preparedStock : patch.preparedStock),
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
