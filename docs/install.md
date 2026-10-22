# Install and first run

Back to the [README](../README.md). Prefer containers? See
[Run with Docker](docker.md).

## Requirements

What each setup needs from the machine:

| Setup | Machine |
|---|---|
| A human DM, an API key or an agent program | Any machine that runs Node or Docker; 2 GB of memory is comfortable. No graphics card. |
| A local model, the minimum | 16 GB of graphics memory (a 16 GB card, or 24 GB of memory on a Mac) for gpt-oss-20b: 90 to 160 seconds a turn on an AMD BC-250 |
| A local model, recommended | About 28 GB for Qwen3.6-35B-A3B at Q4, 45 GB at Q8: a median of 90 seconds a turn on a Framework Desktop (Ryzen AI Max+ 395, 128 GB shared) |
| Local pictures (ComfyUI) | 8 GB of graphics memory or more for an SDXL-class model, on top of a local model's share ([image-generation.md](image-generation.md)) |

The app's own needs, the measured machines and what hosting a group takes are on
one page of the guide:
[System requirements](https://opendungeonmaster.com/guide/start/system-requirements/).
Software:

- **Node 22.18+, 24 or 26+** (npm). `npm install` pulls everything the app itself needs. Or
  **Docker**, if you would rather not install a toolchain at all: see
  [Run with Docker](docker.md).
- **A text model backend** (one of):
  - [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` at
    `http://127.0.0.1:8001`, the address the app looks at first. The recommended
    model is Qwen3.6-35B-A3B
    ([text-backends.md](text-backends.md#the-recommended-dm-model-qwen36-35b-on-llamacpp)),
    or gpt-oss-20b on a 16 GB card.
    A server that lists exactly one chat model runs it with no model chosen;
    with several, pick one in the guided setup. Or:
  - any other model server with tool calling (Ollama, LM Studio, vLLM, TabbyAPI,
    KoboldCpp: supported, with llama.cpp the one we recommend), or a remote API
    key like OpenAI or OpenRouter. Or:
  - a CLI agent already installed and signed in on the server's computer: Claude
    Code, Codex, opencode or Grok Build, running on the plan you already pay for.
    Pick it in **Admin > Agent program**. Works for a server started with npm or
    systemd, not inside the Docker image
    ([agent-harness.md](agent-harness.md)).

  A local model needs at least 16 GB of graphics memory (a 16 GB card, or 24 GB
  of memory on a Mac): gpt-oss-20b is the minimum, and the recommended
  Qwen3.6-35B-A3B needs about 28 GB at Q4
  ([text-backends.md](text-backends.md#hardware-for-a-local-model)). Below 16 GB
  is not supported. It needs a context window of at least 16K tokens to narrate and
  24K to run fights; 32K or more is recommended
  ([text-backends.md](text-backends.md#context-window)). Hosted models and
  agent programs have far more.
- **Optional services** (each feature simply stays off, or falls back to a
  placeholder, without it):
  - [ComfyUI](https://github.com/comfyanonymous/ComfyUI) at `:8188` for character
    portraits, inline scene art, and battle maps
    ([image-generation.md](image-generation.md))
  - [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) at `:8880` for DM
    voice narration
  - a faster-whisper server at `:8870` for push-to-talk
    ([configuration.md](configuration.md))

## Quick start

```bash
git clone --depth 1 -b stable https://github.com/Lebbitheplow/open-dungeon-master.git
cd open-dungeon-master
npm install
npm run setup        # database key, content pack, memory model, production build
npm run start:lan    # 0.0.0.0:3005 so your party can reach it on the LAN
```

`-b stable --depth 1` fetches only the latest stable release, and `git pull` keeps it on
the stable releases (see [Updating](#updating)). Leave out `-b stable` to follow `main`,
every commit as it lands, instead; the channels are in [releases.md](releases.md). To go
back to an earlier release, take a [backup](backup-restore.md) first, since an older
version re-derives every character sheet by its own rules when it starts. Then fetch the
release's tag with `git fetch --depth 1 origin tag vX.Y.Z`, run `git checkout vX.Y.Z`, and
install and build as for an update; `git checkout stable` returns to the latest stable
release. For the full history and every branch, run `git remote set-branches origin '*'`,
then `git fetch --unshallow`.

When it starts, the server prints a link with a one-time setup code. Open it in a
browser on the same computer, create the admin account, and the **guided setup**
takes it from there, one question at a time:

- **The storyteller.** It looks at what is already running on the computer
  (llama.cpp, Ollama, LM Studio, vLLM, KoboldCpp, TabbyAPI, Jan) and offers each
  server with the models it serves, the best fit the model catalog knows of
  preselected. When nothing answers, it gives the llama-server commands for
  this machine; an Ollama it finds is connected through Ollama's own API, so
  the app sets the model's window. Or paste an API key (OpenAI, OpenRouter, any OpenAI-compatible
  provider) and pick from the models it can reach. Or pick an agent program you
  already pay for (Claude Code, Codex, opencode, Grok Build): it shows whether each
  is installed and signed in, and the exact command to fix it when not. Or choose a
  person at the table. Each choice is tested the way a campaign uses it before you
  move on.
- **Pictures and voice.** ComfyUI, Kokoro and Whisper are found the same way, with
  ComfyUI's image models (measured on your hardware where it has been) and
  checkpoints, and Kokoro's voices, listed to pick from. One OpenAI key
  covers pictures, narration and dictation too.
- **Players.** The addresses to send your friends, and whether accounts take an
  invite code.
- **Your own agent.** Connect Claude Code, Codex or opencode to the server over
  MCP as you: it shows the one line for your program and lights up when the agent's
  first call arrives.

Everything it saves is an ordinary admin setting, so the admin panel shows what was
chosen; run it again any time from **Admin > Guided setup**. An admin whose server
has no working storyteller is offered it on the home screen too.

## Setup by hand

`npm run setup` is safe to run again: it keeps an existing key, content pack and
model, and it refuses to make a new key for a database that already exists (a new
key cannot open it). With `npm run setup -- --no-build` it skips the build, for
`npm run dev:lan` instead of `start:lan`. By hand, the same steps are:

```bash
# The database is encrypted at rest; generate a key once and keep it safe.
echo "DB_ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env.server

# Build the content pack: spells, feats, items, subclasses, monsters.
# Downloads from api.open5e.com once, then caches for offline re-runs.
node scripts/import-open5e.mjs

# Warm the local embedding model (MiniLM by default, ~86MB) into models/embeddings.
# Optional: the app auto-downloads it on first use, but this pulls it now
# so an offline machine has it ready.
npm run fetch-model

npm run build
```

The **embedding model** (used for semantic story recall and lore search) is no
longer bundled in the repo. transformers.js downloads it from HuggingFace into
`models/embeddings/` the first time the app needs it, so first use requires network;
`npm run fetch-model` fetches it ahead of time.

The default, `Xenova/all-MiniLM-L6-v2`, understands English only. For a table that
plays in another language (its Table language setting), set a multilingual model in `.env.server`:

```bash
EMBEDDING_MODEL=Xenova/multilingual-e5-small
EMBEDDING_DTYPE=q8
```

Only 384-dim models are supported; any other fails with an error naming it.
You can switch on an existing install: see
[Changing the embedding model](storage.md#changing-the-embedding-model).

Then start the DM model with llama.cpp's `llama-server`. See
[The recommended DM model](text-backends.md#the-recommended-dm-model-qwen36-35b-on-llamacpp)
for the exact command and settings.

**The first account registered becomes the server admin, and creating it takes a
one-time setup code.** While the server has no accounts it prints the code in its log
at every start, with a link that fills it in; open the link, or enter the code in the
sign-up form's **Setup code** field. This stops whoever reaches a fresh server first
from claiming it. To pick the code yourself (for scripted
installs), set `ODM_SETUP_CODE`. The first account cannot be made with Discord; create
it with a password and link Discord afterwards in settings. To promote someone on an
existing install: `node scripts/make-admin.mjs <username>`.

## Content pack

`node scripts/import-open5e.mjs` builds `data/content/open5e.sqlite`, the read-only
pack holding every spell, feat, item, subclass, lineage and monster the character
builder and the DM can reach. Raw API pages are cached under `data/content/raw/`, so
later runs need no network; `--refresh` re-downloads them, and `CONTENT_DB_PATH`
points the app at a pack somewhere else.

Run it before your first session. The app still boots without the pack, but it falls
back to the much smaller bundled SRD 5.1 data in `src/lib/srd/` and shows a hint to
run the import, so players will find most content missing. The pack is not committed:
it is third-party open-licensed content (OGL, ORC and CC-BY documents) rebuildable
from the script in one command. See [content.md](content.md) and
[LICENSES.md](LICENSES.md).

For real sessions run the production server, which `npm run setup` already built:

```bash
npm run start:lan   # 0.0.0.0:3005
```

## Updating

To update to a newer version, stop the server, then pull, install the new
dependencies (releases change them), build and start it again:

```bash
git pull
npm install
npm run build
npm run start:lan
```

On the `stable` branch, `git pull` moves only when a release is promoted to stable. A
copy cloned from `main` (every install before the stable branch existed) keeps getting
every commit; to move it onto the stable releases:

```bash
git remote set-branches --add origin stable
git fetch --depth 1 origin stable
git switch stable
```

The switch puts the latest stable release's files in place, which are usually older than
the `main` build that is running. Keep running that build, without `npm run build`, until
a `git pull` on `stable` brings a version newer than the one in the About dialog:
building the older files would be a downgrade, which an upgraded database refuses
([backup-restore.md](backup-restore.md#upgrading-and-going-back)).

## Tests

```bash
npm test            # every scripts/test-*.mjs, one at a time, failures listed at the end
npm run coverage    # the same, plus a code coverage report in coverage/index.html
npm run dead-code   # files, exports, locals and parameters nothing uses (a report, not a CI gate)
```

Each test script is a plain Node program, so `node scripts/test-<name>.mjs` runs one
on its own. Code coverage counts the `.ts` files under `src/`; `.tsx` is left out,
since the scripts render no UI. It shows which code ran, not what a test checked.
A script reports a failure by throwing or by calling `process.exit(1)`; setting
`process.exitCode` on its own is not seen by the runner.

The dead-code check follows imports from the entry points Next.js and the
test runner know, plus those listed in `knip.jsonc`: a file only the desktop
and Android apps import goes there, or the check reports it as unused.
