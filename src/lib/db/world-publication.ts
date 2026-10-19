// Which lore rows WorldForge holds back from players: those whose world
// entry is not canon yet (draft, alternate, retired). Canon and visibility
// stay separate decisions. Visibility is the author's choice of audience
// (the table, or the DM alone); canon is whether the entry is settled. A
// player reads an entry only when both allow it, so a draft never reaches the
// table and a deliberately private canon entry stays private
// (worldforge-workshop-integration-audit WF-01).
//
// Read straight from the world document rather than through world-forge.ts,
// which itself reads the lore module.
import { getDatabase, parseJson } from "@/lib/db/core";
import { parseRef, readDoc, type Canon } from "@/lib/worldforge/model";

// Those rows with the state that holds each back, for the paths that hand
// lore to a model: they follow the canon policy (src/lib/worldforge/canon.ts,
// WF-14), so a draft is marked, an alternate marked as another telling, and a
// retired entry left out.
export function heldBackLore(campaignId: string): Map<string, Exclude<Canon, "canon">> {
  const row = getDatabase().prepare(`SELECT doc_json FROM world_forge WHERE campaign_id = ?`).get(campaignId) as
    | { doc_json: string }
    | undefined;
  const held = new Map<string, Exclude<Canon, "canon">>();
  if (!row) {
    return held;
  }
  const doc = readDoc(parseJson<unknown>(row.doc_json, {}));
  for (const [ref, entry] of Object.entries(doc.entries)) {
    const parsed = parseRef(ref);
    if (parsed?.shelf === "lore" && entry.canon !== "canon") {
      held.set(parsed.id, entry.canon);
    }
  }
  return held;
}
