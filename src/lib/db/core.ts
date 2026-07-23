import Database from "better-sqlite3-multiple-ciphers";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { serverEnv } from "../server-env.ts";
import { populateFeatures } from "@/lib/srd/features";
import { populateResources } from "@/lib/srd/class-resources";

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
      features_json TEXT,
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

    CREATE TABLE IF NOT EXISTS homebrew_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('spell','feat','item','race','background','archetype','monster')),
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, kind, slug)
    );

    -- The per-user character library. "characters" is taken by the legacy
    -- solo table (chat-scoped), so the library gets its own name. Campaign
    -- play copies a library character into character_sheets and links back
    -- via character_sheets.library_character_id.
    CREATE TABLE IF NOT EXISTS library_characters (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      race TEXT NOT NULL,
      class TEXT NOT NULL,
      subclass TEXT NOT NULL DEFAULT '',
      background TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      sheet_json TEXT NOT NULL,
      portrait_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_library_characters_user
      ON library_characters(user_id, updated_at);

    -- A DM narration turn as a persisted state machine, so a turn can park
    -- while waiting on a physical dice roll and resume later (surviving
    -- restarts). conversation_json holds the full model conversation.
    CREATE TABLE IF NOT EXISTS dm_turns (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('running','awaiting_rolls','done','failed')),
      call_index INTEGER NOT NULL DEFAULT 0,
      conversation_json TEXT NOT NULL,
      narration_parts_json TEXT NOT NULL DEFAULT '[]',
      roll_ids_json TEXT NOT NULL DEFAULT '[]',
      image_args_json TEXT,
      mutation_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_rolls (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES dm_turns(id) ON DELETE CASCADE,
      tool_call_id TEXT,
      user_id TEXT NOT NULL,
      character_id TEXT,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      expression TEXT NOT NULL,
      advantage TEXT NOT NULL DEFAULT 'none',
      dc INTEGER,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','fallback')),
      roll_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_rolls_turn ON pending_rolls(turn_id, status);

    -- Audit trail of DM-driven sheet mutations (damage, loot, XP, ...).
    CREATE TABLE IF NOT EXISTS sheet_audit (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL,
      turn_id TEXT,
      actor TEXT NOT NULL DEFAULT 'dm',
      kind TEXT NOT NULL,
      delta_json TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sheet_audit_campaign ON sheet_audit(campaign_id, seq);

    -- Structured location state so the DM stays spatially consistent and
    -- maps can be generated per area.
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      layout_description TEXT NOT NULL DEFAULT '',
      connections_json TEXT NOT NULL DEFAULT '[]',
      visited INTEGER NOT NULL DEFAULT 0,
      is_current INTEGER NOT NULL DEFAULT 0,
      map_image_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (campaign_id, name COLLATE NOCASE)
    );

    -- Lasting per-character milestones, keyed to the library character so a
    -- character's story accretes across campaigns.
    CREATE TABLE IF NOT EXISTS character_events (
      id TEXT PRIMARY KEY,
      library_character_id TEXT,
      campaign_character_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('achievement','item','relationship','death','level_up','story')),
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_character_events_library
      ON character_events(library_character_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_character_events_campaign
      ON character_events(campaign_id, seq);

    CREATE INDEX IF NOT EXISTS idx_character_events_character
      ON character_events(campaign_character_id, created_at);

    -- Story chapters: closed spans of the campaign transcript with an AI
    -- title/summary/highlights, plus one open chapter accumulating messages.
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      chapter_index INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      highlights_json TEXT NOT NULL DEFAULT '[]',
      seq_start INTEGER NOT NULL,
      seq_end INTEGER,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (campaign_id, chapter_index)
    );

    CREATE INDEX IF NOT EXISTS idx_chapters_campaign ON chapters(campaign_id, chapter_index);

    -- Campaign and character notes: public party knowledge (lead-curated),
    -- private jottings, and member suggestions awaiting the lead's approval.
    -- character_id NULL means campaign scope; else it references a
    -- character_sheets row. A suggestion is a public campaign note with
    -- status 'pending'.
    CREATE TABLE IF NOT EXISTS campaign_notes (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      character_id TEXT,
      author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      visibility TEXT NOT NULL CHECK (visibility IN ('public','private')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending')),
      pinned INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_notes ON campaign_notes(campaign_id, seq);

    -- Private player-to-player side chats (1:1 "dm" threads and "group"
    -- threads). Content must never reach the AI DM prompt or the shared
    -- campaign event stream: nothing outside side-chat code may read these
    -- tables, and sends publish only a contentless ephemeral event.
    CREATE TABLE IF NOT EXISTS side_threads (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('dm','group')),
      title TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- kind='dm' only: both member user ids sorted and joined with '|',
      -- so the partial unique index makes 1:1 threads idempotent.
      dm_key TEXT,
      next_seq INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_side_threads_dm
      ON side_threads(campaign_id, dm_key) WHERE dm_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS side_thread_members (
      thread_id TEXT NOT NULL REFERENCES side_threads(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_seq INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS side_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES side_threads(id) ON DELETE CASCADE,
      author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (thread_id, seq)
    );

    -- Private line between the AI DM and individual players (the
    -- DM-visible counterpart to the player-only side chats above).
    -- direction 'to_player': DM-authored notes (send_whisper tool), one row
    -- per recipient with group_id tying a single send together. direction
    -- 'to_dm': a player privately messaging the DM; consumed by the next
    -- coalesced DM turn and marked via answered_turn_id. Content never rides
    -- the shared event stream: sends publish only a contentless ephemeral
    -- "whisper_activity" event and each recipient fetches their own rows.
    CREATE TABLE IF NOT EXISTS dm_whispers (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      turn_id TEXT,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      character_id TEXT,
      content TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dm_whispers_user
      ON dm_whispers(campaign_id, user_id, created_at);

    -- Server-authoritative combat encounters. Enemy stats snapshot into
    -- stat_json at spawn so a missing content pack never breaks a live
    -- fight. order_json stages partial initiative entries while they are
    -- collected, then holds the final sorted order.
    CREATE TABLE IF NOT EXISTS encounters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
      round INTEGER NOT NULL DEFAULT 1,
      turn_index INTEGER NOT NULL DEFAULT 0,
      order_ready INTEGER NOT NULL DEFAULT 0,
      order_json TEXT NOT NULL DEFAULT '[]',
      -- Campaign seq when the turn pointer landed on the current PC; the
      -- pointer advances only after they author a message past this mark.
      waiting_seq INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_encounters_campaign ON encounters(campaign_id, status);

    CREATE TABLE IF NOT EXISTS encounter_enemies (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      max_hp INTEGER NOT NULL,
      current_hp INTEGER NOT NULL,
      ac INTEGER NOT NULL,
      initiative INTEGER,
      status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive','dead','fled')),
      cr REAL NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      stat_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_encounter_enemies ON encounter_enemies(encounter_id);

    -- Tactical battle map, one per encounter, generated procedurally at
    -- start_encounter. Terrain is one char per tile, row-major. Clients
    -- never receive these rows directly: per-character fog of war means the
    -- battle-map GET serves a server-filtered projection, and the shared
    -- stream carries only a contentless battle_map_updated ping.
    CREATE TABLE IF NOT EXISTS battle_maps (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      terrain TEXT NOT NULL,
      ambient TEXT NOT NULL DEFAULT 'bright' CHECK (ambient IN ('bright','dim','dark')),
      -- Visual theme picked at generation (cave/forest/swamp/riverside/
      -- interior/field); drives the client palette only.
      theme TEXT NOT NULL DEFAULT 'field',
      lights_json TEXT NOT NULL DEFAULT '[]',
      seed INTEGER NOT NULL DEFAULT 0,
      -- Round whose movement budgets the tokens currently carry.
      round_marker INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_battle_maps_encounter ON battle_maps(encounter_id);

    CREATE TABLE IF NOT EXISTS battle_tokens (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES battle_maps(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('pc','enemy')),
      -- character_sheets.id for PCs, encounter_enemies.id for enemies.
      ref_id TEXT NOT NULL,
      name TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      moved_this_round INTEGER NOT NULL DEFAULT 0,
      light_radius INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (map_id, ref_id)
    );

    -- Per-character fog-of-war memory: which tiles this character has seen,
    -- as a hex-encoded bitfield of width*height bits.
    CREATE TABLE IF NOT EXISTS battle_explored (
      map_id TEXT NOT NULL REFERENCES battle_maps(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL,
      tiles_hex TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (map_id, character_id)
    );

    -- Persistent NPCs and their disposition toward the party. Attitude is the
    -- 5e social-interaction scale (hostile/indifferent/friendly); it persists
    -- across sessions so an NPC the party angered stays angry. last_shift_turn
    -- holds the dm_turn id of the most recent attitude change, guarding against
    -- ratcheting attitude with repeated checks inside one exchange.
    CREATE TABLE IF NOT EXISTS npcs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      attitude TEXT NOT NULL DEFAULT 'indifferent'
        CHECK (attitude IN ('hostile','indifferent','friendly')),
      trait TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      last_shift_turn TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (campaign_id, name)
    );

    -- World-state fact sheet (the "divergence register"): discrete facts
    -- extracted at chapter close (plus manual pins and simulation results),
    -- injected into GAME STATE as server-tracked canon. known_by scopes who
    -- may read a fact through the API: 'party' (everyone), 'dm' (prompt-only
    -- secret), or a JSON array of character ids. Superseding keeps history:
    -- a new fact about the same subject retires the old row instead of
    -- editing it. embedding stays NULL until the semantic index fills it.
    CREATE TABLE IF NOT EXISTS world_facts (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      category TEXT NOT NULL
        CHECK (category IN ('location','npc','promise','world','party','lore')),
      subject TEXT NOT NULL DEFAULT '',
      fact TEXT NOT NULL,
      known_by TEXT NOT NULL DEFAULT 'party',
      pinned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','superseded','retired')),
      source TEXT NOT NULL DEFAULT 'chapter'
        CHECK (source IN ('chapter','compaction','manual','simulation')),
      source_seq INTEGER,
      embedding BLOB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_facts
      ON world_facts(campaign_id, status, category);

    -- Semantic memory index: verbatim transcript spans ("scenes") from
    -- closed chapters with local MiniLM embeddings (384-dim Float32 BLOBs),
    -- built at chapter close by src/lib/dm/memory-index.ts. Two-phase
    -- recall: cosine over chapter-summary embeddings picks chapters, then
    -- cosine over their scenes returns verbatim text. Brute-force JS math;
    -- no vector extension.
    CREATE TABLE IF NOT EXISTS scene_chunks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      seq_start INTEGER NOT NULL,
      seq_end INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scene_chunks
      ON scene_chunks(campaign_id, chapter_id);

    -- Full world-state snapshots at chapter boundaries, so the party lead can
    -- rewind the campaign to the start of any chapter (src/lib/dm/rollback.ts).
    -- 'boundary' rows are captured when a chapter opens; the single
    -- 'pre_rollback' row per campaign is the safety copy taken just before a
    -- rewind rewrites everything.
    CREATE TABLE IF NOT EXISTS chapter_snapshots (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      chapter_index INTEGER NOT NULL,
      boundary_seq INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'boundary'
        CHECK (kind IN ('boundary','pre_rollback')),
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (campaign_id, chapter_index, kind)
    );

    -- Lead-authored world lore (the world bible): structured entries the DM
    -- prompt samples from and search_lore queries. Pinned entries always
    -- reach the prompt; the rest compete on embedding similarity.
    CREATE TABLE IF NOT EXISTS lore_entries (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN
        ('geography','factions','history','magic','culture','religion','other')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lore_entries
      ON lore_entries(campaign_id, category);

    -- House-rules chunks: campaigns.house_rules_text split into retrievable
    -- pieces (src/lib/dm/rules-logic.ts). Rechunked on every save; enabled and
    -- pinned flags survive by fuzzy match. Pinned chunks always reach the
    -- prompt; enabled ones compete on embedding similarity per turn.
    CREATE TABLE IF NOT EXISTS rule_chunks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      heading TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rule_chunks
      ON rule_chunks(campaign_id, chunk_index);

    -- DM-proposed inventory/gold changes awaiting the owning player's answer
    -- (game setting inventoryApprovals). The original tool args are stored so
    -- approval replays the exact mutation through applyDmMutation.
    CREATE TABLE IF NOT EXISTS item_proposals (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      turn_id TEXT,
      character_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      args_json TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','declined','expired','cancelled')),
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_item_proposals
      ON item_proposals(campaign_id, status);

    -- Procedural region map: seeded terrain grid (one char per tile), known
    -- locations anchored at tile coordinates, and lead-placed pins
    -- (src/lib/overworld/generate.ts). One per campaign, lazily created.
    CREATE TABLE IF NOT EXISTS overworld_maps (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      seed INTEGER NOT NULL,
      width INTEGER NOT NULL DEFAULT 48,
      height INTEGER NOT NULL DEFAULT 36,
      terrain TEXT NOT NULL,
      anchors_json TEXT NOT NULL DEFAULT '{}',
      pins_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

  // Multiplayer additive columns, one PRAGMA per table.
  const addColumns = (table: string, columns: Array<[name: string, ddl: string]>) => {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    for (const [name, ddl] of columns) {
      if (!existing.some((column) => column.name === name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
      }
    }
  };

  addColumns("campaigns", [
    // Game-facing settings (genre, dice policy, TTS, maps); settings_json
    // keeps holding the model/image StorySettings so the two never fight.
    ["game_settings_json", `TEXT NOT NULL DEFAULT '{}'`],
    // Secret story outline written by the AI story setup pass.
    ["dm_outline", `TEXT NOT NULL DEFAULT ''`],
    // Structured secret story arc (main beats + quest sub-arcs); supersedes
    // dm_outline in the prompt when present.
    ["story_arc_json", `TEXT NOT NULL DEFAULT ''`],
    // Turn/floor control: who may act right now.
    ["floor_json", `TEXT NOT NULL DEFAULT '{"mode":"open"}'`],
    // Guard so the resume recap is inserted at most once per idle gap.
    ["last_recap_seq", `INTEGER NOT NULL DEFAULT 0`],
    // Party lead: the player who can steer the story and fix stats when the
    // AI DM errs. Null means the campaign owner leads.
    ["party_lead_user_id", `TEXT`],
    // World-simulation counters and pending sparks (world-tick-logic.ts).
    ["world_tick_json", `TEXT NOT NULL DEFAULT ''`],
    // Lead-authored house rules; chunked into rule_chunks on save for
    // per-turn retrieval (src/lib/dm/rules-logic.ts).
    ["house_rules_text", `TEXT NOT NULL DEFAULT ''`],
  ]);

  const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "avatar_json")) {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_json TEXT`);
  }

  addColumns("users", [
    // Global admin: may manage users and app-wide settings at /admin.
    ["is_admin", `INTEGER NOT NULL DEFAULT 0`],
    // Set by an admin password reset; the user is forced through the
    // change-password flow before doing anything else.
    ["must_change_password", `INTEGER NOT NULL DEFAULT 0`],
    // Discord account id for "Sign in with Discord"; NULL when unlinked.
    ["discord_id", `TEXT`],
  ]);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord
       ON users(discord_id) WHERE discord_id IS NOT NULL`,
  );

  addColumns("campaign_members", [
    // Player opted in to rolling physical dice (when the campaign allows it).
    ["use_real_dice", `INTEGER NOT NULL DEFAULT 0`],
  ]);

  // NULL features_json marks a sheet from before features existed; the
  // backfill below fills it exactly once, so check before the column lands.
  const sheetColumns = db.prepare(`PRAGMA table_info(character_sheets)`).all() as Array<{
    name: string;
  }>;
  const sheetsNeedFeatureBackfill = !sheetColumns.some(
    (column) => column.name === "features_json",
  );
  // Same one-shot trick for the AC engine: every sheet that exists before
  // ac_override lands keeps its hand-typed armor class, so nobody logs in to
  // find their character suddenly wearing different numbers.
  const sheetsNeedAcOverride = !sheetColumns.some((column) => column.name === "ac_override");

  addColumns("character_sheets", [
    // Death-save track for a character at 0 HP; NULL = not dying. Managed
    // by the server death engine (src/lib/dm/death.ts).
    ["death_saves_json", `TEXT`],
    // Spell currently concentrated on; NULL = none. Managed by the server
    // concentration engine (src/lib/dm/concentration.ts).
    ["concentrating_on", `TEXT`],
    ["library_character_id", `TEXT`],
    ["subclass", `TEXT NOT NULL DEFAULT ''`],
    // Player-authored backstory, visible to the whole party and the DM.
    ["backstory", `TEXT NOT NULL DEFAULT ''`],
    // Class features, racial traits, and story-granted abilities; the DM
    // prompt treats this as the complete list of what a character can do.
    ["features_json", `TEXT`],
    // Duration/save-ends metadata keyed by condition name; ticked at round
    // wrap (src/lib/dm/condition-tick.ts).
    ["condition_meta_json", `TEXT NOT NULL DEFAULT '{}'`],
    // Limited-use class-resource counters (Rage, Ki...); NULL = pre-engine
    // sentinel, backfilled from features on boot.
    ["resources_json", `TEXT`],
    // Exhaustion level 0-6; mechanical effects in src/lib/dm/condition-logic.ts.
    ["exhaustion", `INTEGER NOT NULL DEFAULT 0`],
    // Active Wild Shape beast form and its own HP pool; NULL = own body.
    // Damage routes here first (src/lib/dm/mutations.ts, apply_damage).
    ["wild_shape_json", `TEXT`],
    // Bound creatures (familiars, animal companions, drakes); managed by
    // the pet engine (src/lib/dm/pet-tools.ts). NULL = none.
    ["pets_json", `TEXT`],
    // AI companion party member: owned by an unloginable bot user row so
    // UNIQUE(campaign_id, user_id) and the users FK stay satisfied. The DM
    // drives these sheets (src/lib/dm/companion-tools.ts).
    ["is_companion", `INTEGER NOT NULL DEFAULT 0`],
    // 'party' = travels with the party until dismissed; 'guest' = scene-
    // scoped ally the DM writes out when the scene ends.
    ["companion_kind", `TEXT`],
    // Short personality/voice brief the DM roleplays from.
    ["personality", `TEXT NOT NULL DEFAULT ''`],
    // 1 = the `ac` column is a hand-set number the AC engine must not
    // recompute (src/lib/srd/armor.ts). Sheets created before the engine are
    // backfilled to 1 so no existing character's armor class changes under
    // them; new sheets derive their AC from what they wear.
    ["ac_override", `INTEGER NOT NULL DEFAULT 0`],
    // Multiclass class list [{id, subclass, level}]; NULL/empty = the
    // scalar class/subclass/level columns are the truth. When present, the
    // scalars are mirrors (src/lib/db/sheets.ts keeps them in sync).
    ["classes_json", `TEXT`],
    // Per-class hit-die pools [{classId, die, total, spent}]; NULL until
    // the first multiclass level-up. hit_dice_json stays the summed mirror.
    ["hit_dice_pools_json", `TEXT`],
  ]);

  if (sheetsNeedAcOverride) {
    db.prepare(`UPDATE character_sheets SET ac_override = 1`).run();
  }

  // One-time: size resource counters for sheets created before the engine.
  backfillSheetResources(db);

  if (sheetsNeedFeatureBackfill) {
    backfillSheetFeatures(db);
  }

  // This machine's DM backend moved from Ollama to llama-server (llama.cpp)
  // on :8001. Retarget campaigns still pointing at the old Ollama endpoint;
  // idempotent because rewritten rows no longer match the WHERE.
  const staleBackends = db
    .prepare(
      `SELECT id, settings_json FROM campaigns
       WHERE settings_json LIKE '%127.0.0.1:11434/v1%' OR settings_json LIKE '%localhost:11434/v1%'`,
    )
    .all() as Array<{ id: string; settings_json: string }>;
  for (const row of staleBackends) {
    try {
      const settings = JSON.parse(row.settings_json) as {
        textProvider?: string;
        customBaseUrl?: string;
        customModel?: string;
      };
      if (settings.textProvider !== "custom" || !/:11434\/v1$/.test(settings.customBaseUrl ?? "")) {
        continue;
      }
      settings.customBaseUrl = "http://127.0.0.1:8001/v1";
      if (settings.customModel?.startsWith("qwen3.6")) {
        settings.customModel = "qwen3.6-35b";
      }
      db.prepare(`UPDATE campaigns SET settings_json = ? WHERE id = ?`).run(
        JSON.stringify(settings),
        row.id,
      );
    } catch {
      // Unparseable settings stay untouched; the campaign UI can fix them.
    }
  }

  addColumns("campaign_messages", [
    // Set on the DM message that moved the party somewhere new so the chat
    // can render that location's map inline. The map itself stays on the
    // locations row; this is only a reference.
    ["location_id", `TEXT`],
  ]);

  addColumns("dm_turns", [
    // Pending location reference for the message finalize() will write;
    // persisted so it survives a turn parked on physical dice.
    ["location_id", `TEXT`],
    // Per-turn cap counter for encounter tool calls, like mutation_count.
    ["encounter_count", `INTEGER NOT NULL DEFAULT 0`],
    // Player whispers this turn consumed; persisted so a turn parked on
    // physical dice still marks them answered when it finishes.
    ["player_whisper_ids_json", `TEXT NOT NULL DEFAULT '[]'`],
    // Enemies that already attacked this turn; the auto-act fallback in
    // encounter-tools.ts skips them so nothing swings twice.
    ["acted_enemy_ids_json", `TEXT NOT NULL DEFAULT '[]'`],
    // PCs whose combat turn was adjudicated this DM turn (pc_attack,
    // cast_at_enemy, or end_turn); advanceAfterTurn only moves the pointer
    // past a PC on this list or with a landed non-initiative roll.
    ["resolved_character_ids_json", `TEXT NOT NULL DEFAULT '[]'`],
    // Character ids that actually received a send_whisper this turn; finalize()
    // marks a player's pending whisper answered only if its sender is here, so
    // a turn that never replied cannot silently consume the message.
    ["answered_whisper_character_ids_json", `TEXT NOT NULL DEFAULT '[]'`],
  ]);

  addColumns("encounters", [
    // The action economy of whichever combatant is currently acting: action,
    // bonus action, reaction, attacks made, and movement spent. Rebuilt from
    // scratch whenever the initiative pointer moves, so it never needs a
    // migration of its own (src/lib/dm/action-budget.ts).
    ["turn_budget_json", `TEXT`],
    // Combatants who were surprised when the fight began; they lose their
    // first turn. Cleared once round 1 is over.
    ["surprised_ids_json", `TEXT NOT NULL DEFAULT '[]'`],
    // Enemy ids that have spent their reaction this round (opportunity
    // attacks); emptied when the round wraps.
    ["reactions_used_json", `TEXT NOT NULL DEFAULT '[]'`],
  ]);

  addColumns("encounter_enemies", [
    // Server-tracked enemy conditions (prone, poisoned, ...), applied via
    // set_enemy_condition / clear_enemy_condition.
    ["conditions_json", `TEXT NOT NULL DEFAULT '[]'`],
    // Duration/save-ends metadata keyed by condition name; ticked at round
    // wrap (src/lib/dm/condition-tick.ts).
    ["condition_meta_json", `TEXT NOT NULL DEFAULT '{}'`],
    // Spell this enemy is concentrating on (best-effort: recorded when the
    // model casts through the tools with casterEnemyId); damage forces the
    // CON save and a break clears the spell's conditions
    // (src/lib/dm/enemy-damage.ts).
    ["concentration", `TEXT`],
  ]);

  addColumns("pending_rolls", [
    // Damage rolls aimed at an enemy: the server applies the result to this
    // enemy the moment the roll resolves (src/lib/dm/enemy-damage.ts).
    ["target_enemy_id", `TEXT`],
    // Server summary of what the resolved roll already did (damage applied,
    // initiative locked); surfaced to the model when the parked turn resumes.
    ["combat_note", `TEXT`],
    // Parked pc_attack to-hit rolls: the adjudication context (target enemy,
    // AC, damage expressions) the server needs when the d20 is submitted
    // (src/lib/dm/pc-attack.ts).
    ["attack_json", `TEXT`],
  ]);

  addColumns("rolls", [
    // Enemy a damage roll was server-applied to, and the applied flag; the
    // damage_enemy double-apply guard checks both.
    ["target_enemy_id", `TEXT`],
    ["applied", `INTEGER NOT NULL DEFAULT 0`],
    // Campaign seq at insert time, stamped going forward so chapter rewind
    // can delete by position; NULL rows fall back to created_at.
    ["seq", `INTEGER`],
  ]);

  addColumns("campaign_notes", [
    // 'dm' marks a note the AI DM suggested via write_campaign_note; the FK
    // on author_user_id forces those rows to carry the campaign owner's id,
    // so this flag is what distinguishes them in the UI.
    ["author_kind", `TEXT NOT NULL DEFAULT 'user'`],
    // MiniLM embedding of title+body for search_lore; NULL until indexed.
    ["embedding", `BLOB`],
  ]);

  addColumns("dm_whispers", [
    // 'to_player' = DM-sent (send_whisper); 'to_dm' = player-sent private
    // message the DM consumes on its next turn.
    ["direction", `TEXT NOT NULL DEFAULT 'to_player'`],
    // For 'to_dm' rows: the dm_turns.id that consumed this whisper. NULL
    // means pending; pending rows gate the per-player send cap and keep a
    // coalesced follow-up turn from skipping as "nothing new".
    ["answered_turn_id", `TEXT`],
  ]);

  addColumns("sheet_audit", [
    // Full sheet snapshot taken before the mutation, so the party lead can
    // undo it. Rows from before undo support keep NULL and are not undoable.
    ["before_json", `TEXT`],
    // The exact top-level sheet fields the mutation wrote.
    ["patch_json", `TEXT`],
    // Set once the lead undoes this entry: id of the compensating row.
    ["reverted_by", `TEXT`],
    ["reverted_at", `TEXT`],
  ]);

  addColumns("chapters", [
    // MiniLM embedding of the chapter summary, for phase-1 chapter picking
    // in semantic recall. NULL until the chapter is indexed.
    ["embedding", `BLOB`],
  ]);

  addColumns("npcs", [
    // NPC agency (src/lib/dm/npc-logic.ts): six -3..+3 personality axes
    // (drive/diligence/boldness/warmth/empathy/composure), empty = untracked.
    ["personality_json", `TEXT NOT NULL DEFAULT ''`],
    // {scene?, session?: {text, progress, target}, ambition?}; the session
    // goal advances via background dice at chapter close.
    ["goals_json", `TEXT NOT NULL DEFAULT ''`],
    // Directed NPC-to-NPC edges: [{npcName, score -3..3, note?}].
    ["relations_json", `TEXT NOT NULL DEFAULT '[]'`],
    // Per-character relation meters: [{characterId, score -3..3}].
    ["bonds_json", `TEXT NOT NULL DEFAULT '[]'`],
    // {ignored, engaged} chapter counters; being ignored cools an NPC.
    ["pressure_json", `TEXT NOT NULL DEFAULT ''`],
    // Link to the story arc's cast entry (ArcNpc id) when name-matched.
    ["arc_cast_id", `TEXT NOT NULL DEFAULT ''`],
  ]);

  // Portraits uploaded in-game used to reach the library only on campaign
  // end; they now mirror immediately. One-time catch-up for portraits that
  // were stranded on campaign sheets, guarded by an app_settings marker.
  const portraitMarker = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'portrait_backfill_done'`)
    .get();
  if (!portraitMarker) {
    backfillLibraryPortraits(db);
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
    ).run("portrait_backfill_done", "true", new Date().toISOString());
  }

  // Reverse catch-up: library uploads used to skip campaign clones, so
  // sheets copied before their photo existed still have none. Fill-only.
  const sheetPortraitMarker = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'sheet_portrait_backfill_done'`)
    .get();
  if (!sheetPortraitMarker) {
    backfillSheetPortraits(db);
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
    ).run("sheet_portrait_backfill_done", "true", new Date().toISOString());
  }
}

// Copy each library character's portrait onto linked campaign sheets that
// have none; sheets with their own portrait are left alone.
function backfillSheetPortraits(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT cs.id AS id, lc.sheet_json AS sheet_json
       FROM character_sheets cs
       JOIN library_characters lc ON lc.id = cs.library_character_id
       WHERE cs.portrait_json IS NULL`,
    )
    .all() as Array<{ id: string; sheet_json: string }>;
  const update = db.prepare(`UPDATE character_sheets SET portrait_json = ? WHERE id = ?`);
  for (const row of rows) {
    try {
      const sheet = JSON.parse(row.sheet_json) as { portrait?: unknown };
      if (sheet.portrait) {
        update.run(JSON.stringify(sheet.portrait), row.id);
      }
    } catch {
      // Unparseable blobs stay untouched.
    }
  }
}

// Copy each linked campaign sheet's portrait into its library character when
// the library copy has none; the newest campaign sheet wins.
function backfillLibraryPortraits(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT lc.id AS id, lc.sheet_json AS sheet_json, cs.portrait_json AS portrait_json
       FROM library_characters lc
       JOIN character_sheets cs ON cs.library_character_id = lc.id
       WHERE cs.portrait_json IS NOT NULL
       ORDER BY cs.updated_at ASC`,
    )
    .all() as Array<{ id: string; sheet_json: string; portrait_json: string }>;
  const update = db.prepare(`UPDATE library_characters SET sheet_json = ? WHERE id = ?`);
  // ASC ordering means later (newer) rows overwrite earlier ones in the map.
  const newestPortraits = new Map<string, { id: string; sheet_json: string; portrait_json: string }>();
  for (const row of rows) {
    newestPortraits.set(row.id, row);
  }
  for (const row of newestPortraits.values()) {
    try {
      const sheet = JSON.parse(row.sheet_json) as { portrait?: unknown };
      if (!sheet.portrait) {
        sheet.portrait = JSON.parse(row.portrait_json);
        update.run(JSON.stringify(sheet), row.id);
      }
    } catch {
      // Unparseable blobs stay untouched.
    }
  }
}

// One-time backfill when the features_json column first lands: existing
// sheets and library blobs get their SRD class features and racial traits so
// the DM prompt can honestly call the list complete from the first turn.
function backfillSheetFeatures(db: Database.Database) {
  const sheets = db
    .prepare(
      `SELECT id, class, subclass, race, level FROM character_sheets WHERE features_json IS NULL`,
    )
    .all() as Array<{ id: string; class: string; subclass: string | null; race: string; level: number }>;
  const updateSheet = db.prepare(`UPDATE character_sheets SET features_json = ? WHERE id = ?`);
  for (const row of sheets) {
    const features = populateFeatures([], row.class, row.subclass ?? "", row.race, row.level);
    updateSheet.run(JSON.stringify(features), row.id);
  }

  const blobs = db
    .prepare(`SELECT id, sheet_json, level FROM library_characters`)
    .all() as Array<{ id: string; sheet_json: string; level: number }>;
  const updateBlob = db.prepare(`UPDATE library_characters SET sheet_json = ? WHERE id = ?`);
  for (const row of blobs) {
    try {
      const sheet = JSON.parse(row.sheet_json) as {
        class?: string;
        subclass?: string;
        race?: string;
        features?: unknown;
      };
      if (!Array.isArray(sheet.features)) {
        sheet.features = populateFeatures(
          [],
          sheet.class ?? "",
          sheet.subclass ?? "",
          sheet.race ?? "",
          row.level,
        );
        updateBlob.run(JSON.stringify(sheet), row.id);
      }
    } catch {
      // A malformed blob self-heals on next instantiation; skip it here.
    }
  }
}

// Sheets created before the resource engine get counters sized from their
// existing features list; NULL resources_json is the pre-migration marker.
// Boot resync for every sheet: re-derive class/race features from the
// current tables (keeping feat/story extras; populateFeatures is
// idempotent) and re-size resources from those features, preserving spent
// uses. Self-heals table fixes and matcher fixes on existing sheets — e.g.
// the half-elf "Skill Versatility" trait once substring-matched "ki" and
// stamped monk Ki onto any half-elf, and paladins predate Channel Divinity
// landing in the base class table. Writes only rows that actually changed.
function backfillSheetResources(db: Database.Database) {
  const sheets = db
    .prepare(
      `SELECT id, class, subclass, race, level, abilities_json, features_json, resources_json
         FROM character_sheets`,
    )
    .all() as Array<{
    id: string;
    class: string;
    subclass: string | null;
    race: string;
    level: number;
    abilities_json: string;
    features_json: string | null;
    resources_json: string | null;
  }>;
  if (!sheets.length) {
    return;
  }
  const update = db.prepare(
    `UPDATE character_sheets SET features_json = ?, resources_json = ? WHERE id = ?`,
  );
  for (const row of sheets) {
    try {
      const existingFeatures = JSON.parse(row.features_json ?? "[]") as Parameters<
        typeof populateFeatures
      >[0];
      const abilities = JSON.parse(row.abilities_json) as Record<string, number>;
      const mods = Object.fromEntries(
        Object.entries(abilities).map(([ability, score]) => [
          ability,
          Math.floor((score - 10) / 2),
        ]),
      );
      const existingResources = row.resources_json
        ? (JSON.parse(row.resources_json) as Parameters<typeof populateResources>[3])
        : undefined;
      const features = populateFeatures(
        existingFeatures,
        row.class,
        row.subclass ?? "",
        row.race,
        row.level,
      );
      const resources = populateResources(features, row.level, mods, existingResources);
      const nextFeatures = JSON.stringify(features);
      const nextResources = JSON.stringify(resources);
      if (nextFeatures !== row.features_json || nextResources !== row.resources_json) {
        update.run(nextFeatures, nextResources, row.id);
      }
    } catch {
      // Unparseable rows stay untouched; the sheet UI can still fix them.
    }
  }
}

function requireDbKey() {
  const key = serverEnv("DB_ENCRYPTION_KEY");
  if (!key) {
    throw new Error(
      "DB_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to .env.server. " +
        "For an existing plaintext database, then run: node scripts/migrate-encrypt-db.mjs",
    );
  }

  return key;
}

// Module-level (not on globalThis) so a dev HMR reload of this file re-runs
// ensureSchema once on the next call, picking up schema edits; in prod it
// runs exactly once per boot. It must NOT run per call: the boot resync
// includes a full character_sheets backfill and table_info sweeps.
let schemaEnsured = false;

export function getDatabase() {
  if (globalThis.__localRoleplayDb) {
    if (!schemaEnsured) {
      ensureSchema(globalThis.__localRoleplayDb);
      schemaEnsured = true;
    }
    return globalThis.__localRoleplayDb;
  }

  const key = requireDbKey();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("cipher='chacha20'");
  db.pragma(`key='${key.replaceAll("'", "''")}'`);
  try {
    db.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch {
    db.close();
    throw new Error(
      `Could not decrypt ${dbPath}: wrong or missing DB_ENCRYPTION_KEY. ` +
        "If this database predates encryption, run: node scripts/migrate-encrypt-db.mjs",
    );
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  schemaEnsured = true;

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
