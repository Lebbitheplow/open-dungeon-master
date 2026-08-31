# Configuration

Copy `.env.example` to `.env.local` and adjust. Everything is optional; the
defaults run fully local.

Settings precedence, when the same knob exists in several places: campaign
settings (in-game panels) > admin panel (`/admin`, stored in the database) >
environment variables (below) > built-in defaults. A blank admin-panel field
falls through to the env var.

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local text server |
| `DEFAULT_TEXT_PROVIDER` | `local` | New-story default: `local` or `custom` |
| `OPENAI_COMPAT_BASE_URL` | — | New-story default URL for Connect a server |
| `OPENAI_COMPAT_MODEL` | — | New-story default model for Connect a server |
| `LOCAL_TEXT_MAX_TOKENS` | `4096` | Max tokens generated per local turn |
| `LOCAL_TEXT_CONTEXT` | model max | Cap on the local context window |
| `LOCAL_TEXT_TIMEOUT_MS` | `360000` | Local turn timeout (idle, resets per streamed chunk) |
| `ARC_TEXT_TIMEOUT_MS` | `480000` | Timeout for story-arc generation/refresh and chapter summaries (non-streaming, whole reply must finish in time) |
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
| `DB_ENCRYPTION_KEY` | required | Encrypts `data/local-roleplay.sqlite` at rest (chacha20). Belongs in `.env.server` |
| `DISCORD_CLIENT_ID` | — | Discord OAuth application id for "Sign in with Discord" (or set in `/admin`) |
| `DISCORD_CLIENT_SECRET` | — | Discord OAuth client secret. Belongs in `.env.server` (or set in `/admin`) |
| `APP_PUBLIC_URL` | forwarded headers / request origin | Public URL players use (e.g. `https://dungeon.example.org`); needed for OAuth redirect URIs when the reverse proxy doesn't send `X-Forwarded-Host`/`X-Forwarded-Proto` |
| `WORLD_REGISTRY_URL` | the built-in registry | https JSON index of downloadable campaign plugins, browsable under Admin, Campaign plugins (or set there). Set it to `off` to browse none. The packs any registry lists are third-party content this project neither ships nor vets, and nothing installs without an admin doing it. See [worlds.md](worlds.md) |
| `WORLD_PACKS_DIR` | `data/worlds` | Where installed campaign plugins are written. Gitignored, and not covered by the app's MIT license |

Secrets (model API keys) belong in `.env.server`, never in code or `.env.local`.

### In a container

Every default above points at `127.0.0.1`, which inside a container means the
container itself. `docker-compose.yml` therefore overrides the service URLs to
`host.docker.internal` (llama.cpp, Ollama, ComfyUI, Kokoro, STT) and sets
`CONTENT_DB_PATH=/app/content/open5e.sqlite`, since the baked content pack has
to live outside the `/app/data` volume. Set anything you want to change in a
`.env` file next to the compose file rather than in `.env.server`: the image has
no `.env.server`, and real environment variables take precedence over it anyway.

`DB_ENCRYPTION_KEY` is optional there. Left unset, the entrypoint generates one
into `/app/data/.db-key` on first boot and prints it once. See the Docker section
of the README.

### Database encryption

The app database is encrypted at rest with SQLite3 Multiple Ciphers. The
server refuses to start without `DB_ENCRYPTION_KEY` in `.env.server`.

- Fresh install: `openssl rand -hex 32` into `DB_ENCRYPTION_KEY`; the
  database is created encrypted on first run.
- Existing plaintext database: stop the server, set the key, then run
  `node scripts/migrate-encrypt-db.mjs` (it backs up to
  `*.pre-encryption.bak` first). Delete the backups once a play session
  has verified the migration.
