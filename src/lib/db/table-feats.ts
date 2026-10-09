import type { SqliteDatabase } from "./driver.ts";
import type { TableFeat } from "@/lib/srd/feat-effects";

// The workshop feats a table plays with: its owner's and its DMs' (the same
// authors src/lib/db/homebrew.ts tableAuthors reads), by lower-case name,
// with the published feat each runs as and its text. src/lib/db/core.ts
// registers this as src/lib/srd/feat-effects.ts's reader; it reads the
// database it is handed so the boot backfill can use it before any other
// module loads.
//
// Kept for a minute per table; a workshop save clears it.

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; feats: ReadonlyMap<string, TableFeat> }>();

export function tableFeatsFrom(db: SqliteDatabase, campaignId: string): ReadonlyMap<string, TableFeat> {
  const held = cache.get(campaignId);
  if (held && Date.now() - held.at < TTL_MS) {
    return held.feats;
  }
  const feats = new Map<string, TableFeat>();
  const campaign = db
    .prepare(`SELECT owner_user_id, human_dm_user_id, assistant_dm_user_id FROM campaigns WHERE id = ?`)
    .get(campaignId) as { owner_user_id: string; human_dm_user_id: string | null; assistant_dm_user_id: string | null } | undefined;
  if (campaign) {
    // The owner's feat wins a name two of the table's authors share.
    const authors = [...new Set([campaign.owner_user_id, campaign.human_dm_user_id, campaign.assistant_dm_user_id].filter(Boolean))] as string[];
    for (const author of authors) {
      const rows = db
        .prepare(`SELECT name, data_json FROM homebrew_entries WHERE user_id = ? AND kind = 'feat'`)
        .all(author) as Array<{ name: string; data_json: string }>;
      for (const row of rows) {
        const key = row.name.trim().toLowerCase().replace(/\s+/g, " ");
        if (feats.has(key)) {
          continue;
        }
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(row.data_json) as Record<string, unknown>;
        } catch {
          // A row that does not parse grants nothing.
        }
        const runsAs = typeof data.runsAs === "string" && data.runsAs ? data.runsAs : undefined;
        feats.set(key, { ...(runsAs ? { runsAs } : {}), desc: String(data.desc ?? "") });
      }
    }
  }
  cache.set(campaignId, { at: Date.now(), feats });
  return feats;
}

export function forgetTableFeats(): void {
  cache.clear();
}
