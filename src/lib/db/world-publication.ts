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
import { parseRef, readDoc } from "@/lib/worldforge/model";

export function heldBackLoreIds(campaignId: string): Set<string> {
  const row = getDatabase().prepare(`SELECT doc_json FROM world_forge WHERE campaign_id = ?`).get(campaignId) as
    | { doc_json: string }
    | undefined;
  const held = new Set<string>();
  if (!row) {
    return held;
  }
  const doc = readDoc(parseJson<unknown>(row.doc_json, {}));
  for (const [ref, entry] of Object.entries(doc.entries)) {
    const parsed = parseRef(ref);
    if (parsed?.shelf === "lore" && entry.canon !== "canon") {
      held.add(parsed.id);
    }
  }
  return held;
}
