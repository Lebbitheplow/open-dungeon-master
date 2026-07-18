# Open Dungeon Master

Multiplayer Dungeons & Dragons 5e campaigns run by an AI Dungeon Master, fully
on your own machine. A fork of [Open Dungeon](https://github.com/newideas99/open-dungeon)
that adds campaigns, player accounts, structured 5e character sheets, a
server-side dice engine, and a rules-aware DM that requests rolls instead of
inventing outcomes.

## Features

- **Campaigns and lobbies**: create a campaign, share an invite code, ready up,
  and play with your party in real time (SSE-based live updates).
- **Player accounts**: username/password auth (no email needed), optional
  "Sign in with Discord", per-user password change, and admin password resets.
- **Admin panel** at `/admin`: server-wide model/image/voice settings, a
  sign-up on/off switch, and user management (promote, reset password, delete).
- **Private side chats**: whisper another player or open a group side chat
  during the session. Only the people in the chat can read it; the AI DM and
  the campaign transcript never see it.
- **Structured 5e character sheets**: race, class, background, abilities,
  saves, skills, HP, AC, spell slots, conditions, equipment. Derived stats are
  computed from SRD 5.1 data, never invented by the model.
- **Server-side dice**: every check, save, and attack is rolled by the backend.
  The DM asks for rolls through a `request_roll` tool call, the server rolls,
  and the model narrates the actual result.
- **AI Dungeon Master**: a guardrailed DM prompt built from authoritative game
  state (party sheets, scene, quest log, recent rolls, rolling story summary),
  with story chapters, campaign notes, maps, TTS narration, and push-to-talk.
- The original single-player narrator still works, unchanged, at `/solo`.

Later phases (combat engine, encounters, factions, economy, NPC memory) are
tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

- **Node 22+** — `npm install` pulls everything else the app itself needs.
- **A text model backend** (one of):
  - [Ollama](https://ollama.com) at `http://127.0.0.1:11434` running the
    `qwen3.6-dm` model — this is the default configuration; build the model
    with the included [Modelfile](models/qwen3.6-dm.Modelfile) (see below), or
  - any OpenAI-compatible server with tool calling: llama.cpp `llama-server`,
    LM Studio, vLLM, TabbyAPI, KoboldCpp, or a remote API like OpenRouter.
- **Optional services** (each feature simply stays off without it):
  - [ComfyUI](https://github.com/comfyanonymous/ComfyUI) at `:8188` for inline
    scene images and maps ([docs/image-generation.md](docs/image-generation.md))
  - [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) at `:8880` for
    DM voice narration
  - a faster-whisper server at `:8870` for push-to-talk
    ([docs/configuration.md](docs/configuration.md))

## Quick start

```bash
git clone <this repo> && cd open-dungeon-master
npm install

# The database is encrypted at rest; generate a key once and keep it safe.
echo "DB_ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env.server

npm run dev        # http://localhost:3000, or:
npm run dev:lan    # 0.0.0.0:3005 so your party can reach it on the LAN
```

**The first account registered becomes the server admin.** To promote someone
on an existing install: `node scripts/make-admin.mjs <username>`.

For real sessions build and run the production server:

```bash
npm run build
npm run start:lan   # 0.0.0.0:3005
```

## The default DM model (qwen3.6-dm)

The app defaults to Ollama's OpenAI-compatible endpoint
(`http://127.0.0.1:11434/v1`) with a custom model named `qwen3.6-dm`:
Qwen3.6-35B (MoE, q8_0) with a 64K context window and Qwen's recommended
samplers baked in. Ollama's out-of-the-box context is tiny and silently
truncates the DM prompt, which makes the model loop — the baked-in context is
what makes the difference. Build it:

```bash
ollama pull qwen3.6:35b-a3b-q8_0
ollama create qwen3.6-dm -f models/qwen3.6-dm.Modelfile
```

### The same model on other LLM software

The Modelfile only encodes settings, so the setup ports to any
OpenAI-compatible server. Equivalent llama.cpp `llama-server` run:

```bash
llama-server -m Qwen3.6-35B-A3B-Q8_0.gguf \
  -c 65536 --jinja \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.0 \
  --port 8001
```

Then point the app at `http://127.0.0.1:8001/v1` (admin panel, campaign Text
Model settings, or `OPENAI_COMPAT_BASE_URL`). `--jinja` enables tool calling,
which the dice engine requires. The key settings to replicate anywhere:
**context 65536, temperature 0.7, top-p 0.8, top-k 20, min-p 0**.

More backends and model guidance: [docs/text-backends.md](docs/text-backends.md).

## Configuration and settings precedence

Most things are configurable in the app itself. When the same setting exists
in several places, the order is:

1. **Campaign settings** (in-game Text Model / image panels) — always win
2. **Admin panel** (`/admin`, stored in the database)
3. **Environment variables** (`.env.server`, see
   [docs/configuration.md](docs/configuration.md))
4. Built-in defaults

Secrets (API keys, `DB_ENCRYPTION_KEY`, Discord credentials) belong in
`.env.server` or the admin panel, never in code or `.env.local`.

## Admin panel

Log in as an admin and open `/admin` (linked from the account menu):

- **Server settings**: default text model backend/URL/API key, ComfyUI / FLUX
  worker URLs and checkpoint, TTS/STT URLs, Discord sign-in credentials, and
  the sign-up toggle (close registration once your party is in).
- **Users**: list everyone, promote/demote admins, delete accounts, and reset
  passwords — a temporary password is shown once, and the user must set a new
  one at their next login.

## Discord sign-in (optional)

1. Create an application at <https://discord.com/developers/applications>.
2. Under OAuth2, add the redirect URI
   `<public-url>/api/auth/discord/callback` using the exact URL players
   reach the app on: `http://<lan-host>:3005/...` on a LAN, or
   `https://your.domain/...` behind a reverse proxy.
3. Put the Client ID and Client Secret in the admin panel (or
   `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` in `.env.server`).
4. Behind a reverse proxy: set the **Public URL** in the admin panel's Server
   section (or `APP_PUBLIC_URL` in `.env.server`) to the address players use,
   e.g. `https://your.domain`. Without it the app falls back to
   `X-Forwarded-Host`/`X-Forwarded-Proto` headers, then the raw request
   origin.

The "Sign in with Discord" button appears automatically once both are set.
Existing users can link Discord to their account from Settings.

## Storage and the single-writer rule

All state lives in a local SQLite database at `data/local-roleplay.sqlite`
(override with `SQLITE_DB_PATH`), encrypted at rest with the
`DB_ENCRYPTION_KEY` from `.env.server` — losing the key means losing the
data. The database driver is synchronous and the app assumes **one Next.js
process owns the database file**. Do not run `npm run dev` and a production
service against the same `data/` directory; point dev at a scratch database
with `SQLITE_DB_PATH`.

## Solo mode

The upstream single-player experience is preserved at `/solo`: Do / Say /
Story input, Continue, Retry, Erase, inline edit, long-story memory, and
inline scene images. Upstream guides still apply:
[text backends](docs/text-backends.md),
[image generation](docs/image-generation.md),
[configuration](docs/configuration.md).

## Credits and licenses

- Forked from [Open Dungeon](https://github.com/newideas99/open-dungeon) by
  Jacob Ferrari, MIT licensed. See [LICENSE](LICENSE).
- Game rules data derives from the System Reference Document 5.1 by Wizards of
  the Coast LLC, licensed under CC-BY-4.0. See [docs/LICENSES.md](docs/LICENSES.md).
