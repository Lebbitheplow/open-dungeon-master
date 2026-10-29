import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  arcQuestStatus,
  normalizeObjectives,
  normalizeQuestStatus,
  QUEST_TITLE_MAX,
  reconcileSubArcs,
  type Quest,
  type QuestObjective,
  type QuestStatus,
} from "@/lib/dm/quest-logic";

// Quest storage (docs/vtt-parity-implementation-plan.md section 5.7). The
// arc's sub-arcs are mirrored in here as source "arc" rows so the DM can
// tick objectives under them; hand-written rows are source "dm".

type QuestRow = {
  id: string;
  campaign_id: string;
  title: string;
  status: string;
  objectives_json: string;
  source: string;
  source_ref: string;
  visibility: string;
  created_at: string;
  updated_at: string;
};

function mapQuest(row: QuestRow): Quest {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    status: normalizeQuestStatus(row.status),
    objectives: normalizeObjectives(parseJson<unknown>(row.objectives_json, [])),
    source: row.source === "arc" ? "arc" : "dm",
    sourceRef: row.source_ref ?? "",
    visibility: row.visibility === "dm" ? "dm" : "party",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listQuests(campaignId: string): Quest[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM quests WHERE campaign_id = ? ORDER BY created_at ASC`)
    .all(campaignId) as QuestRow[];
  return rows.map(mapQuest);
}

export function getQuest(questId: string): Quest | null {
  const row = getDatabase().prepare(`SELECT * FROM quests WHERE id = ?`).get(questId) as QuestRow | undefined;
  return row ? mapQuest(row) : null;
}

export function insertQuest(input: {
  campaignId: string;
  title: string;
  status?: QuestStatus;
  objectives?: QuestObjective[];
  source?: "arc" | "dm";
  sourceRef?: string;
  visibility?: "party" | "dm";
}): Quest {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO quests (id, campaign_id, title, status, objectives_json, source, source_ref, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.title.trim().slice(0, QUEST_TITLE_MAX),
      normalizeQuestStatus(input.status),
      JSON.stringify(input.objectives ?? []),
      input.source === "arc" ? "arc" : "dm",
      input.sourceRef ?? "",
      input.visibility === "dm" ? "dm" : "party",
      now,
      now,
    );
  return getQuest(id)!;
}

export function updateQuest(
  questId: string,
  patch: { title?: string; status?: QuestStatus; objectives?: QuestObjective[]; visibility?: "party" | "dm" },
): Quest | null {
  const quest = getQuest(questId);
  if (!quest) {
    return null;
  }
  getDatabase()
    .prepare(`UPDATE quests SET title = ?, status = ?, objectives_json = ?, visibility = ?, updated_at = ? WHERE id = ?`)
    .run(
      (patch.title ?? quest.title).trim().slice(0, QUEST_TITLE_MAX) || quest.title,
      normalizeQuestStatus(patch.status ?? quest.status),
      JSON.stringify(patch.objectives ?? quest.objectives),
      patch.visibility ?? quest.visibility,
      nowIso(),
      questId,
    );
  return getQuest(questId);
}

export function deleteQuest(questId: string): void {
  getDatabase().prepare(`DELETE FROM quests WHERE id = ?`).run(questId);
}

type ArcThread = { id: string; name: string; goal: string; status: "pending" | "active" | "resolved" | "abandoned" };

// The sub-arcs as their quest rows have them (quest-logic.ts
// reconcileSubArcs), for setStoryArc to store: a quest the table settled or
// renamed stands against an older copy of the arc.
export function reconcileArcQuests<T extends ArcThread>(campaignId: string, subArcs: readonly T[]): T[] {
  return reconcileSubArcs(subArcs, listQuests(campaignId).filter((quest) => quest.source === "arc"));
}

// Mirrors the arc's sub-arcs: one arc row per sub-arc, matched by id, with
// the DM's ticks kept. A row's own status and title stand (quest-logic.ts
// arcQuestStatus). A sub-arc that left the arc takes its row with it while
// the quest is open; a settled quest stays on the log as what the party did,
// since the arc sheds settled threads once it grows long, but no longer
// answers to the sub-arc's id: ids are numbered from the arc's highest, so a
// later thread can be given a shed one, and it would have taken the old
// quest's title, mark and ticks. Hand-written rows are never touched.
// `changed` says whether any row did, so the caller can tell the table.
export function syncArcQuests<T extends ArcThread>(campaignId: string, subArcs: readonly T[]): boolean {
  const db = getDatabase();
  const existing = listQuests(campaignId).filter((quest) => quest.source === "arc" && quest.sourceRef);
  const byRef = new Map(existing.map((quest) => [quest.sourceRef, quest]));
  const now = nowIso();
  let changed = false;
  db.transaction(() => {
    const seen = new Set<string>();
    for (const subArc of subArcs) {
      seen.add(subArc.id);
      const current = byRef.get(subArc.id);
      const status = arcQuestStatus(subArc.status, current?.status);
      if (current) {
        if (current.status !== status) {
          db.prepare(`UPDATE quests SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, current.id);
          changed = true;
        }
      } else {
        const objectives = [{ id: "goal", text: subArc.goal.slice(0, 240), done: status === "done" }];
        db.prepare(
          `INSERT INTO quests (id, campaign_id, title, status, objectives_json, source, source_ref, visibility, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'arc', ?, 'party', ?, ?)`,
        ).run(crypto.randomUUID(), campaignId, subArc.name.slice(0, QUEST_TITLE_MAX), status, JSON.stringify(objectives), subArc.id, now, now);
        changed = true;
      }
    }
    for (const quest of existing) {
      if (seen.has(quest.sourceRef)) {
        continue;
      }
      if (quest.status === "active" || quest.status === "hidden") {
        db.prepare(`DELETE FROM quests WHERE id = ?`).run(quest.id);
      } else {
        db.prepare(`UPDATE quests SET source_ref = '', updated_at = ? WHERE id = ?`).run(now, quest.id);
      }
      changed = true;
    }
  })();
  return changed;
}

// A fresh arc in place of the old one (the lead's regenerate): the old
// threads are gone, so their open quests go and their settled ones stay as
// history, answering to no id. The new arc numbers its threads from sa1
// again, and every one of them would have taken an old quest's row.
export function retireArcQuests(campaignId: string): boolean {
  const db = getDatabase();
  const now = nowIso();
  let changed = false;
  for (const quest of listQuests(campaignId)) {
    if (quest.source !== "arc" || !quest.sourceRef) {
      continue;
    }
    if (quest.status === "active" || quest.status === "hidden") {
      db.prepare(`DELETE FROM quests WHERE id = ?`).run(quest.id);
    } else {
      db.prepare(`UPDATE quests SET source_ref = '', updated_at = ? WHERE id = ?`).run(now, quest.id);
    }
    changed = true;
  }
  return changed;
}

// A campaign clone's quest log (src/lib/db/campaign-clone.ts): every quest as
// it stands, ticks and all. The copy keeps the source's arc with the same
// sub-arc ids, so an arc row still points at its own thread. Before this a
// copy started with an empty log, its written quests gone for good.
export function copyQuests(fromCampaignId: string, toCampaignId: string): void {
  const db = getDatabase();
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO quests (id, campaign_id, title, status, objectives_json, source, source_ref, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const quest of listQuests(fromCampaignId)) {
      insert.run(
        crypto.randomUUID(),
        toCampaignId,
        quest.title,
        quest.status,
        JSON.stringify(quest.objectives),
        quest.source,
        quest.sourceRef,
        quest.visibility,
        quest.createdAt,
        now,
      );
    }
  })();
}