- Losing the key means losing the data; back the key up with the database.
- The Open5e content pack (`data/content/open5e.sqlite`) is public SRD
  data and stays unencrypted. Files under `public/uploads` and
  `public/generated*` are also not covered.

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
npm run dev:lan    # development
npm run start:lan  # production build (run npm run build first)
```

For dev mode, add your phone-facing hostname/IP to `ALLOWED_DEV_ORIGINS` in
`.env.local` (comma-separated), then open `http://<your-machine>:3005` from
the phone. The image worker and Ollama can stay on `127.0.0.1` because
browser requests go through the Next.js server.

### Live voice chat

Players and the DM can talk at the table over WebRTC. The server runs its own
SFU (mediasoup) in-process, so there is no third-party service and no account.

Voice is **off by default**. Set `VOICE_ENABLED=1` to turn it on; it stays off
until you do, because it cannot work until two other things are also true.

**1. The app must be reached over HTTPS.** Browsers only allow microphone
access in a secure context, so a plain `http://<host>:3005` address blocks the
mic before any permission prompt appears. `localhost` counts as secure, so a
single-machine install needs nothing; everyone else needs a reverse proxy with
a certificate (this is the same rule that gates "Install app", above). Voice
chat and the push-to-talk speech-to-text button both depend on it.

**2. One extra port must be open, for UDP and TCP.** The audio itself is RTP
over DTLS-SRTP. It is not HTTP, so it **cannot go through a reverse proxy** and
does not want to: open the port on the firewall pointing straight at this host.
There is only one, not a port range, because all traffic for every table
multiplexes over a single socket.

| | Web port (3005) | Voice port (44444) |
| --- | --- | --- |
| Reverse proxy config | yes, 443 to 3005 | none, cannot be proxied |
| Firewall / router rule | yes | yes, UDP **and** TCP |
| TLS certificate | yes, on the proxy | no, DTLS handles its own encryption |

Media on an unproxied port is still encrypted. DTLS-SRTP performs its own
handshake, and the certificate fingerprints are exchanged over the signaling
channel, which is already inside the proxy's TLS.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VOICE_ENABLED` | `0` | Set to `1` to turn voice on |
| `VOICE_RTC_PORT` | `44444` | The media port. Open it for UDP and TCP |
| `VOICE_ANNOUNCED_IP` | empty | The address a player's browser can reach this host on |
| `VOICE_DOMAIN` | empty | Optional hostname to announce instead of the IP |
| `VOICE_LISTEN_IP` | `0.0.0.0` | Which local interface to bind. Rarely changed |

`VOICE_ANNOUNCED_IP` is the one that catches people out. It is what gets written
into the ICE candidates the browser dials, so it must be an address that
resolves to **this** machine from where the players are sitting:

- Single machine, localhost only: leave it empty.
- LAN: your LAN IP, e.g. `192.168.1.50`.
- Public: your public IP.
- Docker: **required**. Unset, the container announces its own `172.x` bridge
  address, calls negotiate, connect, and then stay silent.

`VOICE_DOMAIN` is optional and exists for owners who would rather hand out a
name than a bare address. Set it and it is announced instead of
`VOICE_ANNOUNCED_IP`; leave it empty and the IP is used, which works fine.

```bash
VOICE_ENABLED=1
VOICE_ANNOUNCED_IP=203.0.113.10   # used when VOICE_DOMAIN is empty
VOICE_DOMAIN=voice.example.com    # optional; wins when set
```

Whatever is announced has to resolve **directly to this host**. A hostname that
points somewhere else, or through something that does not carry UDP, produces
the silent-call failure described below.

#### Behind Cloudflare (or any proxying CDN)

If your site is proxied through Cloudflare (an orange-cloud record), do not
announce that domain. A proxied record resolves to Cloudflare, not to you, and
Cloudflare proxies HTTP on a fixed set of ports and discards everything else.
The symptom is specific and misleading: signaling succeeds over 443, the call
reports itself connected, and no audio arrives. (Cloudflare Spectrum can proxy
raw UDP, but only on Enterprise plans, and Cloudflare Tunnel does not carry
public UDP at all.)

Point voice straight at the origin instead, either way round:

