import type { SqliteDatabase } from "./driver.ts";
import type { WorkshopHazard } from "@/lib/srd/table-hazards";

// The traps, poisons and diseases a table plays with: its owner's and its
// DMs' workshop hazards, by lower-case name. src/lib/db/core.ts registers
// this as src/lib/srd/table-hazards.ts's reader. Kept for a minute per
// table; a workshop save clears it.

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; hazards: ReadonlyMap<string, WorkshopHazard> }>();

export function tableHazardsFrom(db: SqliteDatabase, campaignId: string): ReadonlyMap<string, WorkshopHazard> {
  const held = cache.get(campaignId);
  if (held && Date.now() - held.at < TTL_MS) {
    return held.hazards;
  }
  const hazards = new Map<string, WorkshopHazard>();
  const campaign = db
    .prepare(`SELECT owner_user_id, human_dm_user_id, assistant_dm_user_id FROM campaigns WHERE id = ?`)
    .get(campaignId) as { owner_user_id: string; human_dm_user_id: string | null; assistant_dm_user_id: string | null } | undefined;
  if (campaign) {
    const authors = [...new Set([campaign.owner_user_id, campaign.human_dm_user_id, campaign.assistant_dm_user_id].filter(Boolean))] as string[];
    for (const author of authors) {
      const rows = db
        .prepare(`SELECT id, name, data_json FROM homebrew_entries WHERE user_id = ? AND kind = 'hazard'`)
        .all(author) as Array<{ id: string; name: string; data_json: string }>;
      for (const row of rows) {
        const key = row.name.trim().toLowerCase().replace(/\s+/g, " ");
        if (hazards.has(key)) {
          continue;
        }
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(row.data_json) as Record<string, unknown>;
        } catch {
          continue;
        }
        const kind = data.hazardKind;
        if ((kind === "trap" || kind === "poison" || kind === "disease") && data[kind] && typeof data[kind] === "object") {
          hazards.set(key, { id: `homebrew:${row.id}`, name: row.name, hazardKind: kind, [kind]: data[kind] } as WorkshopHazard);
        }
      }
    }
  }
  cache.set(campaignId, { at: Date.now(), hazards });
  return hazards;
}

export function forgetTableHazards(): void {
  cache.clear();
}
