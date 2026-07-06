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
