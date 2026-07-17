import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const dbPath =
  process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "local-roleplay.sqlite");

declare global {
  var __localRoleplayDb: Database.Database | undefined;
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      image_request_json TEXT,
      generated_image_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_created
      ON messages(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      inventory TEXT NOT NULL DEFAULT '',
      skills TEXT NOT NULL DEFAULT '',
      spells TEXT NOT NULL DEFAULT '',
      portrait_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_characters_chat_updated
      ON characters(chat_id, updated_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      invite_code TEXT NOT NULL UNIQUE,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','active','ended')),
      max_players INTEGER NOT NULL DEFAULT 5,
      starting_level INTEGER NOT NULL DEFAULT 1,
      difficulty TEXT NOT NULL DEFAULT 'normal',
      theme TEXT NOT NULL DEFAULT '',
      settings_json TEXT NOT NULL,
      scene TEXT NOT NULL DEFAULT '',
      quest_log_json TEXT NOT NULL DEFAULT '[]',
      story_summary TEXT NOT NULL DEFAULT '',
      story_summary_count INTEGER NOT NULL DEFAULT 0,
      next_seq INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_members (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('owner','player')),
      ready INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS character_sheets (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      race TEXT NOT NULL,
      class TEXT NOT NULL,
      background TEXT NOT NULL DEFAULT '',
      alignment TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      abilities_json TEXT NOT NULL,
      max_hp INTEGER NOT NULL,
      current_hp INTEGER NOT NULL,
      temp_hp INTEGER NOT NULL DEFAULT 0,
      ac INTEGER NOT NULL,
      speed INTEGER NOT NULL DEFAULT 30,
      hit_dice_json TEXT NOT NULL,
      proficiencies_json TEXT NOT NULL,
      equipment_json TEXT NOT NULL DEFAULT '[]',
      gold INTEGER NOT NULL DEFAULT 0,
      feats_json TEXT NOT NULL DEFAULT '[]',
      spellcasting_json TEXT NOT NULL DEFAULT 'null',
      conditions_json TEXT NOT NULL DEFAULT '[]',
      portrait_json TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (campaign_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS campaign_messages (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      author_type TEXT NOT NULL CHECK (author_type IN ('player','dm','system')),
      user_id TEXT,
      character_id TEXT,
      content TEXT NOT NULL,
      image_request_json TEXT,
      generated_image_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (campaign_id, seq)
    );

    CREATE TABLE IF NOT EXISTS rolls (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      character_id TEXT,
      requested_by TEXT NOT NULL CHECK (requested_by IN ('dm','player')),
      roll_kind TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      expression TEXT NOT NULL,
      advantage TEXT NOT NULL DEFAULT 'none',
      dc INTEGER,
      total INTEGER NOT NULL,
      success INTEGER,
      breakdown_json TEXT NOT NULL,
      message_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rolls_campaign_created
      ON rolls(campaign_id, created_at);

    CREATE TABLE IF NOT EXISTS campaign_events (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, seq)
    );
  `);

  // Compaction memory: a rolling "story so far" summary plus a watermark of
  // how many of the chat's oldest messages it already covers.
  const chatColumns = db.prepare(`PRAGMA table_info(chats)`).all() as Array<{ name: string }>;
  if (!chatColumns.some((column) => column.name === "story_summary")) {
    db.exec(`ALTER TABLE chats ADD COLUMN story_summary TEXT NOT NULL DEFAULT ''`);
  }
  if (!chatColumns.some((column) => column.name === "story_summary_count")) {
    db.exec(`ALTER TABLE chats ADD COLUMN story_summary_count INTEGER NOT NULL DEFAULT 0`);
  }

  const characterColumns = db.prepare(`PRAGMA table_info(characters)`).all() as Array<{ name: string }>;
  if (!characterColumns.some((column) => column.name === "inventory")) {
    db.exec(`ALTER TABLE characters ADD COLUMN inventory TEXT NOT NULL DEFAULT ''`);
  }
  if (!characterColumns.some((column) => column.name === "skills")) {
    db.exec(`ALTER TABLE characters ADD COLUMN skills TEXT NOT NULL DEFAULT ''`);
  }
  if (!characterColumns.some((column) => column.name === "spells")) {
    db.exec(`ALTER TABLE characters ADD COLUMN spells TEXT NOT NULL DEFAULT ''`);
  }
}

export function getDatabase() {
  if (globalThis.__localRoleplayDb) {
    ensureSchema(globalThis.__localRoleplayDb);
    return globalThis.__localRoleplayDb;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);

  globalThis.__localRoleplayDb = db;
  return db;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function nowIso() {
  return new Date().toISOString();
}
