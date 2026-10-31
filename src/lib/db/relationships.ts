import { compareNames, textKey } from "@/lib/language/text-logic";
import { getDatabase, nowIso } from "@/lib/db/core";
import {
  addFlag,
  addMemory,
  DIED_FLAG,
  endedByDeath,
  foldMemories,
  hasStanding,
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

// A guest ally who was a town NPC is that NPC again once they leave the
// party (issue 637, src/lib/dm/companion-tools.ts): their bonds stay as they
// stood, and one opened while they fought, which named the guest sheet and
// read as a companion's, names the NPC's row again.
export function returnRelationshipsToNpc(campaignId: string, subjectName: string, npcId: string): Relationship[] {
  const returned: Relationship[] = [];
  for (const relationship of listRelationshipsForSubject(campaignId, subjectName)) {
    if (relationship.subjectKind === "npc" && relationship.subjectId === npcId) {
      continue;
    }
    const updated = patchRelationship(relationship.id, { subjectKind: "npc", subjectId: npcId });
    if (updated) {
      returned.push(updated);
    }
  }
  return returned;
}

// The reverse: someone the party lost is back in reach. A companion who died
// and is written back in was brought back to life, so a bond the death
// closed opens again too; any other ending stays ended. `raised` says the
// one coming back is the companion who died (companion-return.ts found the
// sheet they left with): bonds are kept by name, and a new companion or a
// guest who shares a name with someone dead reopened the dead one's bonds
// (issue 657).
export function rejoinRelationshipsWithSubject(
  campaignId: string,
  subjectName: string,
  subjectId: string,
  raised = true,
): Relationship[] {
  const rejoined: Relationship[] = [];
  for (const relationship of listRelationshipsForSubject(campaignId, subjectName)) {
    if (relationship.status !== "parted" && !(raised && endedByDeath(relationship))) {
      continue;
    }
    const updated = patchRelationship(relationship.id, {
      status: "active",
      apartChapters: 0,
      subjectId,
      flags: relationship.flags.filter((flag) => flag !== DIED_FLAG),
    });
    if (updated) {
      rejoined.push(updated);
    }
  }
  return rejoined;
}

// Someone died (issue 580): every character's bond with them closes, not only
// the one pair a relationship_end named. A bond left open went on counting
// the chapters they were away, and three chapters on the GM was told to bring
// the dead back into the story; a companion who fell was only parted, the
// same way. `memory` words the death for each character's own record. A bond
// that already ended another way (a falling-out, a betrayal) is left as it
// ended, so bringing the dead back to life never reopens it.
export function endRelationshipsWithSubject(
  campaignId: string,
  subjectName: string,
  memory: (relationship: Relationship) => string,
): Relationship[] {
  const ended: Relationship[] = [];
  for (const relationship of listRelationshipsForSubject(campaignId, subjectName)) {
    if (relationship.status === "ended") {
      continue;
    }
    const updated = patchRelationship(relationship.id, {
      status: "ended",
      apartChapters: 0,
      flags: addFlag(relationship.flags, DIED_FLAG),
      memories: addMemory(relationship.memories, { kind: "death", text: memory(relationship), at: new Date().toISOString() }),
    });
    if (updated) {
      ended.push(updated);
    }
  }
  return ended;
}

// An NPC renamed or merged into another (src/lib/db/npcs.ts): their bonds
// follow them. Bonds are kept by the subject's name, so a rename left every
// bond under a name nobody answers to any more, and the next moment opened a
// fresh one at neutral beside it. Where a character already has a bond under
// the new name that holds something, that one is kept as it stands (the lead
// judged it the real one) and the other's memories join it; one opened at
// neutral and never moved gives way to the bond that has history. Returns
// how many bonds moved, for the caller to tell the table.
export function moveRelationshipsToSubject(
  campaignId: string,
  fromName: string,
  toName: string,
  subjectId: string,
): number {
  if (textKey(fromName) === textKey(toName)) {
    return 0;
  }
  const db = getDatabase();
  let moved = 0;
  for (const relationship of listRelationshipsForSubject(campaignId, fromName)) {
    moved += 1;
    const keeper = getRelationship(campaignId, relationship.characterId, toName);
    if (keeper && (hasStanding(keeper) || !hasStanding(relationship))) {
      patchRelationship(keeper.id, { memories: foldMemories(keeper.memories, relationship.memories) });
      db.prepare(`DELETE FROM relationships WHERE id = ?`).run(relationship.id);
      continue;
    }
    if (keeper) {
      db.prepare(`DELETE FROM relationships WHERE id = ?`).run(keeper.id);
    }
    db.prepare(`UPDATE relationships SET subject_name = ?, subject_id = ?, updated_at = ? WHERE id = ?`).run(
      toName.trim(),
      subjectId || relationship.subjectId,
      nowIso(),
      relationship.id,
    );
  }
  return moved;
}

// A lobby character swapped for another sheet (an edit, a switch, a new
// build): the seat goes on, so the bonds it holds go with it to the new row
// (issue 657). The replaced row's id is gone, and its bonds stayed behind
// under it: the Bonds tab showed a group under the old name and the new
// sheet had none with a companion who joined in the lobby. Where the new
// sheet already holds a bond with someone, that one stands. Returns how many
// moved.
export function moveCharacterRelationships(campaignId: string, fromCharacterId: string, toCharacterId: string, toName: string): number {
  if (fromCharacterId === toCharacterId) {
    return 0;
  }
  const db = getDatabase();
  const held = new Set(
    (db.prepare(`SELECT subject_name FROM relationships WHERE campaign_id = ? AND character_id = ?`).all(campaignId, toCharacterId) as Array<{ subject_name: string }>).map(
      (row) => textKey(row.subject_name),
    ),
  );
  const rows = db.prepare(`SELECT id, subject_name FROM relationships WHERE campaign_id = ? AND character_id = ?`).all(campaignId, fromCharacterId) as Array<{
    id: string;
    subject_name: string;
  }>;
  let moved = 0;
  for (const row of rows) {
    if (held.has(textKey(row.subject_name))) {
      db.prepare(`DELETE FROM relationships WHERE id = ?`).run(row.id);
      continue;
    }
    db.prepare(`UPDATE relationships SET character_id = ?, character_name = ?, updated_at = ? WHERE id = ?`).run(toCharacterId, toName, nowIso(), row.id);
    moved += 1;
  }
  return moved;
}

// A lobby character removed for good: their bonds go with them (issue 657).
// Nothing holds the rows to the sheet, so they stayed and the Bonds tab
// listed a character nobody plays.
export function deleteCharacterRelationships(campaignId: string, characterId: string): number {
  return getDatabase().prepare(`DELETE FROM relationships WHERE campaign_id = ? AND character_id = ?`).run(campaignId, characterId).changes;
}
