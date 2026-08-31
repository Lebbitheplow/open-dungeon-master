import { getDatabase } from "@/lib/db/core";
import { setQuestLog, setStoryArc, type Campaign } from "@/lib/db/campaigns";
import { normalizeStoryArc } from "@/lib/dm/arc-logic";
import { dedupeName } from "@/lib/workshop/import";
import type { CompiledBoard } from "@/lib/workshop/board-compile";

// Writing a compiled storyboard into a campaign.
//
// The storyboard is the one import kind that is COMPILED rather than copied:
// one board becomes lore entries, quests, prepared encounters, DM-only notes
// and a story arc (src/lib/workshop/board-compile.ts decides what becomes
// what). Nothing new is built at the campaign end to receive it, which is
// the test of whether the node kinds were chosen correctly.
//
// Split from content-import.ts to keep both files under the project's
// 500-line cap. Both halves still run inside that module's transaction:
// getDatabase() is a singleton connection, so a statement issued here during
// the enclosing db.transaction() is part of it and rolls back with it.

// The rows. Runs inside the import transaction.
export function writeStoryboardRows(
  campaignId: string,
  ownerUserId: string,
  compiled: CompiledBoard,
  now: string,
): number {
  const db = getDatabase();
  let written = 0;

  // Places and history become lore, through the same table the lore kind
  // copies into, so a board and a hand-written world bible are
  // indistinguishable once they arrive.
  const loreTaken = new Set(
    (
      db.prepare(`SELECT title FROM lore_entries WHERE campaign_id = ?`).all(campaignId) as Array<{
        title: string;
      }>
    ).map((row) => row.title.trim().toLowerCase()),
  );
  for (const entry of compiled.lore) {
    db.prepare(
      `INSERT INTO lore_entries
         (id, campaign_id, category, title, body, tags_json, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '["storyboard"]', 0, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      campaignId,
      entry.category,
      dedupeName(entry.title, loreTaken),
      entry.body,
      now,
      now,
    );
    written += 1;
  }

  // Fights become prepared encounters with an EMPTY roster. The board says a
  // fight belongs here, not what is in it, and a roster invented from a card
  // title would be a fight nobody wrote. The DM fills it in, and the
  // difficulty readout tells them what it costs.
  const encounterTaken = new Set(
    (
      db
        .prepare(`SELECT name FROM encounter_templates WHERE campaign_id = ?`)
        .all(campaignId) as Array<{ name: string }>
    ).map((row) => row.name.trim().toLowerCase()),
  );
  for (const entry of compiled.encounters) {
    db.prepare(
      `INSERT INTO encounter_templates
         (id, campaign_id, name, enemies_json, battlefield, map_json, notes,
          created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, '[]', '', '{}', ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      campaignId,
      dedupeName(entry.name, encounterTaken),
      entry.notes,
      ownerUserId,
      now,
      now,
    );
    written += 1;
  }

  // Secrets become DM-only notes. campaign_notes carries a visibility column
  // and a "dm" author kind, which is exactly the shape for something the
  // party must not read, and the one thing a secret must never compile into
  // is anything they can.
  const seq =
    (
      db
        .prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_notes WHERE campaign_id = ?`)
        .get(campaignId) as { seq: number } | undefined
    )?.seq ?? 0;
  compiled.notes.forEach((entry, index) => {
    db.prepare(
      `INSERT INTO campaign_notes
         (id, campaign_id, character_id, author_user_id, author_kind, visibility,
          status, pinned, title, body, seq, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'dm', 'private', 'active', 0, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      campaignId,
      ownerUserId,
      entry.title.slice(0, 120),
      entry.body.slice(0, 2000),
      seq + index + 1,
      now,
      now,
    );
    written += 1;
  });

  return written;
}

// The two single columns on campaigns, written after the transaction the way
// the house rules are: one write each rather than a loop.
export function writeStoryboardColumns(
  campaign: Campaign,
  compiled: CompiledBoard,
  now: string,
): number {
  let written = 0;

  // Hooks become quests, appended rather than replacing: a campaign in
  // progress has a quest log the party is working through.
  if (compiled.quests.length) {
    setQuestLog(campaign.id, [...campaign.questLog, ...compiled.quests]);
    written += 1;
  }

  // The board's beats become the campaign's spine, but ONLY where there is
  // no spine already. A campaign in progress has an arc with beats marked
  // done and detail accreted from actual play; overwriting that with a prep
  // document would delete the campaign's memory of itself.
  if (campaign.storyArc) {
    return written;
  }
  const arc = normalizeStoryArc({
    version: 3,
    premise: compiled.premise,
    stakes: "",
    antagonist: "",
    beats: compiled.arcBeats.map((text) => ({ text, status: "pending", act: 1 })),
    acts: 1,
    finale: "",
    saga: null,
    cast: [],
    events: [],
    subArcs: [],
    worldArcs: [],
    updatedAt: now,
  });
  // normalizeStoryArc refuses an arc with no premise or fewer than two beats,
  // and a refusal is the right answer: half a spine is worse than none,
  // because the engine would treat it as the whole plan.
  if (arc) {
    setStoryArc(campaign.id, arc);
    written += 1;
  }
  return written;
}
