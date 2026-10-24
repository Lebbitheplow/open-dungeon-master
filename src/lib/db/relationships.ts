import { compareNames, textKey } from "@/lib/language/text-logic";
import { getDatabase, nowIso } from "@/lib/db/core";
import {
  parseBeatCounts,
  parseFlags,
  parseMemories,
  parseRomance,
  parseStatus,
  type BeatCounts,
  type RelationshipMemory,
  type RelationshipStatus,
  type RomanceStage,
} from "@/lib/dm/relationship-logic";
import { followTrueMeter, parsePretense, serializePretense, type Pretense } from "@/lib/dm/scheme-logic";

// How each character stands with each tracked NPC and AI companion. Keyed by
// the subject's NAME rather than their row id, because the relationship has
// to survive everything that can happen to the other side: a companion
// dismissed from the party (their sheet is deleted), an NPC who drifts out of
// the story for chapters, or the same person registered again later. The
// meter and ladder math live in src/lib/dm/relationship-logic.ts.

export type RelationshipSubjectKind = "npc" | "companion";

export type Relationship = {
  id: string;
  campaignId: string;
  characterId: string;
  characterName: string;
  subjectKind: RelationshipSubjectKind;
  subjectName: string;
  subjectId: string;
  approval: number;
  romance: RomanceStage;
  status: RelationshipStatus;
  flags: string[];
  memories: RelationshipMemory[];
  beats: BeatCounts;
  apartChapters: number;
  lastShiftTurn: string;
  // NPC advances (src/lib/dm/advance-logic.ts), in the campaign's AI turns:
  // the turn an open window closes and the turn before which the pair does
  // not roll again. 0 = none.
  advanceReadyUntil: number;
  advanceCooldownUntil: number;
  // An NPC's act toward the character (src/lib/dm/scheme-logic.ts): the
  // motive and the warmth they show. A storyteller secret; null = none.
  pretense: Pretense | null;
  createdAt: string;
  updatedAt: string;
};

type RelationshipRow = {
  id: string;
  campaign_id: string;
  character_id: string;
  character_name: string;
  subject_kind: RelationshipSubjectKind;
  subject_name: string;
  subject_id: string;
  approval: number;
  romance: string;
  status: string;
  flags_json: string;
  memories_json: string;
  beats_json: string;
  apart_chapters: number;
  last_shift_turn: string;
  advance_ready_until?: number | null;
  advance_cooldown_until?: number | null;
  pretense_json?: string | null;
  created_at: string;
  updated_at: string;
};

