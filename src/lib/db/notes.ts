import { getDatabase, nowIso } from "@/lib/db/core";
import { embed, vectorToBuffer } from "@/lib/embeddings";

// Campaign and character notes. Campaign scope (characterId null) covers the
// lead's public party notes, member suggestions (public + pending), and
// private jottings. Character scope attaches a note to a character sheet.
//
// PRIVACY: campaign_events rows are replayable by every member, so private
// note content and pending suggestion content must NEVER ride a persisted
// SSE payload. Publish public active notes in full; everything else as bare
// ids (or not at all).

export type NoteVisibility = "public" | "private";
export type NoteStatus = "active" | "pending";
// 'dm' marks a suggestion the AI DM wrote via write_campaign_note; the row
// still carries a real member's user id to satisfy the FK.
export type NoteAuthorKind = "user" | "dm";

export type Note = {
  id: string;
  campaignId: string;
  characterId: string | null;
  authorUserId: string;
  authorKind: NoteAuthorKind;
  visibility: NoteVisibility;
  status: NoteStatus;
  pinned: boolean;
  title: string;
  body: string;
  seq: number;
  createdAt: string;
  updatedAt: string;
};

type NoteRow = {
  id: string;
  campaign_id: string;
  character_id: string | null;
  author_user_id: string;
  author_kind: NoteAuthorKind;
  visibility: NoteVisibility;
  status: NoteStatus;
  pinned: number;
  title: string;
  body: string;
  seq: number;
  created_at: string;
  updated_at: string;
};

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    characterId: row.character_id,
    authorUserId: row.author_user_id,
    authorKind: row.author_kind === "dm" ? "dm" : "user",
    visibility: row.visibility,
    status: row.status,
    pinned: row.pinned === 1,
    title: row.title,
    body: row.body,
    seq: row.seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertNote(input: {
  campaignId: string;
  characterId: string | null;
  authorUserId: string;
  authorKind?: NoteAuthorKind;
  visibility: NoteVisibility;
  status: NoteStatus;
  title: string;
  body: string;
  seq: number;
}): Note {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO campaign_notes (
          id, campaign_id, character_id, author_user_id, author_kind,
          visibility, status, pinned, title, body, seq, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.characterId,
      input.authorUserId,
      input.authorKind ?? "user",
      input.visibility,
      input.status,
      input.title.slice(0, 120),
      input.body.slice(0, 2000),
      input.seq,
      now,
      now,
    );
  void embedNote(id);
  return getNoteById(id)!;
}

export function getNoteById(noteId: string): Note | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM campaign_notes WHERE id = ?`)
    .get(noteId) as NoteRow | undefined;
  return row ? mapNote(row) : null;
}

export function updateNote(
  noteId: string,
  patch: { title?: string; body?: string; pinned?: boolean; status?: NoteStatus },
): Note | null {
  const note = getNoteById(noteId);
  if (!note) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE campaign_notes SET title = ?, body = ?, pinned = ?, status = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      (patch.title ?? note.title).slice(0, 120),
      (patch.body ?? note.body).slice(0, 2000),
      (patch.pinned ?? note.pinned) ? 1 : 0,
      patch.status ?? note.status,
      nowIso(),
      noteId,
    );
  if (patch.title !== undefined || patch.body !== undefined) {
    void embedNote(noteId);
  }
  return getNoteById(noteId);
}

// Fire-and-forget MiniLM embedding for search_lore; NULL just means the
// note only matches by keyword.
async function embedNote(noteId: string) {
  try {
    const note = getNoteById(noteId);
    if (!note) {
      return;
    }
    const [vector] = await embed([`${note.title}\n${note.body}`]);
    if (vector) {
      getDatabase()
        .prepare(`UPDATE campaign_notes SET embedding = ? WHERE id = ?`)
        .run(vectorToBuffer(vector), noteId);
    }
  } catch (error) {
    console.error("[notes] embedding failed", error);
  }
}

export function deleteNote(noteId: string): boolean {
  const info = getDatabase().prepare(`DELETE FROM campaign_notes WHERE id = ?`).run(noteId);
  return info.changes > 0;
}

// Everything the caller may see: public active notes, their own rows
// (private notes and pending suggestions), and every pending suggestion
// when the caller is the party lead.
export function listNotesVisibleTo(campaignId: string, userId: string, lead: boolean): Note[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM campaign_notes
        WHERE campaign_id = ?
          AND (
            (visibility = 'public' AND status = 'active')
            OR author_user_id = ?
            OR (? AND status = 'pending')
          )
        ORDER BY pinned DESC, seq DESC
      `,
    )
    .all(campaignId, userId, lead ? 1 : 0) as NoteRow[];
  return rows.map(mapNote);
}

// Public active campaign-scope notes for the DM prompt, pinned first.
export function listPublicCampaignNotes(campaignId: string, limit = 20): Note[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM campaign_notes
        WHERE campaign_id = ? AND character_id IS NULL
          AND visibility = 'public' AND status = 'active'
        ORDER BY pinned DESC, seq DESC
        LIMIT ?
      `,
    )
    .all(campaignId, limit) as NoteRow[];
  return rows.map(mapNote);
}
