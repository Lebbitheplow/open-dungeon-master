# Releases and update channels

Back to the [README](../README.md).

Every build ships first as a **beta**. The betas that hold up are promoted to
**stable** unchanged: promotion clears the GitHub release's prerelease flag, so a
stable install runs the exact build the beta testers ran. The same rules cover this
server and the desktop and Android apps
([open-dungeon-master-client](https://github.com/Lebbitheplow/open-dungeon-master-client)).

## Channels

| Channel | What it is | How often |
|---|---|---|
| **Stable** | A beta that held up, promoted as it was | Every two to four weeks, or when ready |
| **Beta** | The nightly release, published as a GitHub prerelease | Most nights |
| **main** | Every commit as it lands | Constantly |

Stable is the default everywhere. What each kind of install follows:

| Install | Stable | Beta |
|---|---|---|
| Docker | `:latest` (or `:stable`); `:0.29` stays on the 0.29 line | `:beta` |
| From source | `git clone -b stable`, then `git pull` | `git checkout vX.Y.Z` for a beta, or `main` for every commit |
| Server's About dialog | the default | `ODM_UPDATE_CHANNEL=beta` ([configuration.md](configuration.md)) |
| Desktop app | the default | App settings > This app > Beta updates |
| Android app | Google Play | the APK on a beta's GitHub release |

Leaving the beta channel never downgrades anything: a beta is newer than the stable
release, so the install stays on its beta until a stable release passes it. Going
back to an older version means restoring the backup taken before the upgrade
([backup-restore.md](backup-restore.md#upgrading-and-going-back)).

## Version numbers

Every version is a plain `x.y.z`, with no `-beta` suffix, so installers, package
managers, app stores and the Android version code all order them the usual way.
Whether a release is a beta or stable is the GitHub release's prerelease flag.

- Each nightly beta bumps the patch: 0.29.0, 0.29.1, 0.29.2.
- Promotion changes no number. 0.29.4 the beta is 0.29.4 the stable release.
- The first beta after a promotion bumps the minor: 0.29.4 goes stable, the next
  night is 0.30.0. A line with a stable release gets no more betas, which keeps its
  patch numbers free for fixes.
- A fix to the stable line takes the line's next free patch number: 0.29.7 when the
  betas used up to 0.29.6.

## Cutting releases

### A nightly beta

Server: commit, bump, tag, build and push as before, then publish it as a
prerelease with the usual assets:

```bash
gh release create v0.29.5 --prerelease --title "v0.29.5 - <title>" --notes-file notes.md \
  /tmp/open5e.sqlite.gz ambience-pack.zip
```

Never `--latest` on a beta. Docker then builds `:0.29.5` and moves `:beta`.

Client: bump, tag and push as before. The release workflow publishes every tag as a
prerelease, bundling the newest server release, so cut the server beta first.

### Promoting to stable

Promote a beta when all of these hold:

- it has been out a few days and played on, not just started;
- nothing on the `stabilization` milestone is a regression it carries;
- Linux and Windows smoke passed on its commit, and the apps were seen running on it;
- a copy of a real database upgraded cleanly from the current stable release to it,
  since stable installs jump across every beta in between at once (the client release
  workflow already does this for the Windows app, installing each beta over the latest
  stable one).

Then clear the flag on the server release and on the client release that bundles it
(the client release names its server):

```bash
gh release edit v0.29.4 --prerelease=false --latest
gh release edit v0.20.3 --prerelease=false --latest --repo Lebbitheplow/open-dungeon-master-client
```

On Google Play, upload that client release's `.aab` to production (or promote it
there from a testing track). The rest follows on its own:

- Docker tags the beta's existing image `:latest`, `:stable` and `:0.29`, with no
  rebuild ([docker-publish.yml](../.github/workflows/docker-publish.yml));
- the `stable` branch moves to the tag
  ([stable-branch.yml](../.github/workflows/stable-branch.yml));
- every server About dialog and desktop app on the stable channel now offers it.

The next nightly bumps the minor.

### A fix to the stable line

Only for data loss, a server that will not start, a session that cannot be played,
or a security problem. Anything else waits for the next promotion.

The fix lands on `main` first. Then, from the stable tag:

```bash
git switch -c release/0.29 v0.29.4        # or the release/0.29 already there
git cherry-pick <the fix's commit on main>
npm version 0.29.7 --no-git-tag-version
git commit -am "Release 0.29.7: <title>"
git tag v0.29.7
git push origin release/0.29 v0.29.7
gh release create v0.29.7 --prerelease ...  # a beta first, like every build
# once its Docker image is up and checked:
gh release edit v0.29.7 --prerelease=false --latest
git switch main
git merge --no-ff -s ours release/0.29      # the fix is on main already; main keeps its version
git push origin main
```

The `-s ours` merge back into `main` keeps the `stable` branch a fast-forward when
the next promotion comes from `main`. A fix published as a beta on an older line
never takes `:beta` or reaches beta installs, which are already past it.

For the apps, the same branch steps in the client repository. A client tag that is
not on the client's `main` bundles the latest stable server, not the newest beta.

## Switching over

Until the first promotion, releases can go out the way they always have: the server with
`gh release create ... --latest`, and client tags published as the latest release (the
client repository's `PUBLISH_AS_BETA` variable unset). Every release is then stable, so
`:latest`, `:stable`, the `stable` branch and the apps follow each one, exactly as before,
and the desktop app's Beta updates switch and `ODM_UPDATE_CHANNEL` reach people ahead of
the first beta. The day the betas start:

```bash
gh variable set PUBLISH_AS_BETA --body true --repo Lebbitheplow/open-dungeon-master-client
```

and the server is published with `--prerelease` from then on. The release that is out at
that moment is the first stable one; the next nightly bumps the minor.

## What the automation does

| Event | Docker | `stable` branch |
|---|---|---|
| A beta is published | builds `:x.y.z`; moves `:beta` when it is the newest release | stays |
| A beta is promoted | tags its image `:latest`, `:stable` and `:x.y` | moves to the tag |
| A release is published straight as stable | builds it with all of those tags | moves to the tag |

A failed Docker run is retried with "Re-run jobs", which replays its release event.
