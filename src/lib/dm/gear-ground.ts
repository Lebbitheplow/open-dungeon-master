// handle_item on the ground (issue #424): a thing dropped lies where it fell
// (src/lib/db/dropped-items.ts), anyone within 5 ft may take it up, an enemy
// may hold it until it falls, and GAME STATE says where everything lies.
// The dispatcher and the hands are src/lib/dm/gear-tool.ts.
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, type Encounter } from "@/lib/db/encounters";
import { getTokenByRef } from "@/lib/db/battle-maps";
import { getCurrentLocation } from "@/lib/db/locations";
import { getSheetById } from "@/lib/db/sheets";
import {
  insertDroppedItem,
  listDroppedItems,
  moveDroppedItem,
  takeFromDroppedItem,
  type DroppedItem,
} from "@/lib/db/dropped-items";
import { getActiveBattleMap } from "@/lib/battlemap/view";
import { footprintDistance } from "@/lib/battlemap/footprint";
import { tokenFootprint } from "@/lib/dm/board-reach";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { hasFastHands } from "@/lib/dm/bonus-routes";
import { canAct } from "@/lib/dm/can-act";
import { resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { gearKindOf, holdIfFree, inHand, spendInteraction } from "@/lib/dm/gear-hands";
import { lineNamed, linesNamed } from "@/lib/srd/item-row";
import type { ItemTag } from "@/lib/schemas/item-tags";
import { ownBudget, refuse, retry, saveEquipment } from "@/lib/dm/gear-store";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { addRowMath, handedOverRow, removeItemMath } from "@/lib/dm/mutation-math";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { storeBudget } from "@/lib/dm/turn-budget";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

// ---- the ground ----

// Where a creature stands on the live board, and the board.
export function standing(campaignId: string, refId: string) {
  const map = getActiveBattleMap(campaignId);
  const token = map ? getTokenByRef(map.id, refId) : null;
  return { map, token };
}

export function placeName(campaignId: string): string {
  return getCurrentLocation(campaignId)?.name ?? "";
}

export function drop(
  campaign: Campaign,
  turn: DmTurn | null,
  encounter: Encounter | null,
  sheet: CharacterSheet,
  row: EquipmentItem,
  qty: number,
  reason: string,
): ToolResult {
  // Strapped on or worn, it does not simply fall: a shield takes an action
  // to take off, armor minutes (SRD 5.1, Getting Into and Out of Armor).
  const kind = gearKindOf(row);
  if (encounter && (kind === "armor" || kind === "shield") && inHand(row, sheet.equipment)) {
    return refuse(
      kind === "shield"
        ? `${row.name} is strapped on: taking it off is an action (handle_item unequip) before it can be dropped.`
        : `${sheet.name} is wearing ${row.name}; armor takes minutes to take off, so it is not dropped during a fight.`,
    );
  }
  const removal = removeItemMath(sheet.equipment, row.name, qty);
  if (!removal) {
    return retry(`${sheet.name} carries no "${row.name}".`);
  }
  const { map, token } = standing(campaign.id, sheet.id);
  const fell = insertDroppedItem({
    campaignId: campaign.id,
    mapId: map && token ? map.id : null,
    x: token?.x ?? null,
    y: token?.y ?? null,
    place: placeName(campaign.id),
    item: handedOverRow(row, removal.removed),
    droppedBy: sheet.name,
  });
  saveEquipment(campaign, turn, sheet, removal.equipment, "drop_item", { name: row.name, dropped: removal.removed }, reason || `Dropped ${row.name}`);
  if (map) {
    publishBattleMapUpdate(campaign.id);
  }
  return {
    ok: true,
    applied: `${sheet.name} drops ${removal.removed > 1 ? `${removal.removed} ` : ""}${row.name}. It lies ${token ? `at their feet (${token.x},${token.y})` : "where they stand"}${encounter ? ": dropping costs nothing" : ""}. Anyone within 5 ft can pick it up (handle_item pick_up, item "${fell.id}").`,
    groundId: fell.id,
  };
}

// The items a creature standing here may take: on the live board within
// 5 ft (a dead enemy's hold lies with its body), or, with no fight on, the
// ones left at this place.
function reachable(campaignId: string, encounter: Encounter | null, refId: string): Array<{ item: DroppedItem; apart: number | null }> {
  const { map, token } = standing(campaignId, refId);
  const here = textKey(placeName(campaignId));
  const out: Array<{ item: DroppedItem; apart: number | null }> = [];
  for (const item of listDroppedItems(campaignId)) {
    let at: { x: number; y: number } | null = item.x !== null && item.y !== null && item.mapId === map?.id ? { x: item.x, y: item.y } : null;
    if (item.heldByEnemy) {
      const enemy = getEnemy(item.heldByEnemy);
      const body = map && enemy && enemy.status === "dead" ? getTokenByRef(map.id, enemy.id) : null;
      if (!body) {
        continue;
      }
      at = { x: body.x, y: body.y };
    }
    if (at && token) {
      out.push({ item, apart: footprintDistance(token, tokenFootprint(token), at, 1) });
      continue;
    }
    if (!encounter && textKey(item.place) === here) {
      out.push({ item, apart: null });
    }
  }
  return out;
}

// The dropped thing a ref means: its id, else the lines its whole name
// picks out the way a carried line is found (src/lib/srd/item-row.ts
// linesNamed), the nearest of them first.
function findGround(candidates: Array<{ item: DroppedItem; apart: number | null }>, ref: string) {
  const byId = candidates.find((entry) => entry.item.id === ref);
  if (byId) {
    return byId;
  }
  const named = new Set(linesNamed(candidates.map((entry) => entry.item.item), ref));
  return candidates.filter((entry) => named.has(entry.item.item)).sort((a, b) => (a.apart ?? 0) - (b.apart ?? 0))[0] ?? null;
}

export function pickUp(
  campaign: Campaign,
  turn: DmTurn | null,
  encounter: Encounter | null,
  sheet: CharacterSheet,
  ref: string,
  qty: number,
  reason: string,
): ToolResult {
  const candidates = reachable(campaign.id, encounter, sheet.id);
  const found = findGround(candidates, ref);
  if (!found) {
    const lying = candidates.map((entry) => entry.item.item.name);
    return retry(`Nothing called "${ref}" lies where ${sheet.name} can reach it.${lying.length ? ` On the ground here: ${lying.join(", ")}.` : ""}`);
  }
  let budget: TurnBudget | null = null;
  let cost = "";
  if (encounter) {
    if (found.apart === null) {
      return refuse(`${found.item.item.name} lies at ${found.item.place || "the place it fell"}, off this board; it can be collected after the fight.`);
    }
    if (found.apart > 1) {
      return refuse(`${found.item.item.name} lies ${found.apart * 5} ft from ${sheet.name}; picking it up takes being within 5 ft of it. They move there first.`);
    }
    const able = canAct({ sheet, encounter, kind: "free" });
    if (!able.ok) {
      return toolError(able);
    }
    const own = ownBudget(encounter, sheet);
    if (!own) {
      return refuse(`Picking up ${found.item.item.name} happens on ${sheet.name}'s own turn.`);
    }
    const spent = spendInteraction(own, { what: `picking up ${found.item.item.name}`, who: sheet.name, fastHands: hasFastHands(sheet) });
    if (!spent.ok) {
      return toolError(spent);
    }
    budget = spent.budget;
    cost = spent.note ?? "";
  }
  const taken = Math.min(qty, found.item.item.qty);
  takeFromDroppedItem(found.item.id, taken);
  const fresh = getSheetById(sheet.id) ?? sheet;
  const hold = holdIfFree(addRowMath(fresh.equipment, handedOverRow(found.item.item, taken)), found.item.item.name);
  saveEquipment(campaign, turn, fresh, hold.equipment, "pick_up_item", { name: found.item.item.name, taken }, reason || `Picked up ${found.item.item.name}`);
  if (encounter && budget) {
    storeBudget(encounter, budget);
  }
  publishBattleMapUpdate(campaign.id);
  return {
    ok: true,
    applied: `${sheet.name} picks up ${taken > 1 ? `${taken} ` : ""}${found.item.item.name}${found.item.droppedBy && textKey(found.item.droppedBy) !== textKey(sheet.name) ? ` (dropped by ${found.item.droppedBy})` : ""}${hold.held ? "" : "; their hands are full, so it goes in the pack"}.`,
    ...(cost ? { cost } : {}),
  };
}

// ---- an enemy's hands ----

// The thing an enemy picked up earlier, by the names a carried line answers
// to (lineNamed).
function heldItemOf(campaignId: string, enemyId: string, itemName: string): DroppedItem | null {
  const held = listDroppedItems(campaignId).filter((entry) => entry.heldByEnemy === enemyId);
  return held[lineNamed(held.map((entry) => entry.item), itemName)] ?? null;
}

// Whether an enemy's drop is a thing it picked up earlier, which falls as it
// was; anything else is new to the table (src/lib/dm/ai-gate.ts asks what).
export function enemyHoldsItem(campaignId: string, ref: string, itemName: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  const enemy = encounter ? resolveEnemyRef(encounter.id, ref) : null;
  return Boolean(enemy && heldItemOf(campaignId, enemy.id, itemName));
}

export function enemyHandles(
  campaign: Campaign,
  encounter: Encounter | null,
  ref: string,
  action: "equip" | "unequip" | "drop" | "pick_up" | "hand",
  itemName: string,
  qty: number,
  // What a thing it lets fall is, when it held nothing by that name
  // (src/lib/dm/gear-tool.ts).
  facts: { srdName?: string; tags?: ItemTag[] } = {},
): ToolResult {
  if (!encounter) {
    return refuse("An enemy handles items in a fight; there is no fight running.");
  }
  const enemy = resolveEnemyRef(encounter.id, ref);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", ref);
  }
  if (enemy.status !== "alive") {
    return retry(`${enemy.displayName} is ${enemy.status}: only a living enemy handles items.`);
  }
  const { map, token } = standing(campaign.id, enemy.id);
  if (action === "drop") {
    // What it held, now on the ground: a blade knocked from its grip, a key
    // it let fall. Something it picked up earlier falls as it was.
    const held = heldItemOf(campaign.id, enemy.id, itemName);
    if (held) {
      moveDroppedItem(held.id, { mapId: map && token ? map.id : null, x: token?.x ?? null, y: token?.y ?? null, heldByEnemy: null });
    } else {
      insertDroppedItem({
        campaignId: campaign.id,
        mapId: map && token ? map.id : null,
        x: token?.x ?? null,
        y: token?.y ?? null,
        place: placeName(campaign.id),
        item: { name: itemName.slice(0, 80), qty, ...facts },
        droppedBy: enemy.displayName,
      });
    }
    publishBattleMapUpdate(campaign.id);
    return { ok: true, applied: `${enemy.displayName} drops ${itemName}; it lies at its feet for anyone within 5 ft to take.` };
  }
  if (action !== "pick_up") {
    return retry("An enemy may drop or pick_up; its own gear is its stat block.");
  }
  const candidates = reachable(campaign.id, encounter, enemy.id);
  const found = findGround(candidates, itemName);
  if (!found || found.apart === null) {
    const lying = candidates.filter((entry) => entry.apart !== null).map((entry) => entry.item.item.name);
    return retry(`Nothing called "${itemName}" lies on the board near ${enemy.displayName}.${lying.length ? ` On the board: ${lying.join(", ")}.` : ""}`);
  }
  if (found.apart > 1) {
    return refuse(`${found.item.item.name} lies ${found.apart * 5} ft from ${enemy.displayName}; it must be within 5 ft to take it.`);
  }
  moveDroppedItem(found.item.id, { mapId: map?.id ?? null, x: token?.x ?? null, y: token?.y ?? null, heldByEnemy: enemy.id });
  publishBattleMapUpdate(campaign.id);
  return {
    ok: true,
    applied: `${enemy.displayName} takes ${found.item.item.name}. It holds it until it falls or flees; if it falls, the item lies with it.`,
  };
}

