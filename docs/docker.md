# Run with Docker

Back to the [README](../README.md). Installing with npm instead? See
[Install and first run](install.md).

The image is the whole install. It carries the built app, the Open5e content pack and
the default embedding model, so a fresh container needs no network and no setup steps.
Only the AI services stay outside, on the host. The published image carries only the
default embedding model: with another `EMBEDDING_MODEL`, each new container downloads it
on first use (so it needs internet then), unless you build the image yourself with
`docker compose up -d --build`, which bakes the model set in `.env` into it.

Every GitHub release, beta or stable, is published to both registries as linux/amd64 (an
arm64 host builds its own image from a clone, below, and gets working embeddings the same
way):

```bash
docker pull lebbi/open-dungeon-master:latest                 # Docker Hub
docker pull ghcr.io/lebbitheplow/open-dungeon-master:latest  # GHCR
```

Grab the compose file and start it:

```bash
curl -O https://raw.githubusercontent.com/Lebbitheplow/open-dungeon-master/stable/docker-compose.yml
docker compose pull
docker compose up -d        # http://localhost:3005
```

`:latest` (also `:stable`) follows the stable releases, `:0.29` stays on one stable line
and takes only its fixes, and `:beta` follows the nightly betas
([releases.md](releases.md)). Choose one with `ODM_IMAGE_TAG=beta` (or `0.29`) in `.env`,
or pin one version with `ODM_IMAGE_TAG=0.10.1`. On `:beta`, set `ODM_UPDATE_CHANNEL=beta`
too, so the About dialog compares against the betas. The
compose file pulls from Docker Hub by default; set
`ODM_IMAGE=ghcr.io/lebbitheplow/open-dungeon-master` in `.env` to use GHCR instead. To
build the image yourself rather than pulling it, clone the repository (the first two
lines of the [Quick start](install.md#quick-start)) and run `docker compose up -d --build`
inside it.

Nothing else is required. On first boot the container generates a database encryption
key, stores it in the data volume, and prints it once:

```
docker compose logs | head -20
```

**Back that key up.** The database is encrypted at rest with it and there is no
recovery path without it. If you would rather manage it yourself, put
`DB_ENCRYPTION_KEY=...` in a `.env` file next to `docker-compose.yml` before the first
start; an explicit key always wins over the stored one.

The same log shows the one-time **setup code** that creating the first (admin) account
needs, and a link that fills it in, in a banner that repeats at every start until that
account exists:

```
docker compose logs | grep -A12 "no accounts yet"
```

Open the link and the guided setup follows the first account, as in the
[Quick start](install.md#quick-start). From inside the container it looks for your AI services on
the host as `host.docker.internal`, so a model server on the host must listen on
`0.0.0.0`, not only `127.0.0.1`.

## Pointing at your AI services

The container reaches the host through `host.docker.internal`, so llama.cpp on
`127.0.0.1:8001` becomes `http://host.docker.internal:8001/v1`. Every URL is
overridable in `.env`; copy [.env.docker.example](../.env.docker.example) for the full
list. No model is named by default: a server that lists one model runs it, and
one that lists several has its model picked in the guided setup or the admin
panel (or named as `OPENAI_COMPAT_MODEL` in `.env`).

```bash
cp .env.docker.example .env    # then edit, then: docker compose up -d
```

On Linux you can instead share the host network stack, which makes the plain
`127.0.0.1` defaults work exactly as they do in a host install:

```bash
docker compose -f docker-compose.yml -f docker-compose.host-net.yml up -d
```

## Data, backups and maintenance

Six named volumes hold everything worth keeping: `odm-data` (the encrypted database
and the generated key), `odm-uploads` (avatars and portraits), `odm-generated` (scene
art and maps), `odm-audio` (cached narration), `odm-speech` (the built-in speech
recognition model, once downloaded) and `odm-home` (an agent program's sign-in).
`docker compose down` leaves them alone; `docker compose down -v` destroys them.
Backups and moving to another server: [backup-restore.md](backup-restore.md).

An agent program (Codex, Claude Code, opencode) can narrate from inside the
container: build with `AGENT_PROGRAMS=@openai/codex` in `.env` and sign in once
through `docker compose exec`. See [agent-harness.md](agent-harness.md).

Maintenance scripts need the database key, so run them through the entrypoint, which
loads it:

```bash
docker compose exec open-dungeon-master ./scripts/docker-entrypoint.sh \
  node scripts/make-admin.mjs <username>
```

**Run exactly one container.** The app is a single synchronous SQLite writer with an
in-process event bus, so it cannot be replicated or pointed at a shared volume from two
hosts. See [Storage and the single-writer rule](storage.md).

To move to a newer release: `docker compose pull && docker compose up -d`. The volumes
carry over. Take a backup first (the admin panel's Backups, or
[backup-restore.md](backup-restore.md)), and for a server people rely on, pin
`ODM_IMAGE_TAG` and move it on purpose rather than following `latest`. Going back to
an older image after a release that changed the database's shape is refused by that
image; it needs the backup taken before the upgrade
([Upgrading and going back](backup-restore.md#upgrading-and-going-back)). Removing the
container never touches the volumes; `docker compose down -v` does, so leave `-v` off. If you build locally instead, `docker compose up -d --build` refreshes the
content pack from api.open5e.com, so the build needs network; the running container
never does.

A locally built image is updated from its clone: `git pull`, then
`docker compose up -d --build`.

## Publishing (maintainers)

[.github/workflows/docker-publish.yml](../.github/workflows/docker-publish.yml) builds and
pushes whenever a GitHub release is published. A release tagged `v0.10.1` publishes
`0.10.1`, `0.10` and, unless it is marked as a pre-release, `latest`. The workflow then
starts the pushed image and waits for `/api/health` before it counts as successful, and
it can be re-run by hand from the Actions tab.

**GHCR needs no setup** - it authenticates with the built-in `GITHUB_TOKEN`. A brand new
package is private, so make it public once (Packages > open-dungeon-master > Package
settings > Change visibility) for other people to pull it.

**Docker Hub is optional.** Set two repository secrets and it publishes there too;
without them the workflow succeeds and publishes to GHCR only.

- `DOCKERHUB_USERNAME` - your Docker ID, shown in the top-right menu on hub.docker.com.
  It is not necessarily your GitHub username, even if you sign in through GitHub.
- `DOCKERHUB_TOKEN` - Account settings > Personal access tokens, Read/Write scope.
  Signing in through GitHub OAuth does not change this; a token is still how CI
  authenticates.

To publish under a different Docker ID, change `DOCKERHUB_IMAGE` in the workflow and the
`image:` default in `docker-compose.yml` to match.
