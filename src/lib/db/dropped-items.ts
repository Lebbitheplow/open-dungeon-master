import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { listEnemies } from "@/lib/db/encounters";
import type { EquipmentItem } from "@/lib/schemas/sheet";

// Things put down rather than lost (issue #424). Each row is one carried
// row (its quantity with it) lying on the ground: on the board where it fell
// while that board is up, and at the place it fell after. An enemy that
// picks one up holds it until it falls or the fight ends
// (src/lib/dm/gear-tool.ts, src/lib/dm/enemy-damage.ts finishEncounter).

export type DroppedItem = {
  id: string;
  campaignId: string;
  // The board it lies on (battle_maps.id) and its square there; null for a
  // drop with no board up.
  mapId: string | null;
  x: number | null;
  y: number | null;
  // The place the party was when it fell (the current location's name).
  place: string;
  item: EquipmentItem;
  droppedBy: string;
  // The enemy holding it (encounter_enemies.id), or null on the ground.
  heldByEnemy: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  campaign_id: string;
  map_id: string | null;
  x: number | null;
  y: number | null;
  place: string;
  item_json: string;
  dropped_by: string;
  held_by_enemy: string | null;
  created_at: string;
};

function mapRow(row: Row): DroppedItem {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    mapId: row.map_id,
    x: row.x,
    y: row.y,
    place: row.place,
    item: parseJson<EquipmentItem>(row.item_json, { name: "something", qty: 1 }),
    droppedBy: row.dropped_by,
    heldByEnemy: row.held_by_enemy,
    createdAt: row.created_at,
  };
}

export function listDroppedItems(campaignId: string): DroppedItem[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM dropped_items WHERE campaign_id = ? ORDER BY created_at, id`)
    .all(campaignId) as Row[];
  return rows.map(mapRow);
}

export function getDroppedItem(id: string): DroppedItem | null {
  const row = getDatabase().prepare(`SELECT * FROM dropped_items WHERE id = ?`).get(id) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function insertDroppedItem(input: {
  campaignId: string;
  mapId: string | null;
  x: number | null;
  y: number | null;
  place: string;
  item: EquipmentItem;
  droppedBy: string;
  heldByEnemy?: string | null;
}): DroppedItem {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO dropped_items (id, campaign_id, map_id, x, y, place, item_json, dropped_by, held_by_enemy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.mapId,
      input.x,
      input.y,
      input.place.slice(0, 120),
      JSON.stringify(input.item),
      input.droppedBy.slice(0, 80),
      input.heldByEnemy ?? null,
      nowIso(),
    );
  return getDroppedItem(id)!;
}

// Where it lies now: a square on a board (or none), and who holds it.
export function moveDroppedItem(
  id: string,
  at: { mapId: string | null; x: number | null; y: number | null; heldByEnemy: string | null },
) {
  getDatabase()
    .prepare(`UPDATE dropped_items SET map_id = ?, x = ?, y = ?, held_by_enemy = ? WHERE id = ?`)
    .run(at.mapId, at.x, at.y, at.heldByEnemy, id);
}

// Picked up, or part of it: the rest stays where it lies.
export function takeFromDroppedItem(id: string, qty: number): DroppedItem | null {
  const item = getDroppedItem(id);
  if (!item) {
    return null;
  }
  const left = item.item.qty - qty;
  if (left <= 0) {
    getDatabase().prepare(`DELETE FROM dropped_items WHERE id = ?`).run(id);
  } else {
    getDatabase()
      .prepare(`UPDATE dropped_items SET item_json = ? WHERE id = ?`)
      .run(JSON.stringify({ ...item.item, qty: left }), id);
  }
  return item;
}

// A fight ends (src/lib/dm/enemy-damage.ts finishEncounter): what a fallen
// enemy held falls where its body lies, what a fled one held goes with it,
// and everything still on the board stays where it fell, at this place.
// Returns the lines the DM is told.
export function settleDroppedOnFightEnd(campaignId: string, encounterId: string): string[] {
  const map = getBattleMapForEncounter(encounterId);
  const enemies = new Map(listEnemies(encounterId).map((enemy) => [enemy.id, enemy]));
  const left: string[] = [];
  for (const entry of listDroppedItems(campaignId)) {
    const name = `${entry.item.qty > 1 ? `${entry.item.qty} ` : ""}${entry.item.name}`;
    const holder = entry.heldByEnemy ? enemies.get(entry.heldByEnemy) : null;
    if (holder) {
      if (holder.status !== "dead") {
        left.push(holder.status === "fled" ? `${holder.displayName} fled with ${name}` : `${holder.displayName} keeps ${name}`);
        continue;
      }
      const body = map ? getTokenByRef(map.id, holder.id) : null;
      moveDroppedItem(entry.id, { mapId: map?.id ?? null, x: body?.x ?? null, y: body?.y ?? null, heldByEnemy: null });
      left.push(`${name} lies with ${holder.displayName}`);
      continue;
    }
    if (map && entry.mapId === map.id) {
      left.push(`${name}${entry.droppedBy ? ` (dropped by ${entry.droppedBy})` : ""}`);
    }
  }
  return left;
}
