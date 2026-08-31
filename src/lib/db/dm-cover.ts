import { getDatabase, parseJson } from "@/lib/db/core";
import { consumeCover, normalizeCover, type DmCover } from "@/lib/dm/delegation";

// Reading and writing the stretch of answers a human DM handed to the AI.
//
// One column on the campaign row rather than a table of its own: there is at
// most one of these per campaign, it is replaced rather than accumulated, and
// rowToCampaign already hydrates it onto every Campaign the app loads. The
// functions here exist for the two callers that need it fresher than the
// Campaign they were handed: the action route, which spends one, and the
// console, which stops one.

export function getDmCover(campaignId: string): DmCover | null {
  const row = getDatabase()
    .prepare(`SELECT dm_cover_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { dm_cover_json?: string } | undefined;
  return normalizeCover(parseJson(row?.dm_cover_json ?? "", null));
}

export function setDmCover(campaignId: string, cover: DmCover | null) {
  getDatabase()
    .prepare(`UPDATE campaigns SET dm_cover_json = ? WHERE id = ?`)
    .run(cover ? JSON.stringify(cover) : "", campaignId);
}

// Spending one of the handed-over answers. Re-reads and writes in one place
// so two actions landing together cannot both spend the same one, and returns
// what is left so the caller can publish it without a second read.
export function consumeDmCoverTurn(campaignId: string): DmCover | null {
  const current = getDmCover(campaignId);
  const next = consumeCover(current);
  if (next !== current) {
    setDmCover(campaignId, next);
  }
  return next;
}
