import { getDatabase, nowIso } from "@/lib/db/core";
import { normalizeGm, type GmSettings } from "@/lib/dm/safety-logic";

// DM personalities (docs/vtt-parity-implementation-plan.md 9.2): a preset
// over strictness, tone and the narrator's voice, offered in the wizard.
// The stock ones are seeded once; a user's own live beside them.

export type Personality = {
  id: string;
  userId: string | null;
  name: string;
  blurb: string;
  gm: GmSettings;
  ttsVoice: string;
};

const STOCK: Array<Omit<Personality, "id" | "userId">> = [
  { name: "The Storyteller", blurb: "Warm, generous, sweeping.", gm: { strictness: "lenient", tone: ["hopeful", "epic"] }, ttsVoice: "bm_fable" },
  { name: "The Referee", blurb: "By the book, no favours.", gm: { strictness: "standard", tone: [] }, ttsVoice: "am_michael" },
  { name: "The Grim Chronicler", blurb: "Hard rulings, dark roads.", gm: { strictness: "harsh", tone: ["grim", "eerie"] }, ttsVoice: "am_fenrir" },
  { name: "The Trickster", blurb: "Light on its feet, quick to laugh.", gm: { strictness: "lenient", tone: ["whimsical", "pulpy"] }, ttsVoice: "am_puck" },
  { name: "The Courtier", blurb: "Every room a negotiation.", gm: { strictness: "standard", tone: ["political", "intimate"] }, ttsVoice: "bf_emma" },
];

type Row = { id: string; user_id: string | null; name: string; blurb: string; gm_json: string; tts_voice: string };

function map(row: Row): Personality {
  let gm: unknown = null;
  try {
    gm = JSON.parse(row.gm_json);
  } catch {
    gm = null;
  }
  return { id: row.id, userId: row.user_id, name: row.name, blurb: row.blurb, gm: normalizeGm(gm), ttsVoice: row.tts_voice };
}

export function seedPersonalities(): void {
  const db = getDatabase();
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM library_personalities WHERE user_id IS NULL`).get() as { n: number }).n;
  if (count > 0) {
    return;
  }
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO library_personalities (id, user_id, name, blurb, gm_json, tts_voice, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
  );
  for (const stock of STOCK) {
    insert.run(crypto.randomUUID(), stock.name, stock.blurb, JSON.stringify(stock.gm), stock.ttsVoice, now, now);
  }
}

export function listPersonalities(userId: string | null): Personality[] {
  seedPersonalities();
  const rows = getDatabase()
    .prepare(`SELECT * FROM library_personalities WHERE user_id IS NULL OR user_id = ? ORDER BY user_id IS NOT NULL, created_at ASC`)
    .all(userId) as Row[];
  return rows.map(map);
}

export function insertPersonality(userId: string, input: { name: string; blurb: string; gm: GmSettings; ttsVoice: string }): Personality {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO library_personalities (id, user_id, name, blurb, gm_json, tts_voice, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, input.name.trim().slice(0, 60), input.blurb.trim().slice(0, 160), JSON.stringify(normalizeGm(input.gm)), input.ttsVoice.slice(0, 40), now, now);
  return listPersonalities(userId).find((entry) => entry.id === id)!;
}