- Leave `VOICE_DOMAIN` empty and set `VOICE_ANNOUNCED_IP` to the origin's own
  public IP. Simplest, and always correct.
- Or set `VOICE_DOMAIN=voice.example.com`, a separate DNS record marked **DNS
  only** (grey cloud) pointing at the origin. The site stays proxied on the
  apex domain and only voice resolves direct.

Be aware of the trade this makes. Anyone who joins a call can read the origin
address out of the ICE candidates (`chrome://webrtc-internals` shows them), so
if the Cloudflare proxy is there to keep your origin IP private, voice reveals
it. That is inherent to sending media from a browser to your server rather than
anything specific to this app.

#### Using voice at the table

Once it is on, a Voice panel appears in the campaign lobby (so the table can
talk while people are still building characters), and during play a headphones
button in the top bar opens the full voice menu; the call stays up whichever
panel is showing. Join and leave at any point; nothing about the call is
durable, and a server restart simply ends it.

Per-player controls live behind the gear icon and are saved in that browser:

- **Microphone** picks the input device. Switching is seamless mid-call.
- **Open mic / push to talk.** In push-to-talk, hold the on-screen button or
  the <kbd>`</kbd> key. The key is ignored while you are typing.

**Turn-taking** follows the floor the table already has (open, hold, spotlight,
initiative), so there is one idea of whose turn it is rather than two. Set it in
campaign settings under Voice:

| Setting | What happens |
| --- | --- |
| Turns: ignored | The floor does not affect microphones at all |
| Turns: shown | The panel says whose turn it is; nobody is muted (default) |
| Turns: enforced | Players off the floor are muted on the server |

The DM is never muted by any of these, and a player who cannot speak gets a
Raise hand button. A raised hand is only a request: it never moves the floor by
itself, so the DM grants it with the floor controls they already have, and the
hand lowers itself once granted.

**Who hears whom** is a list of rules, all off by default, all in campaign
settings:

| Rule | Effect |
| --- | --- |
| Proximity | Distance on the battle map decides who hears whom. No map, or outside combat, means everyone hears everyone |
| Range | How far a normal voice carries. 30 ft by default |
| Whisper/shout | Each player picks whisper (5 ft), normal, or shout (120 ft). The range is the speaker's |
| Walls muffle | A wall between two characters quietens rather than silences. Fog of war never affects audio |
| Downed go deaf | A character at 0 hit points stops hearing the table, but still hears the DM and is still heard |

The DM always hears everyone and is always heard, at any distance, through any
wall, in any side room.

**Side rooms.** The DM can open extra voice rooms and move people between them:
a private word with one player, splitting the party, or table talk while the DM
sets up. Everyone can see the room list and who is in each, because a side room
nobody can see reads as a bug rather than a secret, but only the DM moves
people. Closing a room returns its occupants to the table rather than hanging up
on them. Moves take effect immediately with no gap in audio.

#### When a network still cannot connect

The TCP fallback on the same port covers most networks that block outbound UDP.
Beyond that a TURN relay would be needed; the app does not ship one, and for a
home game it is rarely worth running. A player on such a network can still play
with text.

### Installing as an app

When the app is reached over HTTPS (for example through a reverse proxy),
the browser offers "Install app" / "Add to Home Screen" and it runs
standalone with its own icon. Plain `http://<host>:3005` cannot install:
browsers require a secure context for web-app installs.

## Ambience and music

The sound library is a set of CUES (a tavern, a cave, a battle, a thunderclap)
rather than a set of files. `src/lib/ambience/catalog.ts` names them; what is
actually on disk lives in `public/ambience/`, is never committed, and is
fetched on request:

```bash
npm run fetch-ambience              # fill every cue that has no file yet
npm run fetch-ambience -- --dry-run # resolve and report, download nothing
npm run fetch-ambience -- --cue tavern --skip 1   # try the next candidate
npm run fetch-ambience -- --manifest             # rebuild the manifest only
```