// ---- what GAME STATE says lies about ----

// The items on the ground the DM should know of: on the board where they
// fell, on a fallen enemy's body, held by an enemy, and left at this place
// or others (issue #424). Empty when nothing was put down.
export function describeGround(campaignId: string): string[] {
  const items = listDroppedItems(campaignId);
  if (!items.length) {
    return [];
  }
  const map = getActiveBattleMap(campaignId);
  const here = textKey(placeName(campaignId));
  const lines: string[] = [];
  const elsewhere: string[] = [];
  for (const entry of items) {
    const name = `${entry.item.qty > 1 ? `${entry.item.qty} ` : ""}${entry.item.name}`;
    const who = entry.droppedBy ? `, dropped by ${entry.droppedBy}` : "";
    if (entry.heldByEnemy) {
      const enemy = getEnemy(entry.heldByEnemy);
      if (enemy) {
        lines.push(
          enemy.status === "dead"
            ? `${name} [${entry.id}] on ${enemy.displayName}'s body${who}`
            : `${enemy.displayName} holds ${name} [${entry.id}]${who}`,
        );
      }
      continue;
    }
    if (map && entry.mapId === map.id && entry.x !== null && entry.y !== null) {
      lines.push(`${name} [${entry.id}] on the board at (${entry.x},${entry.y})${who}`);
    } else if (textKey(entry.place) === here) {
      lines.push(`${name} [${entry.id}] left here${who}`);
    } else {
      elsewhere.push(`${name} at ${entry.place || "an earlier place"}`);
    }
  }
  return [
    ...lines,
    ...(elsewhere.length ? [`Left behind elsewhere: ${elsewhere.slice(0, 6).join(", ")}${elsewhere.length > 6 ? ` and ${elsewhere.length - 6} more` : ""}`] : []),
  ];
}
