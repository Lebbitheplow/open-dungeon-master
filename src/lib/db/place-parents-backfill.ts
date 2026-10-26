import type { SqliteDatabase } from "./driver.ts";
import { parentsByName } from "@/lib/overworld/places";
import type { XY } from "@/lib/overworld/logic";

// The places already on record when locations gained a parent (issue 548),
// filed once by the name rule (src/lib/overworld/places.ts parentsByName):
// "Duskleaf Shrine Root Cellar" under "Duskleaf Shrine", unless its dot
// already stands far from the shrine's. Run by the migration that adds the
// column (src/lib/db/core.ts), so an upgraded campaign's map folds its rooms
// the way a new one's does; the browser seed runs it on the tables it
// builds the old way. Takes the handle rather than opening one, since the
// migration runs while the database is still being opened.
export function fileSubAreasByName(db: SqliteDatabase, campaignId?: string) {
  const campaigns = campaignId
    ? [{ campaign_id: campaignId }]
    : (db.prepare(`SELECT DISTINCT campaign_id FROM locations`).all() as Array<{ campaign_id: string }>);
  const write = db.prepare(`UPDATE locations SET parent_name = ? WHERE id = ? AND parent_name IS NULL`);
  for (const { campaign_id: id } of campaigns) {
    const places = db.prepare(`SELECT id, name FROM locations WHERE campaign_id = ?`).all(id) as Array<{ id: string; name: string }>;
    if (places.length < 2) {
      continue;
    }
    const map = db.prepare(`SELECT anchors_json FROM overworld_maps WHERE campaign_id = ?`).get(id) as { anchors_json: string } | undefined;
    let anchors: Record<string, XY> = {};
    try {
      anchors = map ? (JSON.parse(map.anchors_json) as Record<string, XY>) : {};
    } catch {
      anchors = {};
    }
    for (const [placeId, parentName] of parentsByName(places, anchors)) {
      write.run(parentName, placeId);
    }
  }
}
