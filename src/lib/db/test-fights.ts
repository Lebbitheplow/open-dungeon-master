import { getDatabase } from "@/lib/db/core";

// Where a test fight (issue 553, src/lib/workshop/test-fight.ts) is found.
// A test table is a campaigns row of kind 'playtest', linked to the workshop
// it tests through the same campaign_workshops row any table made from a
// workshop has (src/lib/db/campaign-workshops.ts). No list of campaigns or
// workshops shows one, so these are the only ways back to it.

export type OpenTestFight = { id: string; title: string; createdAt: string };

// The author's open test of this workshop, newest first. Starting a test
// ends the one before it, so this is one row or none.
export function testFightsOf(workshopId: string, userId: string): OpenTestFight[] {
  return (
    getDatabase()
      .prepare(
        `SELECT c.id, c.title, c.created_at FROM campaigns c
           JOIN campaign_workshops cw ON cw.campaign_id = c.id
          WHERE c.kind = 'playtest' AND c.owner_user_id = ? AND cw.workshop_id = ?
          ORDER BY c.created_at DESC`,
      )
      .all(userId, workshopId) as Array<{ id: string; title: string; created_at: string }>
  ).map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at }));
}

// The author's test tables that lost their workshop: a link removed by
// hand, or a workshop gone some way other than its own delete route. Nobody
// could reach them again.
export function strandedTestFights(userId: string): string[] {
  return (
    getDatabase()
      .prepare(
        `SELECT c.id FROM campaigns c
          WHERE c.kind = 'playtest' AND c.owner_user_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM campaign_workshops cw
                JOIN campaigns w ON w.id = cw.workshop_id AND w.kind = 'workshop'
               WHERE cw.campaign_id = c.id
            )`,
      )
      .all(userId) as Array<{ id: string }>
  ).map((row) => row.id);
}

// Every test table of a workshop, whoever made it: the workshop's delete
// takes them with it.
export function allTestFightsOf(workshopId: string): string[] {
  return (
    getDatabase()
      .prepare(
        `SELECT c.id FROM campaigns c
           JOIN campaign_workshops cw ON cw.campaign_id = c.id
          WHERE c.kind = 'playtest' AND cw.workshop_id = ?`,
      )
      .all(workshopId) as Array<{ id: string }>
  ).map((row) => row.id);
}

// The workshop a test table tests, for the table's own way back.
export function testFightSource(campaignId: string): { workshopId: string; title: string } | null {
  const row = getDatabase()
    .prepare(
      `SELECT w.id, w.title FROM campaign_workshops cw
         JOIN campaigns w ON w.id = cw.workshop_id AND w.kind = 'workshop'
         JOIN campaigns c ON c.id = cw.campaign_id AND c.kind = 'playtest'
        WHERE cw.campaign_id = ?
        LIMIT 1`,
    )
    .get(campaignId) as { id: string; title: string } | undefined;
  return row ? { workshopId: row.id, title: row.title } : null;
}