The script reads each archive's own licence metadata and refuses anything it
cannot positively identify. By default it accepts only public-domain
dedications (CC0 and the Public Domain Mark). `--allow-attribution` widens
that to CC BY and CC BY-SA, which you may use but must keep credited;
NonCommercial and NoDerivatives are refused either way, because whether your
install is a commercial or derivative use is not a question this script may
answer for you. Every accepted file's credit is written into
`public/ambience/manifest.json` and shown on the app's `/licenses` page.

Three sources are tried, in the order that suits the layer. Room tone and
one-shot sounds go to Wikimedia Commons first, music to the Internet Archive,
and both fall through to [Freesound](https://freesound.org/apiv2/apply), which
is much the best source for this material and the only one needing a key:

```bash
FREESOUND_API_KEY=... npm run fetch-ambience
```

**Curating by hand.** Freely licensed audio is thin in places, and a cue the
searches cannot fill is simply silent. Two ways to fill one yourself:

- Drop a file named after the cue into `public/ambience/` (`tavern.mp3`,
  `cave.ogg`; `.mp3`, `.ogg`, `.opus`, `.m4a` and `.wav` all work) and run
  `npm run fetch-ambience -- --manifest`. It is never overwritten, and it is
  credited as locally supplied: the licence is then yours to stand behind.
- Pin exact URLs in `data/ambience-sources.json`, which wins over any search:

  ```json
  {
    "tavern": {
      "url": "https://example.org/tavern-loop.mp3",
      "title": "Tavern room tone",
      "author": "Someone",
      "license": "CC0",
      "source": "https://example.org/tavern"
    }
  }
  ```

`data/ambience-lock.json` records what each cue resolved to, so a second
machine fetches the same files rather than whatever the search returns that
day. Both live under `data/` and are not committed.

**At the table.** Ambience is a per-campaign setting (Setup → Ambience), on by
default; a table with no files fetched hears nothing and the volume control
hides itself. "Follows the scene" lets the engine pick a bed from each new
place and switch to combat music when initiative starts. The AI DM and a human
DM both reach the same two engine actions, `set_ambience` and `play_sting`;
volume and mute are per listener, in their own browser, and ambience ducks
automatically while narration is being read aloud.

## Physical and Bluetooth dice

Nothing to configure server-side: dice sources are a per-player, per-browser
choice that appears once the campaign's dice policy allows real dice and the
player opts in (Party tab, next to the real-dice toggle).

For each die shape (d4 through d20, plus the d100) a player picks one of:

- **Typed**: roll a physical die and enter the number; the DM turn stays
  parked until the table's dice are in.
- **Server-rolled**: the server draws that die with a cryptographic RNG when
  the roll is submitted, so a request mixing your d20 with automatic damage
  dice goes in as one submission.
- **A Pixels die**: pair a [Pixels](https://gamewithpixels.com/) Bluetooth die
  and its landings fill the matching faces live, with a blink-to-identify
  button. A die that disconnects mid-session degrades to typed entry rather
  than blocking the roll.

Requirements and caveats:

- Web Bluetooth needs a Chromium-based browser (Chrome, Edge, Brave; Firefox
  and Safari do not ship it) and a secure context: HTTPS, or `localhost`.
  This is the same requirement voice chat and push-to-talk have.
- Choices live in the browser's local storage, per device. Switch phones and
  you set them again; they are not on the account.
- The d100 pairs no single Pixels die, so it stays typed or server-rolled.
- When every die in a request is covered by a Pixel or the server, the roll
  submits itself as the last die settles.

## Local data

Stories and messages are stored in SQLite at `data/local-roleplay.sqlite` by
default. Deleting a story removes its messages through SQLite cascade
deletes.

Uploaded images are stored under `public/uploads/`. Generated images are
stored under `public/generated/`, with temporary generation refs under
`public/generated/refs/`. The sidebar's Local Data clear button deletes all
local stories, messages, characters, uploaded photos, generated images, and
temporary refs, then vacuums the SQLite database.
