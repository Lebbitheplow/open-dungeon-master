# Roadmap

## Delivered

**Phase 1 (2026-07-17):** fork foundation. Accounts, campaigns with invite
codes and lobbies, structured SRD 5.1 character sheets, the server-side
dice engine, the SSE real-time layer, and the AI Dungeon Master tool loop
with server-enforced rolls.

**Full-vision build (2026-07-17):**

- Open5e content pack (1,435 spells, 107 subclasses, 2,047 items, 3,207
  monsters, 54 races, 42 backgrounds, 74 feats) in a read-only content DB,
  with per-user homebrew entries merged into every picker and a /licenses
  attribution page. See docs/content.md.
- Per-user character library (characters saved to the profile, reusable
  across campaigns via copy-on-instantiate with level adaptation; durable
  progression syncs back on campaign end or on demand).
- Full creation wizard: point buy / standard array / rolled stats, Open5e
  races, subclasses, backgrounds, searchable spell/equipment/feat pickers.
- Campaign settings: genre presets (high fantasy, dark fantasy, mystery,
  horror, cyberpunk, steampunk, post-apocalyptic, custom) with per-genre DM
  flavor and map art style; AI story setup (secret DM outline); dice
  policy; TTS voice; maps toggle; invite links (/join/CODE); live
  owner-editable settings in the lobby.
- Turn/floor control: request_player_input spotlight tool, server-enforced
  composer locking, owner override.
- Real dice mode: per-player opt-in; rolls park the persisted DM-turn state
  machine (dm_turns/pending_rolls, survives restarts) until the player
  enters their physical dice; digital fallback button.
- DM stat authority: apply_damage, heal, award_xp (with level-up flow),
  modify_gold, grant/remove_item, set/clear_condition, use_spell_slot; all
  server-clamped, audit-logged (sheet_audit), live in the session Log tab.
- Locations and maps: move_party/update_location tools keep structured area
  state in GAME STATE; ComfyUI renders genre-styled top-down maps on a
  serial media queue when vision allows; Map tab with history + owner
  redraw.
- Voice: push-to-talk via local faster-whisper (odm-stt.service :8870,
  confirm-then-send) and Kokoro TTS narration per campaign voice with
  per-user mute/volume and replay.
- Memory: record_event tool + compaction-time extraction feed per-character
  "story so far" on the profile and recent developments in GAME STATE;
  "Previously..." recap after 6h idle.

## Next

### Combat engine

- Structured combat mode: initiative order (extend the Floor union with an
  initiative mode), strict turn ownership, round tracking
- Action economy: action, bonus action, reaction, movement tracking
- Conditions with mechanical effects (advantage/disadvantage wiring)
- Death saves, concentration checks
- Turn timeouts with skip/delay/auto-dodge options

### Encounters

- Encounter builder over the imported monster stat blocks (already in the
  content DB) respecting party level, size, and difficulty
- Loot generation rules

### Tactical maps

- Grid battlemaps with tokens and fog of war, layered on the existing
  locations substrate (connections_json + layout_description)

### Polish

- Spell slot enforcement at cast time (validate against the content DB)
- Ritual casting, concentration duration tracking
- Quest tracker UI backed by structured quest objects
- NPC memory (impressions, trust, debts, promises), faction reputation
- Owner console: edit memories, inject events, override rolls
- Per-player whispers and private rolls
- Campaign export/import
- Multiple DM personalities
- Split the solo monolith (src/app/solo/page.tsx) into components
- Remove vestigial mflux/sdnq image backend enum values

## Known limitations

- Combat is narrative-only (no initiative or strict action economy yet)
- Spell picks are advisory; slots are enforced only via the DM's
  use_spell_slot tool, not validated against the spell list at cast time
- One character per player per campaign
- The Ollama "local" provider (Gemma) calls tools less reliably than the
  OpenAI-compatible path; the default DM model is qwen3.6-dm via Ollama's
  OpenAI endpoint
