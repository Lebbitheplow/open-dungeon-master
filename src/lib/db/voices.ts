import { getDatabase, nowIso } from "@/lib/db/core";
import { normalizeNpcVoice, type NpcVoice } from "@/lib/npcs/forge";

// Read-aloud voices for the speakers who are not NPCs (issue 97): a
// character at the table, keyed "pc:<sheet id>", or a kind of monster,
// keyed "monster:<name>". An NPC's voice lives on its own row
// (src/lib/db/npcs.ts); src/lib/tts-roster.ts reads both as one list.

export type SavedVoice = { key: string; name: string; voice: NpcVoice };

type Row = { speaker_key: string; name: string; voice_id: string; speed: number };

export function listCampaignVoices(campaignId: string): SavedVoice[] {
  const rows = getDatabase()
    .prepare(`SELECT speaker_key, name, voice_id, speed FROM campaign_voices WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`)
    .all(campaignId) as Row[];
  const voices: SavedVoice[] = [];
  for (const row of rows) {
    const voice = normalizeNpcVoice({ voiceId: row.voice_id, speed: row.speed });
    if (voice) {
      voices.push({ key: row.speaker_key, name: row.name, voice });
    }
  }
  return voices;
}

// null gives the speaker back to the narrator.
export function setCampaignVoice(campaignId: string, key: string, name: string, voice: NpcVoice | null) {
  const db = getDatabase();
  if (!voice) {
    db.prepare(`DELETE FROM campaign_voices WHERE campaign_id = ? AND speaker_key = ?`).run(campaignId, key);
    return;
  }
  db.prepare(
    `INSERT INTO campaign_voices (campaign_id, speaker_key, name, voice_id, speed, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, speaker_key) DO UPDATE SET name = excluded.name, voice_id = excluded.voice_id, speed = excluded.speed, updated_at = excluded.updated_at`,
  ).run(campaignId, key.slice(0, 120), name.slice(0, 80), voice.voiceId, voice.speed, nowIso());
}
