import { getDatabase, nowIso } from "@/lib/db/core";
import type { TranscriptLine } from "@/lib/voice/transcript";

// Transcript lines (docs/vtt-parity-implementation-plan.md 13.3): what
// was said at the table, by whom, and when on both clocks. Never fed to
// the DM prompt; read by the beat drafter and the chapter close.

type Row = { id: string; user_id: string; speaker: string; text: string; clock_label: string; started_at: string; created_at: string };

export function insertTranscriptLines(campaignId: string, userId: string, lines: TranscriptLine[]): number {
  const db = getDatabase();
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO voice_transcript (id, campaign_id, user_id, speaker, text, clock_label, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const line of lines) {
      insert.run(crypto.randomUUID(), campaignId, userId, line.speaker.slice(0, 80), line.text.slice(0, 1200), line.clockLabel.slice(0, 160), line.startedAt, now);
    }
  })();
  return lines.length;
}

export function listTranscriptSince(campaignId: string, sinceIso: string, limit = 400): TranscriptLine[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM voice_transcript WHERE campaign_id = ? AND started_at > ? ORDER BY started_at ASC LIMIT ?`)
    .all(campaignId, sinceIso, limit) as Row[];
  return rows.map((row) => ({ speaker: row.speaker, text: row.text, startedAt: row.started_at, clockLabel: row.clock_label }));
}

export function countTranscriptLines(campaignId: string): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS n FROM voice_transcript WHERE campaign_id = ?`).get(campaignId) as { n: number };
  return row.n;
}
