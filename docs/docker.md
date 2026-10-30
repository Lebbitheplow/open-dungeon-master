# Run with Docker

Back to the [README](../README.md). Installing with npm instead? See
[Install and first run](install.md).

The image is the whole install: the built app, the Open5e content pack and the default
embedding model, so a fresh container needs no network and no setup steps. Only the AI
services (the storyteller's model, pictures, voice) stay outside it.

## Install in three steps

**1. Install Docker.** [Docker Desktop](https://docs.docker.com/get-started/get-docker/)
on Windows or a Mac, or Docker Engine on Linux
(`curl -fsSL https://get.docker.com | sh` on most distributions).

**2. Download the compose file into a folder of its own and start it:**

```bash
mkdir open-game-master && cd open-game-master
curl -O https://raw.githubusercontent.com/Lebbitheplow/open-game-master/stable/docker-compose.yml
docker compose up -d
```

On Windows, in PowerShell, type `curl.exe` instead of `curl`. Keep this folder: every
`docker compose` command below runs in it.

**3. Open the setup link.** The server prints it in its log:

```bash
docker compose logs
```

Look for the box that says **This server has no accounts yet** and open the link under
it (`http://localhost:3005/?setup=...`) in a browser on the same computer. Create your
account, which becomes the admin, and the **guided setup** takes it from there: it looks
for a model server, pictures and voice on this computer and walks through the rest one
question at a time.

That is the whole install. Two things are worth doing on the first day:

- **Back up the database key.** The first start made one, and the database is encrypted
  with it; there is no way back in without it. Copy it out of the container and keep it
  somewhere safe, away from this computer:

  ```bash
  docker compose cp open-dungeon-master:/app/data/.db-key ./db-key.txt
  ```

  (The service keeps its name from before the rename to Open Game Master, so older
  installs keep working.) To choose the key yourself instead, put
  `DB_ENCRYPTION_KEY=...` in a `.env` file in this folder before the first start; an
  explicit key always wins over the stored one. Never change the key of a database that
  has data in it.
- **Let the container reach your model server.** See the next section.

## Your AI services on the same computer

From inside the container, this computer is `host.docker.internal`, and the guided setup
looks there. A model server answers there for certain when it listens on every address
rather than only on `127.0.0.1` (on Linux it has to). That also opens it to your local
network, so keep the computer behind your router:

| Service | Listen on every address |
|---|---|
| llama.cpp | `llama-server --host 0.0.0.0 ...` |
| Ollama | set `OLLAMA_HOST=0.0.0.0` before it starts |
| LM Studio | turn on the server's **Serve on Local Network** setting |
| ComfyUI | `python main.py --listen 0.0.0.0` |

So llama.cpp on port 8001 becomes `http://host.docker.internal:8001/v1`. The guided
setup and the admin panel set every address; to set them before the first start
instead, copy [.env.docker.example](../.env.docker.example) to `.env` in this folder,
edit it, and run `docker compose up -d` again. No model is named by default: a server
that lists one model runs it, and one that lists several has its model picked in the
guided setup (or named as `OPENAI_COMPAT_MODEL` in `.env`).

On Linux you can share the host's network instead, which makes the plain `127.0.0.1`
addresses work exactly as in a host install (Compose v2.24 or newer, not on Docker
Desktop; the server then answers on 3005 whatever `ODM_PORT` says):

```bash
docker compose -f docker-compose.yml -f docker-compose.host-net.yml up -d
```

An agent program (Codex, Claude Code, opencode) can narrate from inside the container:
build with `AGENT_PROGRAMS=@openai/codex` in `.env` and sign in once through
`docker compose exec`. See [agent-harness.md](agent-harness.md).

## Everyday commands

| To | Run |
|---|---|
| See the log | `docker compose logs` (add `-f` to follow it) |
| Stop or start it | `docker compose stop` / `docker compose start` |
| Update to the newest release | `docker compose pull && docker compose up -d` |
| Use another port | `ODM_PORT=8080` in `.env`, then `docker compose up -d` |
| Check its health | `docker compose ps` (healthy once `/api/health` answers) |

Updates keep every campaign: the volumes carry over and the database is upgraded on
start. Take a backup first (the admin panel's Backups, or
[backup-restore.md](backup-restore.md)). Going back to an older image after a release
that changed the database's shape is refused by that image; it needs the backup taken
before the upgrade ([Upgrading and going back](backup-restore.md#upgrading-and-going-back)).

A container that never turns healthy says why in `docker compose logs`, most often a
missing or wrong database key.

## Versions and channels

The compose file pulls `lebbi/open-game-master:latest` from Docker Hub. Every GitHub
release, beta or stable, is published to Docker Hub and GHCR as linux/amd64:

```bash
docker pull lebbi/open-game-master:latest                 # Docker Hub
docker pull ghcr.io/lebbitheplow/open-game-master:latest  # GHCR
```

`:latest` (also `:stable`) follows the stable releases, `:0.29` stays on one stable line
and takes only its fixes, and `:beta` follows the nightly betas
([releases.md](releases.md)). Choose one with `ODM_IMAGE_TAG=beta` (or `0.29`) in `.env`,
or pin one version with `ODM_IMAGE_TAG=0.10.1`. On `:beta`, set `ODM_UPDATE_CHANNEL=beta`
too, so the About dialog compares against the betas. Set
`ODM_IMAGE=ghcr.io/lebbitheplow/open-game-master` in `.env` to pull from GHCR instead.
For a server people rely on, pin `ODM_IMAGE_TAG` and move it on purpose rather than
following `latest`.

Releases still go out under the image names from before the rename too
(`lebbi/open-dungeon-master` and `ghcr.io/lebbitheplow/open-dungeon-master`), so an
install set up with them keeps updating for now. To move one over, download the compose
file again (or change `ODM_IMAGE` in `.env`) and run `docker compose pull && docker
compose up -d`; the service and its volumes keep their names, so nothing else changes.

## Building the image yourself

An arm64 host, or anyone who would rather build than pull, builds from a clone:

```bash
git clone --depth 1 -b stable https://github.com/Lebbitheplow/open-game-master.git
cd open-game-master
docker compose up -d --build
```

The build fetches the content pack, so it needs the network; the running container never
does. Update a local build with `git pull` and `docker compose up -d --build`. The
published image carries only the default embedding model: with another
`EMBEDDING_MODEL`, each new container downloads it on first use, unless you build the
image yourself, which bakes the model set in `.env` into it.

## Data, backups and maintenance

Six named volumes hold everything worth keeping: `odm-data` (the encrypted database
and the generated key), `odm-uploads` (avatars and portraits), `odm-generated` (scene
art and maps), `odm-audio` (cached narration), `odm-speech` (the built-in speech
recognition model, once downloaded) and `odm-home` (an agent program's sign-in).
`docker compose down` leaves them alone; `docker compose down -v` destroys them, so
leave `-v` off. Backups and moving to another server:
[backup-restore.md](backup-restore.md).

The setup code is the one-time code that creating the first account needs; the link in
the log fills it in. It is printed at every start until that account exists. To choose
it yourself, for a scripted install, set `ODM_SETUP_CODE` in `.env`.

Maintenance scripts need the database key, so run them through the entrypoint, which
loads it:

```bash
docker compose exec open-dungeon-master ./scripts/docker-entrypoint.sh \
  node scripts/make-admin.mjs <username>
```

**Run exactly one container.** The app is a single synchronous SQLite writer with an
in-process event bus, so it cannot be replicated or pointed at a shared volume from two
hosts. See [Storage and the single-writer rule](storage.md).

## Publishing (maintainers)

[.github/workflows/docker-publish.yml](../.github/workflows/docker-publish.yml) builds and
pushes whenever a GitHub release is published. A release tagged `v0.10.1` publishes
`0.10.1`, `0.10` and, unless it is marked as a pre-release, `latest`. The workflow then
starts the pushed image and waits for `/api/health` before it counts as successful, and
it can be re-run by hand from the Actions tab.

**GHCR needs no setup** - it authenticates with the built-in `GITHUB_TOKEN`. A brand new
package is private, so make it public once (Packages > open-game-master > Package
settings > Change visibility) for other people to pull it. Each release is also pushed to
the names from before the rename (`LEGACY_GHCR_IMAGE` and `LEGACY_DOCKERHUB_IMAGE` in the
workflow); delete those two lines once the installs that use them have moved.

**Docker Hub is optional.** Set two repository secrets and it publishes there too;
without them the workflow succeeds and publishes to GHCR only.

- `DOCKERHUB_USERNAME` - your Docker ID, shown in the top-right menu on hub.docker.com.
  It is not necessarily your GitHub username, even if you sign in through GitHub.
- `DOCKERHUB_TOKEN` - Account settings > Personal access tokens, Read/Write scope.
  Signing in through GitHub OAuth does not change this; a token is still how CI
  authenticates.

To publish under a different Docker ID, change `DOCKERHUB_IMAGE` in the workflow and the
`image:` default in `docker-compose.yml` to match.
