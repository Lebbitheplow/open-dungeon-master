# Configuration

Copy `.env.example` to `.env.local` and adjust. Everything is optional; the
defaults run fully local.

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local text server |
| `DEFAULT_TEXT_PROVIDER` | `local` | New-story default: `local` or `custom` |
| `OPENAI_COMPAT_BASE_URL` | — | New-story default URL for Connect a server |
| `OPENAI_COMPAT_MODEL` | — | New-story default model for Connect a server |
| `LOCAL_TEXT_MAX_TOKENS` | `4096` | Max tokens generated per local turn |
| `LOCAL_TEXT_CONTEXT` | model max | Cap on the local context window |
| `LOCAL_TEXT_TIMEOUT_MS` | `360000` | Local turn timeout (idle, resets per streamed chunk) |
| `OPENROUTER_API_KEY` | — | Fallback key for OpenRouter URLs (else set in-app) |
| `OPENAI_COMPAT_API_KEY` | — | Fallback key for other connected servers |
| `FLUX_WORKER_URL` | `http://127.0.0.1:7869` | Image worker |
| `COMFYUI_URL` | `http://127.0.0.1:8188` | Default ComfyUI server for the ComfyUI backend |
| `ULTRA_FAST_IMAGE_GEN_DIR` | `~/ultra-fast-image-gen` | FLUX backends repo |
| `ULTRA_FAST_IMAGE_GEN_PYTHON` | platform venv Python | Python inside the image backend venv |
| `IMAGE_SERVER_DEVICE` | `mps` on macOS, `cuda` elsewhere | `mps`, `cuda`, `cpu`, or `auto` for SDNQ |
| `IMAGE_SERVER_DEFAULT_BACKEND` | `mflux-hs` on macOS, `sdnq-hs` elsewhere | Default image worker backend |
| `OPEN_DUNGEON_ROCM` | auto-detect | `0` disables / `1` forces the AMD ROCm path on Windows |
| `SQLITE_DB_PATH` | `data/local-roleplay.sqlite` | Database location |

## Multiplayer (Open Dungeon Master) variables

| Variable | Default | Purpose |
|---|---|---|
| `CONTENT_DB_PATH` | `data/content/open5e.sqlite` | Open5e content pack (built by `node scripts/import-open5e.mjs`) |
| `STT_URL` | `http://127.0.0.1:8870` | Push-to-talk transcription service (odm-stt.service) |
| `STT_MODEL` | `distil-large-v3` | faster-whisper model the STT proxy requests |
| `KOKORO_URL` | `http://127.0.0.1:8880` | Kokoro-FastAPI TTS service for DM narration |
| `DM_DEBUG` | — | `1` logs DM model content and tool calls |
| `DM_LEAN_TOOLS` | — | `1` removes the stat-mutation tools if the model's tool fidelity suffers |
| `DM_COMPACT_THRESHOLD` | `120` | Messages before history compaction begins (lower to test) |

Secrets (model API keys) belong in `.env.server`, never in code or `.env.local`.

### Voice services on this machine

- STT: `~/.config/systemd/user/odm-stt.service` runs `~/odm-stt/server.py`
  (faster-whisper CPU int8) on 127.0.0.1:8870. Change the model with the
  `STT_MODEL` env in the unit (e.g. `small` for faster, lower-quality
  transcription).
- TTS: the existing Kokoro-FastAPI service on :8880; the campaign's
  narrator voice is picked in campaign settings. Narration MP3s are written
  under `public/generated-audio/<campaignId>/`.

## Playing from your phone

Run the app on all interfaces:

```bash
npm run dev:tailscale
```

Add your phone-facing hostname/IP to `ALLOWED_DEV_ORIGINS` in `.env.local`
(comma-separated), then open `http://<your-machine>:3002` from the phone on
the same tailnet. The image worker and Ollama can stay on `127.0.0.1` because
browser requests go through the Next.js server.

## Local data

Stories and messages are stored in SQLite at `data/local-roleplay.sqlite` by
default. Deleting a story removes its messages through SQLite cascade
deletes.

Uploaded images are stored under `public/uploads/`. Generated images are
stored under `public/generated/`, with temporary generation refs under
`public/generated/refs/`. The sidebar's Local Data clear button deletes all
local stories, messages, characters, uploaded photos, generated images, and
temporary refs, then vacuums the SQLite database.
