import { getDatabase, nowIso } from "@/lib/db/core";

// The workshops a table starts from.
//
// A table is made from a workshop when its DM chooses that workshop under
// Start from, at creation or later in the lobby, and the import goes through
// (src/lib/db/content-import.ts runContentImport writes the link). The link
// is its own row rather than read off the copied prep's origins
// (src/lib/db/content-origins.ts) because a workshop can hold nothing to copy
// and still be what the table starts from: one holding only pregens, house
// rules, a region map or WorldForge copies no prep row, yet its pregens are
// meant for this table (src/lib/db/pregen-offers.ts). Who may make the link
// is the import's question (src/lib/db/import-sources.ts), never this
// module's.

export function linkWorkshop(campaignId: string, workshopId: string): void {
  getDatabase()
    .prepare(`INSERT OR IGNORE INTO campaign_workshops (campaign_id, workshop_id, created_at) VALUES (?, ?, ?)`)
    .run(campaignId, workshopId, nowIso());
}

// Whether this table starts from that workshop.
export function drawsFrom(campaignId: string, workshopId: string): boolean {
  return Boolean(
    getDatabase()
      .prepare(`SELECT 1 FROM campaign_workshops WHERE campaign_id = ? AND workshop_id = ?`)
      .get(campaignId, workshopId),
  );
}
