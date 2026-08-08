import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { AskCitation, AskScope, AskVisibility } from "@/lib/dm/ask-logic";

// Storage for Ask: out-of-character questions to the DM and their grounded
// answers. See the campaign_asks comment in core.ts for why these are not
// campaign_messages rows.
//
// PRIVACY mirrors dm_whispers: the SSE stream only ever carries a
// contentless ask_activity event, and each client fetches the rows it may
// read. A private ask publishes nothing at all.

export type CampaignAsk = {
  id: string;
  campaignId: string;
  userId: string;
  characterId: string | null;
  visibility: AskVisibility;
  scope: AskScope;
  question: string;
  answer: string;
  citations: AskCitation[];
  status: "answered" | "failed";
  createdAt: string;
};

type AskRow = {
  id: string;
  campaign_id: string;
  user_id: string;
  character_id: string | null;
  visibility: AskVisibility;
  scope: AskScope;
  question: string;
  answer: string;
  citations_json: string;
  status: "answered" | "failed";
  created_at: string;
};

function mapAsk(row: AskRow): CampaignAsk {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    userId: row.user_id,
    characterId: row.character_id,
    visibility: row.visibility,
    scope: row.scope,
    question: row.question,
    answer: row.answer,
    citations: parseJson<AskCitation[]>(row.citations_json, []),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function insertAsk(input: {
  campaignId: string;
  userId: string;
  characterId: string | null;
  visibility: AskVisibility;
  scope: AskScope;
  question: string;
  answer: string;
  citations: AskCitation[];
  status: "answered" | "failed";
}): CampaignAsk {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO campaign_asks
         (id, campaign_id, user_id, character_id, visibility, scope, question, answer, citations_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.userId,
      input.characterId,
      input.visibility,
      input.scope,
      input.question,
      input.answer,
      JSON.stringify(input.citations),
      input.status,
      nowIso(),
    );
  return mapAsk(
    getDatabase().prepare(`SELECT * FROM campaign_asks WHERE id = ?`).get(id) as AskRow,
  );
}

// Everything this member may read: their own asks plus every table-visible
// one. Oldest first, so the panel reads like a conversation.
export function listAsksForUser(
  campaignId: string,
  userId: string,
  limit = 100,
): CampaignAsk[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM campaign_asks
       WHERE campaign_id = ? AND (user_id = ? OR visibility = 'table')
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(campaignId, userId, limit) as AskRow[];
  return rows.reverse().map(mapAsk);
}

// The asker's own recent thread, newest last. Feeds follow-up questions
// back into the prompt so "what about her brother?" resolves.
export function listRecentAsksForThread(
  campaignId: string,
  userId: string,
  limit = 6,
): CampaignAsk[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM campaign_asks
       WHERE campaign_id = ? AND user_id = ? AND status = 'answered'
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(campaignId, userId, limit) as AskRow[];
  return rows.reverse().map(mapAsk);
}
