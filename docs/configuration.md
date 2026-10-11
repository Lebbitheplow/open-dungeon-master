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
| `TTS_PROVIDER` | `kokoro` | Kind of narration server: `kokoro`, `openai` (any server with OpenAI's `/v1/audio/speech`), or `off`. Also set in Admin > Speech, which wins |
| `TTS_BASE_URL` | `https://api.openai.com/v1` | Address of the `openai` kind of narration server |
| `TTS_MODEL` | `kokoro`, or `gpt-4o-mini-tts` on OpenAI | Model name sent with each narration request |
| `TTS_API_KEY` | — | Bearer key for the narration server. Blank on OpenAI itself falls back to the key saved for pictures |
| `TTS_VOICE` | `af_heart`, or `alloy` on OpenAI | Voice used when a campaign names one the server does not have |
| `TTS_CONCURRENCY` | `2` | Speech requests sent to the narration server at once, across every table (1 to 8). A passage with character voices is several short requests; two at a time was the fastest on a CPU Kokoro, a hosted API can take more |
| `ODM_UPDATE_CHECK` | on | `off` stops the server asking GitHub whether a newer release exists (one anonymous request every six hours at most; the answer is shown in the account menu's About dialog) |
| `DM_DEBUG` | — | `1` logs DM model content and tool calls |
| `DM_LEAN_TOOLS` | — | `1` removes the stat-mutation tools if the model's tool fidelity suffers |
| `DM_COMPACT_THRESHOLD` | `120` | Messages before history compaction begins (lower to test) |
| `DM_CHAPTER_MIN` | `16` | Non-system messages (players included) a chapter must hold before beats can close it |
| `DM_CHAPTER_BEATS` | `2` | Finished story-arc beats that close a chapter once it is past the floor |
| `DM_BEAT_SPACING` | `8` | Messages that must separate two beats for both to count toward the chapter; closer ones are the same moment of play |
| `DM_BEAT_JUDGE_EVERY` | `6` | Messages between backstop checks that ask a small model whether the `[NOW]` beat happened |
| `DM_CHAPTER_MAX` | `120` | Hard cap: a chapter this long closes even with no finished beat |
| `DB_ENCRYPTION_KEY` | required | Encrypts `data/local-roleplay.sqlite` at rest (chacha20). Belongs in `.env.server` |
| `ODM_SETUP_CODE` | generated and printed in the server log | The one-time code that creating a fresh server's first (admin) account requires. Unset, the server mints one and prints it at every start until the first account exists. On a device world (`ODM_DEVICE_WORLD=1`) nothing is minted or printed: the app that hosts it sets this itself and sends it with the host's own account, and a device world started without it asks for no code |
| `DISCORD_CLIENT_ID` | — | Discord OAuth application id for "Sign in with Discord" (or set in `/admin`) |
| `DISCORD_CLIENT_SECRET` | — | Discord OAuth client secret. Belongs in `.env.server` (or set in `/admin`) |
| `APP_PUBLIC_URL` | forwarded headers / request origin | Public URL players use (e.g. `https://dungeon.example.org`); needed for OAuth redirect URIs when the reverse proxy doesn't send `X-Forwarded-Host`/`X-Forwarded-Proto` |
| `WORLD_REGISTRY_URL` | the built-in registry | https JSON index of downloadable campaign plugins, browsable under Admin, Campaign plugins (or set there). Set it to `off` to browse none. The packs any registry lists are third-party content this project neither ships nor vets, and nothing installs without an admin doing it. See [worlds.md](worlds.md) |
| `WORLD_PACKS_DIR` | `data/worlds` | Where installed campaign plugins are written. Gitignored, and not covered by the app's MIT license |
| `UPLOAD_DAILY_BYTES` | `524288000` (500 MB) | Bytes one account may add to `public/uploads` in a rolling 24 hours, across uploads, character imports and workshop imports. Admins have no budget. `0` turns it off |
| `UPLOAD_DAILY_FILES` | `200` | Files one account may add to `public/uploads` in the same window. `0` turns it off |
| `UPLOAD_MIN_FREE_BYTES` | `1073741824` (1 GB) | Free space the volume holding `public/uploads` must keep; uploads and imports that would go below it are refused for everyone. The desktop and Android apps set 256 MB for the worlds they host. `0` turns it off |

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
  narrator voice is picked in campaign settings, and so is a voice for any
  character, cast member or monster (Game settings > Voices), whose quoted
  lines are then read in it. Narration MP3s are written under
  `public/generated-audio/<campaignId>/`; a passage starts playing as soon
  as its first clip is rendered.

## Sharing a server with other people

A server one person runs for friends has two questions the admin panel answers under Accounts (issues #137 and #138):

- **Who may start campaigns and workshops.** "Everyone with an account" is how every server behaved before. "Administrators only" keeps the New campaign door for admins; everyone else joins by room code, and the import, clone and workshop routes refuse the same way. A campaign that cannot be started cannot spend anything, which is the plainest way to keep a paid key for the host's own tables.
- **Paid AI backends.** "Paid" means a text, picture or speech backend on a public host that takes this server's key (OpenAI, OpenRouter, a hosted vLLM) and the agent program, which runs on the admin's plan. "Only campaigns an administrator leads" refuses them, with a plain message at the table, for any campaign whose party lead is not an admin. A backend on this machine or the local network (loopback, 10/8, 172.16/12, 192.168/16, link-local, `.local` and `.lan` names, a bare hostname) is the host's own, keyed or not: llama-server behind a key, Ollama, ComfyUI, the FLUX workers, Kokoro and the local Whisper stay open to every table. A player who wants a paid model at their own table brings their own key in the client app, which is what the apps are for. The agent panel's own "only campaigns an administrator leads" says the same thing for the agent alone.

The **Usage** tab shows, per account and per campaign, what has been spent: text and agent tokens in and out, split into paid and local; pictures painted; speech characters rendered; dictation clips; agent turns; plus campaigns owned, led and joined, characters, DM turns, active days, last activity and the bytes on disk the campaign's or the account's own pictures take. Everything is counted from what each backend reports; no prompt, transcript or picture is kept for it, and an erased account's rows lose their name. Costs are not estimated, since they depend on the model: read the tokens and apply the prices of the backend you pay for. Streaming replies carry their counts only when the backend honours `stream_options.include_usage` (OpenAI, llama-server, vLLM, LM Studio and OpenRouter do); a backend that rejects the field is retried without it and its calls are counted with no tokens.

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
rather than a set of files. `src/lib/ambience/catalog.ts` names them; the
files live in `public/ambience/` and ship with the project: public-domain and
open-licensed recordings (CC0 and Public Domain Mark, and the attribution
licences CC BY, CC BY-SA and OpenGameArt's OGA-BY), each credited by title,
author, source and licence in `src/lib/ambience/sources.json`, in
`public/ambience/manifest.json` and on the `/licenses` page. Nothing has to be
installed. A cue may have several takes (`battle.mp3`, `battle-2.mp3`); the
player moves between them so a long fight is not one loop forever, and Next
in the sound panel skips ahead.

**The sound pack.** A release may also attach `ambience-pack.zip`, the same
library (or a newer one) as one file, for an install that wants to update
without pulling the repository. Install it from the admin panel (Sound
library: one button, with progress) or on the command line:

```bash
npm run fetch-ambience -- --pack              # this release's pack
npm run fetch-ambience -- --pack https://...  # another pack
```

**Fetch more.** The script that resolved the library can add takes or refill
a cue from the open sources, trying each in the order that suits the layer:

- OpenGameArt.org: game music, loops and effects under CC0, CC BY, CC BY-SA
  and OGA-BY, the licence stated on every page. Room tone, stings, loops.
- Kevin MacLeod's catalogue (incompetech.com), CC BY 4.0: every piece tagged
  by mood and filed under collections such as Tension, Mystery, Wonder,
  Horror and Celtic and Folk, which is where the music cues come from.
- Wikimedia Commons: public-domain field recordings and one-shots.
- Freesound: CC0 recordings, the one source that needs a key
  (`FREESOUND_API_KEY`, free from freesound.org/apiv2/apply).
- The Internet Archive: old public-domain recordings.

```bash
npm run fetch-ambience                       # fill every cue that has no file yet
npm run fetch-ambience -- --layer music --takes 2   # a second take of every mood
npm run fetch-ambience -- --dry-run          # resolve and report, download nothing
npm run fetch-ambience -- --cue tavern --skip 1     # try the next candidate
npm run fetch-ambience -- --public-domain-only      # CC0 and PD Mark alone
npm run fetch-ambience -- --manifest         # rebuild the manifest only
```

Where a file comes from, in order: your own pins (`data/ambience-sources.json`),
the lock (`data/ambience-lock.json`, what this install resolved before), the
shipped pins (`src/lib/ambience/sources.json`, the library the project
resolved and committed, so every install gets the same tracks), and only
then a search. The licence is read from each source's own record and never
guessed; anything the script cannot positively identify is refused, and
NonCommercial and NoDerivatives are refused under every setting. Every
candidate also passes a spoken-word gate (the archives are full of correctly
licensed audiobooks, pronunciation clips and articles read aloud, and Commons
files them under categories that say so), a relevance gate and a length gate
per layer (a bed or a music cue has to run at least half a minute, a sting at
most twenty seconds).

**Curating by hand.** Drop a file named after the cue into `public/ambience/`
(`tavern.mp3`, `cave.ogg`, or `tavern-2.mp3` for a second take; `.mp3`,
`.ogg`, `.opus`, `.m4a` and `.wav` all work) and rescan from the admin panel
or run `npm run fetch-ambience -- --manifest`. It is never overwritten, it is
credited as locally supplied, and it stays out of the pack: the licence is
then yours to stand behind. Or pin exact URLs in `data/ambience-sources.json`,
which win over everything:

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

**Making the pack.** `npm run pack-ambience` zips every public-domain or
attribution-licensed track on disk with its credits (`--all` takes every
file, `--include-generated` the takes below). `npm run fetch-ambience --
--export-sources` writes the resolved library to the shipped pins file.

**Optional: a music model.** `npm run generate-ambience` makes takes with an
ACE-Step 1.5 server (`ACESTEP_URL`, `http://127.0.0.1:8002` by default) from
the prompt each room and music cue carries. It is an experiment, not the
library: generated takes are credited as such, stay out of the pack unless
asked for, and are no substitute for a recording somebody made.

**At the table.** Ambience is a per-campaign setting (Setup → Ambience), on by
default. "Follows the scene" lets the engine pick a room from each new place
and switch to combat music when initiative starts. The speaker in the table
header opens the sound panel: what is playing and which take, a level each
for the room and the music (per listener, synced to the account like the
other audio preferences), Next, and, for whoever steers the story (the DM, or
the party lead at an AI table), the pickers for the room, the music and the
sounds with a hold per layer. The AI DM, the DM console and the panel all
reach the same two engine actions, `set_ambience` and `play_sting`. Sound
ducks automatically while narration is being read aloud, and a cue with no
file on the server is silence, named as such in the panel.

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

### Deleting an account

Anyone can delete their own account from account settings (and from the
desktop and Android apps, per server). The request signs the account out on
every device and stamps a due date; a background job erases the account once
the server's grace period has passed. The period is set in the admin panel
under Accounts (0 to 90 days, default 14; 0 erases immediately). Signing in
before the due date and choosing "Keep my account" calls the deletion off.
An admin can also call it off, or erase the account at once, from the Users
tab.

The purge removes the account row and everything that hangs off it: owned
campaigns and workshops, campaign seats and character sheets, library
characters and rulesets, homebrew, notes, private threads and whispers,
friendships, notifications, and the avatar and portrait files under
`public/uploads/` that nothing else points at. Messages the person wrote in
other people's campaigns stay in those transcripts with the author link cut,
and campaign tools they made in other people's campaigns (roll tables,
prepared encounters, scheduled sessions) pass to that campaign's owner.

### Backing up and moving to another server

Everything a table has made lives in two places, and a backup needs both:

- `data/local-roleplay.sqlite` (or `SQLITE_DB_PATH`): campaigns, messages,
  characters, NPCs, maps, workshops, accounts. It is encrypted, so keep the
  `DB_ENCRYPTION_KEY` from `.env.server` (or `data/.db-key` in Docker) with
  it; the file is unreadable without the key.
- `public/uploads/`: every picture the database points at, uploaded or
  painted. Rows store paths like `/uploads/<id>.png`, so a database restored
  without this folder shows empty portraits and blank map backdrops.

Stop the server, copy both (and `data/worlds` if world packs were installed),
start the new server with the same key, and the tables come back exactly as
they were. `public/generated*` holds scene art and narration caches that can
be copied too but are not required.

Players and DMs who do not run the server have per-item exports instead:

- A character exports as a `.odm-character.json` from its library page and
  imports on any server through the library's Import button; the portrait
  travels inside the file.
- A workshop exports as a `.odm-workshop.json` bundle from its Share panel
  and imports through the Workshop page's Import button, pictures included.
- A campaign's story exports as HTML, ODT or DOCX from the Story tab. That is
  a reading copy; play state (messages, sheets, floor, clock) has no file
  export and moves only with the database.
