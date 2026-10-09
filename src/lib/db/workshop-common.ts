import { getDatabase, nowIso } from "@/lib/db/core";
import { getWorkshopForUser, listWorkshopsForUser } from "@/lib/db/workshops";
import type { Campaign } from "@/lib/db/campaigns";
import type { BoardInventory } from "@/lib/workshop/board";

// A chapter workshop drawing on a shared one (#159).
//
// A long adventure is written as one workshop of recurring things (the
// cast, the places, the maps and fights that come back) and one workshop per
// chapter for that chapter's board, scenes and fights. The chapter names its
// shared workshop here, and from then on its storyboard's Who, Where, map
// and fight pickers list the shared workshop's rows beside its own, marked
// with where they live.
//
// The rules, all enforced below:
//
//   - Live, not pinned. A card that picks a shared NPC points at the shared
//     row itself, so it always reads that row as it is now; renaming the NPC
//     in the shared workshop renames it on every chapter's card. A shared row
//     that is deleted, or a shared workshop that is detached, leaves the
//     card's link visibly missing (src/lib/workshop/board.ts brokenLinks)
//     rather than silently empty.
//   - One level. A shared workshop cannot itself draw on another, and a
//     workshop that chapters draw on cannot start drawing on one, so a
//     chain never grows past chapter -> shared.
//   - Owner only. Both workshops belong to the same person: a workshop is
//     one person's prep space (src/lib/db/workshops.ts), and the picker only
//     offers that person's own.
//
// What a dependency means at the campaign end (reuse rather than duplicate)
// is src/lib/db/content-import.ts's job; what it means in a bundle is
// src/lib/db/workshop-bundle-export.ts's.

function commonIdOf(workshopId: string): string {
  const row = getDatabase()
    .prepare(`SELECT common_workshop_id AS id FROM campaigns WHERE id = ?`)
    .get(workshopId) as { id: string } | undefined;
  return row?.id ?? "";
}

// The shared workshop this one draws on, if it still exists and still
// belongs to the same person. A dangling id reads as none.
export function getCommonWorkshop(workshop: Pick<Campaign, "id" | "ownerUserId">): Campaign | null {
  const id = commonIdOf(workshop.id);
  return id ? getWorkshopForUser(id, workshop.ownerUserId) : null;
}

// The chapters that draw on a workshop.
export function chaptersOf(workshop: Pick<Campaign, "id" | "ownerUserId">): Array<{ id: string; title: string }> {
  return getDatabase()
    .prepare(
      `SELECT id, title FROM campaigns
        WHERE common_workshop_id = ? AND owner_user_id = ? AND kind = 'workshop'
        ORDER BY title COLLATE NOCASE`,
    )
    .all(workshop.id, workshop.ownerUserId) as Array<{ id: string; title: string }>;
}

// The workshops this one could draw on: the owner's others, minus any that
// draw on one themselves.
export function commonChoices(workshop: Pick<Campaign, "id" | "ownerUserId">): Array<{ id: string; title: string }> {
  return listWorkshopsForUser(workshop.ownerUserId)
    .filter((entry) => entry.id !== workshop.id && !commonIdOf(entry.id))
    .map((entry) => ({ id: entry.id, title: entry.title }));
}

export function setCommonWorkshop(
  workshop: Pick<Campaign, "id" | "ownerUserId">,
  commonId: string,
): { ok: true } | { error: string } {
  if (commonId) {
    if (commonId === workshop.id) {
      return { error: "A workshop cannot draw on itself." };
    }
    const common = getWorkshopForUser(commonId, workshop.ownerUserId);
    if (!common) {
      return { error: "That workshop is not one of yours." };
    }
    if (commonIdOf(common.id)) {
      return { error: `"${common.title}" draws on a shared workshop itself. Pick the one it draws on instead.` };
    }
    if (chaptersOf(workshop).length) {
      return { error: "Other chapters draw on this workshop, so it cannot draw on another one itself." };
    }
  }
  getDatabase()
    .prepare(`UPDATE campaigns SET common_workshop_id = ?, updated_at = ? WHERE id = ? AND kind = 'workshop'`)
    .run(commonId, nowIso(), workshop.id);
  return { ok: true };
}

// What a storyboard card may link to: this workshop's rows, then the shared
// workshop's, each marked with the workshop it lives in.
export function boardInventoryFor(campaignId: string, common: Pick<Campaign, "id" | "title"> | null): BoardInventory {
  const db = getDatabase();
  const read = (id: string, from?: string) => {
    const rows = (sql: string) =>
      (db.prepare(sql).all(id) as Array<{ id: string; name: string }>).map((row) =>
        from ? { ...row, from } : row,
      );
    return {
      npcs: rows(
        `SELECT id, name FROM npcs WHERE campaign_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE`,
      ),
      maps: rows(`SELECT id, name FROM prepared_maps WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`),
      encounters: rows(
        `SELECT id, name FROM encounter_templates WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
      ),
      locations: rows(`SELECT id, name FROM locations WHERE campaign_id = ? ORDER BY created_at`),
    };
  };
  const own = read(campaignId);
  if (!common) {
    return own;
  }
  const shared = read(common.id, common.title);
  return {
    npcs: [...own.npcs, ...shared.npcs],
    maps: [...own.maps, ...shared.maps],
    encounters: [...own.encounters, ...shared.encounters],
    locations: [...own.locations, ...shared.locations],
  };
}

// What a card in this campaign or workshop may link to, and the shared
// workshop that widens it. A campaign's own storyboard (the DM console's)
// has no shared workshop; only a workshop draws on one.
export function storyboardInventory(campaign: Pick<Campaign, "id" | "ownerUserId" | "kind">): {
  inventory: BoardInventory;
  common: Campaign | null;
} {
  const common = campaign.kind === "workshop" ? getCommonWorkshop(campaign) : null;
  return { inventory: boardInventoryFor(campaign.id, common), common };
}
