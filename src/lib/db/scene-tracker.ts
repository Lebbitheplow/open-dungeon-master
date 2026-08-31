import { getDatabase, parseJson } from "@/lib/db/core";
import { normalizeTracker, type SceneTracker } from "@/lib/dm/scene-tracker-logic";

// The running structured scene, if there is one.
//
// One column on the campaign row, not a table: there is at most one at a
// time, for the same reason there is at most one active encounter. A finished
// tracker stays in the column so the console can show how the last one went
// until the next begins.

export function getSceneTracker(campaignId: string): SceneTracker | null {
  const row = getDatabase()
    .prepare(`SELECT scene_tracker_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { scene_tracker_json?: string } | undefined;
  return normalizeTracker(parseJson(row?.scene_tracker_json ?? "", null));
}

export function setSceneTracker(campaignId: string, tracker: SceneTracker | null) {
  getDatabase()
    .prepare(`UPDATE campaigns SET scene_tracker_json = ? WHERE id = ?`)
    .run(tracker ? JSON.stringify(tracker) : "", campaignId);
}
