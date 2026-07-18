import { getDatabase, nowIso } from "@/lib/db/core";

export const CHARACTER_EVENT_KINDS = [
  "achievement",
  "item",
  "relationship",
  "death",
  "level_up",
  "story",
] as const;
export type CharacterEventKind = (typeof CHARACTER_EVENT_KINDS)[number];

export type CharacterEvent = {
  id: string;
  libraryCharacterId: string | null;
  campaignCharacterId: string;
  campaignId: string;
  seq: number;
  kind: CharacterEventKind;
  summary: string;
  createdAt: string;
};

type EventRow = {
  id: string;
  library_character_id: string | null;
  campaign_character_id: string;
  campaign_id: string;
  seq: number;
  kind: CharacterEventKind;
  summary: string;
  created_at: string;
};

function mapEvent(row: EventRow): CharacterEvent {
  return {
    id: row.id,
    libraryCharacterId: row.library_character_id,
    campaignCharacterId: row.campaign_character_id,
    campaignId: row.campaign_id,
    seq: row.seq,
    kind: row.kind,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

export function insertCharacterEvent(input: {
  libraryCharacterId: string | null;
  campaignCharacterId: string;
  campaignId: string;
  seq: number;
  kind: CharacterEventKind;
  summary: string;
}): CharacterEvent {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `
        INSERT INTO character_events (
          id, library_character_id, campaign_character_id, campaign_id, seq,
          kind, summary, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.libraryCharacterId,
      input.campaignCharacterId,
      input.campaignId,
      input.seq,
      input.kind,
      input.summary,
      nowIso(),
    );
  const row = getDatabase()
    .prepare(`SELECT * FROM character_events WHERE id = ?`)
    .get(id) as EventRow;
  return mapEvent(row);
}

export function listEventsForLibraryCharacter(
  libraryCharacterId: string,
  limit = 200,
): CharacterEvent[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM character_events
        WHERE library_character_id = ?
        ORDER BY created_at DESC LIMIT ?
      `,
    )
    .all(libraryCharacterId, limit) as EventRow[];
  return rows.map(mapEvent);
}

// Recent events per campaign character, for the GAME STATE block.
export function listRecentEventsForCampaign(
  campaignId: string,
  perCharacter = 3,
): Map<string, CharacterEvent[]> {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM character_events WHERE campaign_id = ? ORDER BY seq DESC LIMIT 100`,
    )
    .all(campaignId) as EventRow[];
  const byCharacter = new Map<string, CharacterEvent[]>();
  for (const row of rows) {
    const list = byCharacter.get(row.campaign_character_id) ?? [];
    if (list.length < perCharacter) {
      list.push(mapEvent(row));
      byCharacter.set(row.campaign_character_id, list);
    }
  }
  return byCharacter;
}

// Dedupe helper: has this character already recorded an identical summary?
export function hasRecentIdenticalEvent(
  campaignCharacterId: string,
  summary: string,
): boolean {
  const row = getDatabase()
    .prepare(
      `
        SELECT 1 FROM character_events
        WHERE campaign_character_id = ? AND summary = ?
        ORDER BY created_at DESC LIMIT 1
      `,
    )
    .get(campaignCharacterId, summary);
  return row !== undefined;
}
