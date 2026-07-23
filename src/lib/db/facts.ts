import { latestSeq } from "@/lib/db/campaigns";
import { getDatabase, nowIso } from "@/lib/db/core";
import {
  classifyCandidate,
  factVisibleTo,
  normalizeSubject,
  parseKnownBy,
  serializeKnownBy,
  FACT_MAX_CHARS,
  type FactCandidate,
  type FactCategory,
  type FactKnownBy,
} from "@/lib/dm/fact-logic";

// The world-state fact sheet ("divergence register"). Facts arrive from the
// chapter-close extraction, the compaction fallback, manual pins, and the
// world-simulation engines; they render into GAME STATE as server-tracked
// canon so established truths survive long past the message history budget.
//
// PRIVACY: known_by scopes reads. SSE only ever carries a contentless
// facts_updated ephemeral; clients refetch their own filtered view, exactly
// like whispers.

export type WorldFactSource = "chapter" | "compaction" | "manual" | "simulation";
export type WorldFactStatus = "active" | "superseded" | "retired";

export type WorldFact = {
  id: string;
  campaignId: string;
  category: FactCategory;
  subject: string;
  fact: string;
  knownBy: FactKnownBy;
  pinned: boolean;
  status: WorldFactStatus;
  source: WorldFactSource;
  sourceSeq: number | null;
  createdAt: string;
  updatedAt: string;
};

type WorldFactRow = {
  id: string;
  campaign_id: string;
  category: FactCategory;
  subject: string;
  fact: string;
  known_by: string;
  pinned: number;
  status: WorldFactStatus;
  source: WorldFactSource;
  source_seq: number | null;
  created_at: string;
  updated_at: string;
};

function mapFact(row: WorldFactRow): WorldFact {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    category: row.category,
    subject: row.subject,
    fact: row.fact,
    knownBy: parseKnownBy(row.known_by),
    pinned: row.pinned === 1,
    status: row.status,
    source: row.source,
    sourceSeq: row.source_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FACT_COLUMNS =
  "id, campaign_id, category, subject, fact, known_by, pinned, status, source, source_seq, created_at, updated_at";

export function getFactById(factId: string): WorldFact | null {
  const row = getDatabase()
    .prepare(`SELECT ${FACT_COLUMNS} FROM world_facts WHERE id = ?`)
    .get(factId) as WorldFactRow | undefined;
  return row ? mapFact(row) : null;
}

// Active facts newest-first; the prompt renderer applies pinning and caps.
export function listActiveFacts(campaignId: string, limit = 200): WorldFact[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT ${FACT_COLUMNS} FROM world_facts
        WHERE campaign_id = ? AND status = 'active'
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
    )
    .all(campaignId, limit) as WorldFactRow[];
  return rows.map(mapFact);
}

// Facts a member may see, per known_by scoping. DM secrets only surface
// when the lead explicitly requests them.
export function listFactsVisibleTo(
  campaignId: string,
  ownedCharacterIds: string[],
  includeDmSecrets: boolean,
): WorldFact[] {
  return listActiveFacts(campaignId).filter((fact) =>
    factVisibleTo(fact.knownBy, ownedCharacterIds, includeDmSecrets),
  );
}

export function insertFact(input: {
  campaignId: string;
  category: FactCategory;
  subject: string;
  fact: string;
  knownBy?: FactKnownBy;
  pinned?: boolean;
  source: WorldFactSource;
  sourceSeq?: number | null;
}): WorldFact {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO world_facts (
          id, campaign_id, category, subject, fact, known_by, pinned,
          status, source, source_seq, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.category,
      normalizeSubject(input.subject),
      input.fact.slice(0, FACT_MAX_CHARS),
      serializeKnownBy(input.knownBy ?? "party"),
      input.pinned ? 1 : 0,
      input.source,
      // Every fact carries the campaign position it was learned at, so
      // rollback tooling can reason about when a fact entered the world.
      input.sourceSeq ?? latestSeq(input.campaignId),
      now,
      now,
    );
  return getFactById(id)!;
}

export function setFactPinned(factId: string, pinned: boolean): WorldFact | null {
  getDatabase()
    .prepare(`UPDATE world_facts SET pinned = ?, updated_at = ? WHERE id = ?`)
    .run(pinned ? 1 : 0, nowIso(), factId);
  return getFactById(factId);
}

export function setFactStatus(factId: string, status: WorldFactStatus): WorldFact | null {
  getDatabase()
    .prepare(`UPDATE world_facts SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, nowIso(), factId);
  return getFactById(factId);
}

export function updateFactText(
  factId: string,
  patch: { fact?: string; subject?: string; category?: FactCategory },
): WorldFact | null {
  const fact = getFactById(factId);
  if (!fact) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE world_facts SET fact = ?, subject = ?, category = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      (patch.fact ?? fact.fact).slice(0, FACT_MAX_CHARS),
      normalizeSubject(patch.subject ?? fact.subject),
      patch.category ?? fact.category,
      nowIso(),
      factId,
    );
  return getFactById(factId);
}

// Retires every active fact sharing the candidate's category+subject; used
// when a newer fact supersedes what was on file about that subject.
function supersedeSubject(campaignId: string, category: FactCategory, subject: string) {
  if (!subject) {
    return;
  }
  getDatabase()
    .prepare(
      `
        UPDATE world_facts SET status = 'superseded', updated_at = ?
        WHERE campaign_id = ? AND category = ? AND subject = ? AND status = 'active'
          AND pinned = 0
      `,
    )
    .run(nowIso(), campaignId, category, subject);
}

// Records a batch of extracted candidates with dedup and supersede
// semantics. Pinned facts are never auto-superseded (a pin is a human
// statement that this exact wording stays). Returns the inserted rows.
export function recordExtractedFacts(
  campaignId: string,
  candidates: FactCandidate[],
  source: WorldFactSource,
  options: { knownBy?: FactKnownBy; sourceSeq?: number | null } = {},
): WorldFact[] {
  const inserted: WorldFact[] = [];
  for (const candidate of candidates) {
    const existing = listActiveFacts(campaignId);
    const verdict = classifyCandidate(candidate, existing);
    if (verdict === "duplicate") {
      continue;
    }
    if (verdict === "supersedes") {
      supersedeSubject(campaignId, candidate.category, normalizeSubject(candidate.subject));
    }
    inserted.push(
      insertFact({
        campaignId,
        category: candidate.category,
        subject: candidate.subject,
        fact: candidate.fact,
        knownBy: options.knownBy ?? "party",
        source,
        sourceSeq: options.sourceSeq ?? null,
      }),
    );
  }
  return inserted;
}
