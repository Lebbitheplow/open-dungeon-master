import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  normalizeObjectives,
  normalizeQuestStatus,
  QUEST_TITLE_MAX,
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

// Mirrors the arc's sub-arcs: one arc row per sub-arc, matched by id, with
// the DM's ticks kept when the goal is unchanged. Sub-arcs that left the
// arc take their rows with them; hand-written rows are never touched.
export function syncArcQuests(
  campaignId: string,
  subArcs: Array<{ id: string; name: string; goal: string; status: string }>,
): Quest[] {
  const db = getDatabase();
  const existing = listQuests(campaignId).filter((quest) => quest.source === "arc");
  const byRef = new Map(existing.map((quest) => [quest.sourceRef, quest]));
  const now = nowIso();
  db.transaction(() => {
    const seen = new Set<string>();
    for (const subArc of subArcs) {
      seen.add(subArc.id);
      const status: QuestStatus =
        subArc.status === "resolved" ? "done" : subArc.status === "abandoned" ? "failed" : "active";
      const current = byRef.get(subArc.id);
      const objectives = current?.objectives.length
        ? current.objectives
        : [{ id: "goal", text: subArc.goal.slice(0, 240), done: status === "done" }];
      if (current) {
        db.prepare(`UPDATE quests SET title = ?, status = ?, objectives_json = ?, updated_at = ? WHERE id = ?`).run(
          subArc.name.slice(0, QUEST_TITLE_MAX),
          status,
          JSON.stringify(objectives),
          now,
          current.id,
        );
      } else {
        db.prepare(
          `INSERT INTO quests (id, campaign_id, title, status, objectives_json, source, source_ref, visibility, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'arc', ?, 'party', ?, ?)`,
        ).run(crypto.randomUUID(), campaignId, subArc.name.slice(0, QUEST_TITLE_MAX), status, JSON.stringify(objectives), subArc.id, now, now);
      }
    }
    for (const quest of existing) {
      if (!seen.has(quest.sourceRef)) {
        db.prepare(`DELETE FROM quests WHERE id = ?`).run(quest.id);
      }
    }
  })();
  return listQuests(campaignId);
}
