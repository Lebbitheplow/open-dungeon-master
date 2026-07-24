<div align="center">

<img src="docs/banner.png" alt="Open Dungeon Master" width="100%">

<br>

[![License: MIT](https://img.shields.io/badge/license-MIT-d4ab3a?labelColor=151229&style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-d4ab3a?labelColor=151229&style=flat-square)](package.json)
[![Ruleset: D&D 5e SRD 5.1](https://img.shields.io/badge/ruleset-D%26D%205e%20SRD%205.1-d4ab3a?labelColor=151229&style=flat-square)](docs/rules-coverage.md)
[![Runs: fully on-device](https://img.shields.io/badge/runs-fully%20on--device-d4ab3a?labelColor=151229&style=flat-square)](#requirements)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-e0703a?labelColor=151229&style=flat-square)](#)

</div>

**Open Dungeon Master** runs multiplayer (and solo) Dungeons &amp; Dragons 5e
campaigns with an AI Dungeon Master, fully on your own machine. A local model is
the creative mind and narrator; a stack of server-side engines enforces the 5e
rules for both the players and the DM. **The narrator never owns the numbers** —
dice, hit points, spell slots, conditions, and the death track are computed and
clamped by the backend, and the model changes game state only through tools the
server validates.

It began as a fork of [Open Dungeon](https://github.com/newideas99/open-dungeon)
to add multiplayer, and grew into a different app: the AI drives the session,
requesting rolls, starting encounters, and playing NPCs and companions, following
a secret story arc it regenerates as the campaign moves.

<div align="center">

### The table, mid-combat

<img src="docs/screenshot-table.png" alt="A multiplayer campaign in progress: DM narration, a natural-20 attack, and the live party panel" width="960">

<sub><i>A live session of <b>The Hollow Crown of Vael Ardûn</b> — DM narration and server-rolled dice on the left, the encounter tracker and the whole party's HP, conditions and resources on the right.</i></sub>

</div>

## What's in the box

<table>
<tr>
<td width="50%" valign="top" align="center">
<img src="public/sidebar-icons/chats.png" width="56"><br>
<b>The multiplayer table</b><br>
<sub>Create a campaign, share an invite code, ready up in the lobby, and play in real time (SSE live updates) with a party lead who steers settings, rolls and turn order. Solo play runs the same engines.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="public/sidebar-icons/text-model.png" width="56"><br>
<b>Local AI Dungeon Master</b><br>
<sub>Any OpenAI-compatible server with tool calling — llama.cpp, Ollama, LM Studio, vLLM. The model narrates and makes creative calls; it never states a roll or edits its own numbers.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top" align="center">
<img src="public/sidebar-icons/support.png" width="56"><br>
<b>Server-enforced 5e rules</b><br>
<sub>Initiative and action economy, server-resolved attacks and crits, spell slots and upcasting, the full condition table, short/long rests, AC and progression — all clamped and audit-logged.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="public/sidebar-icons/story.png" width="56"><br>
<b>Secret story arc &amp; maps</b><br>
<sub>A hidden spine (premise, stakes, antagonist, ordered beats) regenerated as chapters close, a live quest log, rolling-summary memory, and procedural fog-of-war battle maps.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top" align="center">
<img src="public/sidebar-icons/characters.png" width="56"><br>
<b>Characters &amp; companions</b><br>
<sub>Structured SRD 5.1 sheets, 48 classes and 49 backgrounds, a guided creation wizard and level-up flow, and full AI companions with real sheets that auto-level with the party.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="public/sidebar-icons/images.png" width="56"><br>
<b>Battle maps &amp; scene art</b><br>
<sub>Optional ComfyUI drives character portraits, inline scene art and top-down battle maps with per-character line of sight. Missing? It fails soft to a placeholder.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top" align="center">
<img src="public/sidebar-icons/local-data.png" width="56"><br>
<b>On-device &amp; encrypted</b><br>
<sub>All state lives in a local SQLite database, encrypted at rest. No accounts in the cloud, no telemetry — username/password auth (optional Discord), with an admin panel and undoable audit log.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="public/sidebar-icons/chats.png" width="56"><br>
<b>Session tools</b><br>
<sub>Private DM-to-player whispers, player-to-player side chats the DM never sees, a 3D dice tray, DM voice narration (TTS), push-to-talk, and an installable PWA layout.</sub>
</td>
</tr>
</table>

## How it works

- **The engines own the rules.** The model narrates and makes creative calls, but
  it can only touch game state through server tools that are clamped, audit-logged,
  and published live to every player. It treats player messages as intent, not
  outcome.
- **The AI drives the table.** It asks the server for rolls (`request_roll`), starts
  and runs combat, plays NPCs and AI companions, moves the party, and decides when
  to spotlight specific players for input.
- **It follows a secret story arc.** Every campaign gets a hidden spine generated at
  start and refreshed with a small clamped delta each time a chapter closes, so the
  plot advances without the model rewriting history. Player-safe pieces surface as
  the quest log; DM-only hooks stay hidden.

The authoritative ledger of exactly what is enforced, what is guidance, and what is
out of scope is [docs/rules-coverage.md](docs/rules-coverage.md).

## Systems &amp; engines

The app is a stack of about fifty focused engines. The split is deliberate: pure
rules math lives in `src/lib/srd/` (database-free, each with its own test), and the
server-side enforcement and tool handlers live in `src/lib/dm/`. The model narrates
and makes creative calls, but it never adjudicates: every number below is computed
and clamped by code.

### Combat (server-enforced)

- **PC attack engine** - resolves player weapon and spell attacks: weapon pick, to-hit, damage, AC adjudication, and feature riders.
- **Enemy damage and enemy attack engines** - the single server path for damage landing on an enemy and for monster attacks rolled against PC AC; also owns encounter-finish.
- **Death and dying engine** - death-save state at 0 HP, auto-rolled saves on skipped turns, massive-damage instant death, and stabilize/heal clears.
- **Conditions engine** - the SRD condition table with round and save-ends durations and resistances, plus a named buff-condition registry (Bless, Shield of Faith, and the like).
- **Concentration engine** - casting sets and breaks it, incoming damage forces the CON save server-side, and dropping to 0 HP ends it.
- **Action economy and multiattack engine** - the per-turn action/bonus/reaction budget, Extra Attack, once-per-turn riders like Sneak Attack, Dash/Disengage, and Haste.
- **Opportunity attack engine** - fires when a token leaves an enemy's reach and resolves the reaction attack server-side.
- **Spell and cast engine** - derives save DC, half-on-save, damage type, and applied conditions from data; covers cast-at-enemy, cast-at-player, area-of-effect, and buffs.
- **Aura engine** - position-aware Aura of Protection reaching nearby allies on the battle map, non-stacking.
- **Initiative and encounter engine** - deterministic initiative order, enemy spawning, and the encounter turn pointer.

### Character sheet rules

- **Sheet derivation engine** - central compute of AC, saves, spell attack and DC, and passive scores from what the character actually is and wears.
- **Armor and AC engine** - the SRD armor table plus AC math (DEX caps, STR requirements, shields), shared by the server and the character builder.
- **Weapons engine** - the SRD weapon table with proficiency and the properties (finesse, thrown, reach, ammunition) the attack engine reads.
- **Class features engine** - grants SRD and genre-class features by level and subclass, including subclass always-prepared spells.
- **Feature effects engine** - turns feature names into typed mechanical riders (fighting styles, damage riders, defenses) and parses authored prose into them.
- **Class resource pools engine** - Rage, Ki, Channel Divinity, Second Wind, Lay on Hands, Bardic Inspiration and the rest: counts, recharge type, and effects.
- **Spell scaling engine** - cantrip tier scaling and per-slot damage and heal increases derived from SRD data rather than trusted to the model.
- **Class options engine** - invocations, maneuvers, metamagic, pact boons, infusions, runes, and disciplines stored as choice-sourced features.
- **ASI and point-buy engine** - ability-score-improvement thresholds (cap 20) and the standard 27-point point buy for creation.
- **Rest engine** - short and long rest math: hit-dice recovery, slot and resource refill, and condition pruning.
- **Multiclass engine** - ability prerequisites both ways, the shared multiclass slot table, per-class caster contribution, and a 3-class cap.

### Transformations, pets, and companions

- **Transformation and polymorph engine** - real beast stat blocks for Wild Shape and Polymorph, with overflow damage and form reversion.
- **Pet and familiar engine** - familiars, the Beast Master companion, the Drakewarden drake, and story pets, each validated against its source feature.
- **Companion engine** - full companion characters with their own sheet and bot user, added to initiative and the battle map and auto-leveled with the party.

### Items and anti-cheat

- **Magic item effects engine** - mechanical items (AC, save bonuses, resistances) gated by carried, equipped, and attuned state, feeding the same AC engine.
- **Consumables and items logic** - healing-potion tiers, generic consumable detection, and ammunition lookup.
- **Sheet mutation guard** - a server ceiling on DM-driven sheet edits that blocks illegitimate level, HP, gold, ability, and XP jumps no matter how the model is prompted.
- **Inventory approval engine** - an optional mode that turns DM inventory and gold changes into player-approved proposals instead of applying them immediately.

### Leveling and XP

- **XP and leveling engine** - the XP thresholds and level-for-XP math (the level-up itself is applied through the player's own in-app flow).
- **Milestone XP engine** - chapter-close awards, so roleplay-heavy campaigns still level.

### World simulation

- **Overworld and region map generation** - seeded value-noise terrain on a 96x72 grid with genre reskins, reconciling locations to anchors lazily as the party travels.
- **Battle map generation** - seeded tactical maps (terrain, lighting, spawns, line of sight and cover, movement budgets, pathfinding), regenerable from the encounter.
- **Location persistence** - structured per-area layout, exits, and connections so narration stays spatially consistent, plus an illustrated top-down map image.
- **Living-world tick engine** - a zero-model-call heartbeat that advances world state on dice and computes encounter pressure after each narration.
- **World arcs** - one or two escalating off-screen storylines that advance whether or not the party engages them.
- **NPC agency** - once-per-chapter goal advancement for every tracked NPC with no model call, surfacing outcomes as rumors and world facts.
- **World facts register** - authoritative player-visible and DM-only facts extracted from play and fed to prompts as canon or rumor.
- **Social and NPC attitude system** - attitudes tracked across sessions and `social_check` rolls against attitude-derived DCs that can shift them.
- **World utility engines** - CR-scaled treasure moved into real purses, object durability, and forced-march exhaustion via real CON saves.

### Narrative

- **Story arc and saga engine** - a three-tier secret spine (campaign-spanning saga, current-act beats, quest-scale sub-arcs) refreshed with clamped deltas and sequel chaining.
- **Chapter engine** - chapters close on completed story beats rather than message volume, triggering XP, fact extraction, NPC agency, memory indexing, and a snapshot.
- **Recap and compaction** - a rolling campaign summary and history compaction that keep prompts bounded.
- **Chapter rewind and snapshots** - a full world-state snapshot at each chapter open; a lead-confirmed rewind restores a boundary after taking a safety copy.
- **Story export** - finished campaigns and chapters exported to DOCX, ODT, or HTML.

### Memory and retrieval (RAG)

- **Semantic recall and memory index** - MiniLM (384-dim) two-phase recall over chapter summaries then verbatim scene chunks, behind the `recall_story` tool.
- **World lore builder** - lead-authored, embedded canon retrieved per turn, with `search_lore` searching lore, facts, notes, and chapter memory at once.
- **House rules and rules manager** - embedded house-rules text plus structured variant toggles, retrieved into the prompt's variant and house-rules blocks.
- **Per-turn context retrieval** - embeds the current moment once and rides only the most relevant lore and rule chunks into the prompt.
- **Lore check** - a player-flagged consistency verifier that returns a verdict, citations, and a suggested rewrite.

### AI and LLM integration

- **Model client (dual provider)** - streaming against an OpenAI-compatible `/chat/completions` server (llama.cpp, LM Studio, vLLM, OpenRouter) or a local Ollama.
- **DM turn engine** - a persisted park/resume state machine and tool-calling loop (up to four rounds) that salvages malformed tool calls and streams filtered narration.
- **DM prompt and tool families** - a rules-as-tools system prompt covering rolls, checks, encounters, casts, resources, rests, conditions, items, hazards, NPCs, notes, maps, and world.
- **TTS narration** - local Kokoro renders each DM message on the serial media queue, autoplayed latest-only with per-user mute.
- **STT push-to-talk** - proxies audio to a local faster-whisper service, kept off the network.
- **Portrait generation** - a one-shot ComfyUI character portrait at creation, with an icon fallback.

### Platform and multiplayer

- **Event bus (SSE)** - per-campaign publish/subscribe, the real-time multiplayer backbone.
- **Media queue** - a global serial GPU queue (one ComfyUI or TTS job at a time) since the iGPU shares memory with the DM model.
- **Whispers and side-chat** - one-way DM-to-player whispers and private player-to-player threads that never enter the DM prompt or the shared stream.
- **Turn, lead, and pending-roll flow** - lead controls, turn coalescing, and parked physical-dice roll requests.
- **Auth** - session cookies with scrypt hashing, optional Discord OAuth, and reverse-proxy-aware origin resolution.
- **Login throttle** - a per-username-and-IP lockout with backoff.
- **Admin panel and global config** - admin-gated settings with database-over-env-over-default precedence and a sign-ups toggle.
- **Encrypted storage** - single-writer SQLite encrypted at rest (ChaCha20) alongside the read-only Open5e content pack.

## Requirements

- **Node 22+** (npm). `npm install` pulls everything the app itself needs.
- **A text model backend** (one of):
  - [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` at
    `http://127.0.0.1:8001` serving a model named `qwen3.6-35b`. This is the default
    and preferred configuration (see below). Or:
  - any other OpenAI-compatible server with tool calling: Ollama, LM Studio, vLLM,
    TabbyAPI, KoboldCpp, or a remote API like OpenRouter.
- **Optional services** (each feature simply stays off, or falls back to a
  placeholder, without it):
  - [ComfyUI](https://github.com/comfyanonymous/ComfyUI) at `:8188` for character
    portraits, inline scene art, and battle maps
    ([docs/image-generation.md](docs/image-generation.md))
  - [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) at `:8880` for DM
    voice narration
  - a faster-whisper server at `:8870` for push-to-talk
    ([docs/configuration.md](docs/configuration.md))

## Quick start

```bash
git clone <this repo> && cd open-dungeon-master
npm install

# The database is encrypted at rest; generate a key once and keep it safe.
echo "DB_ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env.server

# Build the content pack: spells, feats, items, subclasses, monsters.
# Downloads from api.open5e.com once, then caches for offline re-runs.
node scripts/import-open5e.mjs

# Warm the local embedding model (MiniLM, ~86MB) into models/embeddings.
# Optional: the app auto-downloads it on first use, but this pulls it now
# so an offline machine has it ready.
npm run fetch-model

npm run dev        # http://localhost:3000, or:
npm run dev:lan    # 0.0.0.0:3005 so your party can reach it on the LAN
```

The **embedding model** (MiniLM, used for semantic story recall and lore search) is no
longer bundled in the repo. transformers.js downloads it from HuggingFace into
`models/embeddings/` the first time the app needs it, so first use requires network;
`npm run fetch-model` fetches it ahead of time.

Then start the DM model with llama.cpp's `llama-server`. See
[The default DM model](#the-default-dm-model-qwen36-35b-on-llamacpp) below for the
exact command and settings.

**The first account registered becomes the server admin.** To promote someone on an
existing install: `node scripts/make-admin.mjs <username>`.

### Content pack

`node scripts/import-open5e.mjs` builds `data/content/open5e.sqlite`, the read-only
pack holding every spell, feat, item, subclass, lineage and monster the character
builder and the DM can reach. Raw API pages are cached under `data/content/raw/`, so
later runs need no network; `--refresh` re-downloads them, and `CONTENT_DB_PATH`
points the app at a pack somewhere else.

Run it before your first session. The app still boots without the pack, but it falls
back to the much smaller bundled SRD 5.1 data in `src/lib/srd/` and shows a hint to
run the import, so players will find most content missing. The pack is not committed:
it is third-party open-licensed content (OGL, ORC and CC-BY documents) rebuildable
from the script in one command. See [docs/content.md](docs/content.md) and
[docs/LICENSES.md](docs/LICENSES.md).

For real sessions build and run the production server:

```bash
npm run build
npm run start:lan   # 0.0.0.0:3005
```

## The default DM model (qwen3.6-35b on llama.cpp)

The app defaults to llama.cpp's `llama-server` at `http://127.0.0.1:8001/v1` serving
Qwen3.6-35B-A3B (a MoE model, q8) under the model name `qwen3.6-35b`, with a **64K
context window** and Qwen's recommended samplers. A small default context silently
truncates the DM prompt (party sheets, scene, story summary), which makes the model
loop; the 64K window is what makes the difference. Run it:

```bash
llama-server -m Qwen3.6-35B-A3B-Q8_0.gguf \
  -c 65536 --jinja \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  --temp 0.7 --top-p 0.95 --top-k 20 --min-p 0.0 \
  --port 8001 --alias qwen3.6-35b
```

`--jinja` enables tool calling, which the dice engine and every sheet mutation depend
on. In llama-server's router mode the same settings live in the model's preset INI
instead of flags. If your server runs with `--api-key`, put the key in `.env.server`
as `OPENAI_COMPAT_API_KEY`.

### Tool calls need thinking mode

This is the setting that matters most for a working table, and it is not obvious.
Under the long DM prompt, qwen3.6-35b in non-thinking mode surfaces tool calls only
about one turn in five: it narrates fights instead of starting an encounter, asks a
player to roll in prose instead of calling `request_roll`, and generally stops
driving the engines. With reasoning enabled it calls tools reliably.

The app handles this per request, so you do not configure it on the server:

- It sends `chat_template_kwargs: { enable_thinking: true }` on the **tool-decision**
  model calls only, and keeps the **final narration** call non-thinking so it still
  streams to players smoothly.
- Set `DM_THINKING=0` to force thinking off everywhere. That makes turns fast but tool
  calls unreliable; it is a fallback, not a normal mode.

### Reasoning budget and latency

Left uncapped, a reasoning-enabled decision call can occasionally spiral for minutes
on a hard turn. Cap the reasoning budget on the server to roughly 1024-2048 tokens
(llama-server's `--reasoning-budget`, or the equivalent key in the preset INI).
Expect the tradeoff: tool-decision calls run about 50-100s and a full turn about
1.5-3 minutes on a single local GPU. Combat and multi-tool turns sit at the longer
end.

### presence_penalty

Keep `presence_penalty` at 0 for the DM. A meaningful presence penalty under the long
prompt suppresses tool calls (the model paraphrases the tool in prose instead of
emitting it). The app pins `presence_penalty: 0` in every request so a server-side
preset penalty cannot break tool calling; if you drive the model from somewhere else,
set it to 0 there too.

### The same model on other LLM software

The setup is pure settings, so it ports to any OpenAI-compatible server with tool
calling. The key settings to replicate anywhere: **context 65536, temperature 0.7,
top-p 0.95, top-k 20, min-p 0, presence_penalty 0**, plus a way to enable reasoning
for tool calls. Then point the app at your server (admin panel, campaign Text Model
settings, or `OPENAI_COMPAT_BASE_URL`). For Ollama, the committed
[Modelfile](models/qwen3.6-dm.Modelfile) bakes the same settings in:

```bash
ollama pull qwen3.6:35b-a3b-q8_0
ollama create qwen3.6-dm -f models/qwen3.6-dm.Modelfile
# then point the app at http://127.0.0.1:11434/v1, model qwen3.6-dm
```

More backends and model guidance: [docs/text-backends.md](docs/text-backends.md).

## Image generation (ComfyUI)

ComfyUI at `COMFYUI_URL` (default `http://127.0.0.1:8188`) drives three things:
character portraits generated once at character creation, inline scene art during
play, and the top-down battle maps. Any checkpoint works; the genre preset supplies
the art style. If ComfyUI is down or busy, these features fail soft to a placeholder
or a plain icon and the session keeps going.

All GPU-heavy media (ComfyUI images and TTS) run on a **single serial media queue**.
On a shared-memory iGPU the image model and the DM model compete for the same pool,
so jobs are serialized to avoid out-of-memory stalls rather than run in parallel.
Details in [docs/image-generation.md](docs/image-generation.md).

## Voice (TTS and push-to-talk)

- **DM narration**: [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) at
  `KOKORO_URL` (default `http://127.0.0.1:8880`) renders each DM message to speech on
  the media queue, with a per-campaign voice and per-user mute / volume / replay.
- **Push-to-talk**: a faster-whisper server at `STT_URL` (default
  `http://127.0.0.1:8870`, model `STT_MODEL`) transcribes your voice with a
  confirm-then-send step.

## Configuration and settings precedence

Most things are configurable in the app itself. When the same setting exists in
several places, the order is:

1. **Campaign settings** (in-game Text Model / image panels), which always win
2. **Admin panel** (`/admin`, stored in the database)
3. **Environment variables** (`.env.server`, see
   [docs/configuration.md](docs/configuration.md))
4. Built-in defaults

Secrets (API keys, `DB_ENCRYPTION_KEY`, Discord credentials) belong in `.env.server`
or the admin panel, never in code or `.env.local`.

## Admin panel

Log in as an admin and open `/admin` (linked from the account menu):

- **Server settings**: default text model backend / URL / API key, ComfyUI and
  image-worker URLs and checkpoint, TTS / STT URLs, Discord sign-in credentials, and
  the sign-up toggle (close registration once your party is in).
- **Users**: list everyone, promote / demote admins, delete accounts, and reset
  passwords; a temporary password is shown once, and the user must set a new one at
  their next login.

## Discord sign-in (optional)

1. Create an application at <https://discord.com/developers/applications>.
2. Under OAuth2, add the redirect URI `<public-url>/api/auth/discord/callback` using
   the exact URL players reach the app on: `http://<lan-host>:3005/...` on a LAN, or
   `https://your.domain/...` behind a reverse proxy.
3. Put the Client ID and Client Secret in the admin panel (or `DISCORD_CLIENT_ID` /
   `DISCORD_CLIENT_SECRET` in `.env.server`).
4. Behind a reverse proxy: set the **Public URL** in the admin panel's Server section
   (or `APP_PUBLIC_URL` in `.env.server`) to the address players use, e.g.
   `https://your.domain`.

The "Sign in with Discord" button appears automatically once both are set. Existing
users can link Discord to their account from Settings.

## Storage and the single-writer rule

All state lives in a local SQLite database at `data/local-roleplay.sqlite` (override
with `SQLITE_DB_PATH`), encrypted at rest with the `DB_ENCRYPTION_KEY` from
`.env.server`; losing the key means losing the data. The read-only Open5e content
pack (`data/content/open5e.sqlite`) stays unencrypted. The database driver is
synchronous and the app assumes **one Next.js process owns the database file**. Do
not run `npm run dev` and a production service against the same `data/` directory;
point dev at a scratch database with `SQLITE_DB_PATH`.

## Credits and licenses

- Forked from [Open Dungeon](https://github.com/newideas99/open-dungeon) by Jacob
  Ferrari, MIT licensed. See [LICENSE](LICENSE).
- Game rules data derives from the System Reference Document 5.1 by Wizards of the
  Coast LLC, licensed under CC-BY-4.0. See [docs/LICENSES.md](docs/LICENSES.md).
- Expanded options (the widely played subclasses, spells, feats and lineages that no
  open dataset carries) are original content: the mechanics are stated in our own
  wording, and no publisher's descriptive text is reproduced.

<sub>Dungeons &amp; Dragons and D&amp;D are trademarks of Wizards of the Coast LLC. This
project is not affiliated with, endorsed, or sponsored by Wizards of the Coast.</sub>
