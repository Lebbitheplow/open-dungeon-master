# Open Dungeon Master

Multiplayer Dungeons & Dragons 5e campaigns run by an AI Dungeon Master, fully
on your own machine. A fork of [Open Dungeon](https://github.com/newideas99/open-dungeon)
that adds campaigns, player accounts, structured 5e character sheets, a
server-side dice engine, and a rules-aware DM that requests rolls instead of
inventing outcomes.

## What the fork adds

- **Campaigns and lobbies**: create a campaign, share an invite code, ready up,
  and play with your party in real time (SSE-based live updates).
- **Player accounts**: lightweight username/password auth suitable for a LAN.
- **Structured 5e character sheets**: race, class, background, abilities,
  saves, skills, HP, AC, spell slots, conditions, equipment. Derived stats are
  computed from SRD 5.1 data, never invented by the model.
- **Server-side dice**: every check, save, and attack is rolled by the backend.
  The DM asks for rolls through a `request_roll` tool call, the server rolls,
  and the model narrates the actual result.
- **AI Dungeon Master**: a guardrailed DM prompt built from authoritative game
  state (party sheets, scene, quest log, recent rolls, rolling story summary).
- The original single-player narrator still works, unchanged, at `/solo`.

Later phases (combat engine, encounters, factions, economy, NPC memory) are
tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

- Node 22+
- A text model backend, either:
  - an OpenAI-compatible server (llama.cpp `llama-server`, LM Studio, vLLM);
    the default config expects `llama-server` at `http://127.0.0.1:8001/v1`
    with a Qwen3.6 class model and tool calling enabled (`--jinja`), or
  - [Ollama](https://ollama.com) at `http://127.0.0.1:11434`. Note: local
    Ollama models are noticeably less reliable at calling the dice tool; the
    OpenAI-compatible path is the recommended DM backend.
- Optional: [ComfyUI](https://github.com/comfyanonymous/ComfyUI) at
  `http://127.0.0.1:8188` for inline scene images.

## Quick start

```bash
npm install
npm run dev                   # or: npm run build && npm run start:lan (0.0.0.0:3006)
```

Backend configuration goes in a gitignored `.env.server` file in the project
root:

```
DEFAULT_TEXT_PROVIDER=custom
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8001/v1
OPENAI_COMPAT_MODEL=qwen3.6-27b
OPENAI_COMPAT_API_KEY=...   # never commit this file
```

## Storage and the single-writer rule

All state lives in a local SQLite database at `data/local-roleplay.sqlite`
(override with `SQLITE_DB_PATH`). The database driver is synchronous and the
app assumes **one Next.js process owns the database file**. Do not run `npm
run dev` and a production service against the same `data/` directory; point
dev at a scratch database with `SQLITE_DB_PATH`.

## Solo mode

The upstream single-player experience is preserved at `/solo`: Do / Say /
Story input, Continue, Retry, Erase, inline edit, long-story memory, and
inline scene images via ComfyUI. Upstream guides still apply:
[text backends](docs/text-backends.md),
[image generation](docs/image-generation.md),
[configuration](docs/configuration.md).

## Credits and licenses

- Forked from [Open Dungeon](https://github.com/newideas99/open-dungeon) by
  Jacob Ferrari, MIT licensed. See [LICENSE](LICENSE).
- Game rules data derives from the System Reference Document 5.1 by Wizards of
  the Coast LLC, licensed under CC-BY-4.0. See [docs/LICENSES.md](docs/LICENSES.md).