function mapRelationship(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    characterId: row.character_id,
    characterName: row.character_name,
    subjectKind: row.subject_kind === "companion" ? "companion" : "npc",
    subjectName: row.subject_name,
    subjectId: row.subject_id,
    approval: row.approval,
    romance: parseRomance(row.romance),
    status: parseStatus(row.status),
    flags: parseFlags(row.flags_json),
    memories: parseMemories(row.memories_json),
    beats: parseBeatCounts(row.beats_json),
    apartChapters: row.apart_chapters,
    lastShiftTurn: row.last_shift_turn,
    advanceReadyUntil: row.advance_ready_until ?? 0,
    advanceCooldownUntil: row.advance_cooldown_until ?? 0,
    pretense: parsePretense(row.pretense_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Every relationship in the campaign, ended ones included: a story remembers
// who fell out with whom. Strongest feeling first, either direction.
export function listRelationships(campaignId: string): Relationship[] {
  return (
    getDatabase()
      .prepare(
        `SELECT * FROM relationships WHERE campaign_id = ?`,
      )
      .all(campaignId) as RelationshipRow[]
  )
    .map(mapRelationship)
    .sort((a, b) => Math.abs(b.approval) - Math.abs(a.approval) || compareNames(a.subjectName, b.subjectName));
}

// Subjects are compared in JavaScript, by Unicode case and form
// (src/lib/language): SQLite's NOCASE folds ASCII only.
export function listRelationshipsForSubject(
  campaignId: string,
  subjectName: string,
): Relationship[] {
  const wanted = textKey(subjectName);
  return listRelationships(campaignId).filter((relationship) => textKey(relationship.subjectName) === wanted);
}

export function getRelationship(
  campaignId: string,
  characterId: string,
  subjectName: string,
): Relationship | null {
  const wanted = textKey(subjectName);
  const rows = getDatabase()
    .prepare(`SELECT * FROM relationships WHERE campaign_id = ? AND character_id = ?`)
    .all(campaignId, characterId) as RelationshipRow[];
  const row = rows.find((candidate) => textKey(candidate.subject_name) === wanted);
  return row ? mapRelationship(row) : null;
}

export function getRelationshipById(id: string): Relationship | null {
  const row = getDatabase().prepare(`SELECT * FROM relationships WHERE id = ?`).get(id) as
    | RelationshipRow
    | undefined;
  return row ? mapRelationship(row) : null;
}

// Opens the ledger for a pair, or returns the one already on file. Nothing
// about an existing relationship is overwritten except the denormalized
// display name and subject link, which simply follow their current values.
export function ensureRelationship(input: {
  campaignId: string;
  characterId: string;
  characterName: string;
  subjectKind: RelationshipSubjectKind;
  subjectName: string;
  subjectId?: string;
}): Relationship {
  const db = getDatabase();
  const now = nowIso();
  const existing = getRelationship(input.campaignId, input.characterId, input.subjectName);
  if (existing) {
    db.prepare(
      `UPDATE relationships SET character_name = ?, subject_kind = ?, subject_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.characterName,
      input.subjectKind,
      input.subjectId ?? existing.subjectId,
      now,
      existing.id,
    );
    return getRelationshipById(existing.id) ?? existing;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO relationships
       (id, campaign_id, character_id, character_name, subject_kind, subject_name,
        subject_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.campaignId,
    input.characterId,
    input.characterName,
    input.subjectKind,
    input.subjectName.trim(),
    input.subjectId ?? "",
    now,
    now,
  );
  return getRelationshipById(id)!;
}

// Writes any subset of the mutable state; untouched pieces keep their column.
// While an NPC keeps up an act, a change to the true meter moves the warmth
// they show by as much (scheme-logic.ts followTrueMeter), so the act reacts
// to a gift or a slight the way the real feeling would.
export function patchRelationship(
  id: string,
  patch: Partial<
    Pick<
      Relationship,
      | "approval"
      | "romance"
      | "status"
      | "flags"
      | "memories"
      | "beats"
      | "apartChapters"
      | "lastShiftTurn"
      | "subjectId"
      | "subjectKind"
      | "characterName"
      | "advanceReadyUntil"
      | "advanceCooldownUntil"
      | "pretense"
    >
  >,
): Relationship | null {
  const current = getRelationshipById(id);
  if (!current) {
    return null;
  }
  const pretense =
    patch.pretense !== undefined
      ? patch.pretense
      : current.pretense && patch.approval !== undefined
        ? followTrueMeter(current.pretense, current.approval, patch.approval)
        : current.pretense;
  getDatabase()
    .prepare(
      `UPDATE relationships
       SET approval = ?, romance = ?, status = ?, flags_json = ?, memories_json = ?,
           beats_json = ?, apart_chapters = ?, last_shift_turn = ?, subject_id = ?,
           subject_kind = ?, character_name = ?, advance_ready_until = ?,
           advance_cooldown_until = ?, pretense_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.approval ?? current.approval,
      patch.romance ?? current.romance,
      patch.status ?? current.status,
      JSON.stringify(patch.flags ?? current.flags),
      JSON.stringify(patch.memories ?? current.memories),
      JSON.stringify(patch.beats ?? current.beats),
      patch.apartChapters ?? current.apartChapters,
      patch.lastShiftTurn ?? current.lastShiftTurn,
      patch.subjectId ?? current.subjectId,
      patch.subjectKind ?? current.subjectKind,
      patch.characterName ?? current.characterName,
      Math.max(0, Math.round(patch.advanceReadyUntil ?? current.advanceReadyUntil)),
      Math.max(0, Math.round(patch.advanceCooldownUntil ?? current.advanceCooldownUntil)),
      serializePretense(pretense),
      nowIso(),
      id,
    );
  return getRelationshipById(id);
}

// A companion leaving the party does not end what the party felt for them;
// it only puts it out of reach (src/lib/dm/companion-tools.ts).
export function partRelationshipsWithSubject(
  campaignId: string,
  subjectName: string,
): Relationship[] {
  const parted: Relationship[] = [];
  for (const relationship of listRelationshipsForSubject(campaignId, subjectName)) {
    if (relationship.status !== "active") {
      continue;
    }
    const updated = patchRelationship(relationship.id, { status: "parted", apartChapters: 0 });
    if (updated) {
      parted.push(updated);
    }
  }
  return parted;
}

// The reverse: someone the party lost is back in reach.
export function rejoinRelationshipsWithSubject(
  campaignId: string,
  subjectName: string,
  subjectId: string,
): Relationship[] {
  const rejoined: Relationship[] = [];
  for (const relationship of listRelationshipsForSubject(campaignId, subjectName)) {
    if (relationship.status !== "parted") {
      continue;
    }
    const updated = patchRelationship(relationship.id, {
      status: "active",
      apartChapters: 0,
      subjectId,
    });
    if (updated) {
      rejoined.push(updated);
    }
  }
  return rejoined;
}
