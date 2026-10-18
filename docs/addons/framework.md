# Working on the addon framework

Addons are their authors' own projects in their own repositories; this
repository holds the framework they plug into, the reference addon, and the
audited downloader list (`addons/catalog.json`), never an addon's code.

This page is for developers changing the addon framework itself: adding an
extension point, a manifest field, a board view message, or reshaping how
addons are installed and run. Writing an addon needs none of this; start at
[authoring.md](authoring.md) instead. The other pages:

| Page | For |
|---|---|
| [../addons.md](../addons.md) | Whoever runs a server: installing, switching on, setup, troubleshooting |
| [authoring.md](authoring.md) | Addon authors: the package, the manifest, the program, setup, sampling |
| [extension-points.md](extension-points.md) | Addon authors: each contract, with examples |
| [guidelines.md](guidelines.md) | The downloader list: what is accepted, how an author submits, the audit checklist |
| this page | Framework developers: how it is built, the rules it keeps, how to change it |

- [The shape of it](#the-shape-of-it)
- [Map of the code](#map-of-the-code)
- [Rules every change keeps](#rules-every-change-keeps)
- [An addon's life, and its statuses](#an-addons-life-and-its-statuses)
- [Addons beside each other](#addons-beside-each-other)
- [Settings and setup](#settings-and-setup)
- [Making common changes](#making-common-changes)
- [Testing](#testing)
- [Platforms](#platforms)
- [Not built yet](#not-built-yet)
- [Submitting a framework change](#submitting-a-framework-change)

## The shape of it

An addon is a folder holding `addon.json` and a program. The server starts
the program as a child process when something needs it and speaks MCP
(JSON-RPC 2.0, one message per line) over its stdin and stdout. Each
extension point the manifest declares names one of the program's MCP tools.

```text
admin installs (the list or a GitHub link: the folder at a commit,
   fetched file by file; or a .zip for trying one)
   -> package on disk + state row        install.ts, store.ts
admin switches it on, fills settings
   -> setup runs (venv, downloads, tool) setup.ts
someone uses it (import, map, board view)
   -> a task: the tool is called          tasks.ts, runtime.ts
   -> the result is checked               contracts.ts
   -> the server writes it, its own way   run-importer.ts, run-map.ts
board views instead run in a sandboxed iframe on the table page and talk
over postMessage                          board-bridge.ts, AddonBoardView.tsx
```

The guiding rule is **addons propose, the server disposes**. Nothing an addon
returns reaches the database without passing the same checks the app's own
features use (the workshop bundle reader, the terrain alphabet, picture
sniffing), and nothing an addon does reaches a player except through those
writes and the board view's projection.

## Map of the code

Server (`src/lib/addons/`). Files marked *client-safe* import nothing with
I/O, so the browser, the tests and `scripts/check-addon.mjs` share them.

| File | What it owns |
|---|---|
| `manifest.ts` | The `addon.json` schema (client-safe): fields, permissions, settings and option fields, setup, conflicts, exclusive, `addonFit`, `ADDON_API_VERSION`. `docs/addons/addon.schema.json` is generated from it |
| `contracts.ts` | Each extension point's arguments and result schema (client-safe), `toolPayload`, `normalizeOptionValues` |
| `board-bridge.ts` | The board view contract (client-safe): the snapshot, the messages both ways, `BOARD_BRIDGE_VERSION` |
| `registry-index.ts` | The downloader list's entry schema (client-safe): source pinned by repository, folder and commit, content hash; `sourceFacts` |
| `catalog-entry.ts` | Building an entry from a manifest, keeping the list sorted, offline checks (client-safe); used by the tool, the tests and CI |
| `registry.ts` | Which list to read (the ODM repository's `main`, the bundled copy as a fallback), `fetchCapped` (https on every hop, capped), downloading an entry's commit |
| `github-link.ts`, `github.ts` | GitHub link parsing (pure), resolving a link to an exact commit, update checks (cached) |
| `repo-fetch.ts` | Fetching an addon's folder at a commit file by file (GitHub's tree listing and raw files, or a local clone for the tool), each file checked against git's blob hash, the folder's content hash |
| `archive.ts` | A .zip of an addon's folder an admin picked: reading and unpacking under the hostile-archive rules, `archiveContentHash` (the same hash `repo-fetch.ts` computes) |
| `unzip.ts` | Unpacking a setup download's zip from disk, entry by entry (ZIP64 too), with no size ceiling but the disk |
| `download.ts` | Streamed setup downloads, checked by size and SHA-256 |
| `install.ts` | Install, update, remove; the replace guard for a same-id addon from elsewhere |
| `store.ts` | The `addons` row in `app_settings`: per addon its source, origin, state, permissions, settings, setup version |
| `installed.ts` | Reads disk and state together into an `InstalledAddon` with a status; development folders; conflicts; `readyAddon` |
| `settings.ts` | Settings edits, effective values, required settings, which settings setup reads, which downloads apply |
| `setup.ts` | Setup runs (Python venv, downloads, the addon's own tool), `setupIfDue`, `settingsEdit` |
| `runtime.ts` | Starting and stopping programs, the environment they get, `callAddonTool`, probes, logs, idle stop |
| `mcp-client.ts` | The JSON-RPC client over stdio: requests, progress, cancellation, server-to-client requests |
| `sampling.ts` | Answering `sampling/createMessage` with the server's model, text and pictures |
| `requirements.ts` | Finding programs an addon needs (`requires`) and their versions |
| `resources.ts` | Turn-taking for shared resources (`exclusive`) across addons |
| `tasks.ts` | Runs: ownership, progress, cancellation, work folders, per-user and server limits |
| `uploads.ts` | Chunked uploads of a DM's file for an importer |
| `run-importer.ts`, `import-defaults.ts` | Workshop importer runs, `file:` picture references, the larger addon bundle cap |
| `run-map.ts` | Map generator runs into a library |
| `map-view.ts` | What a map keeps for its addon's board view (`addon_view_json`) |
| `view-data.ts` | The 256 KB cap on a board view's data and the refusal every door gives (`viewDataProblem`); imports nothing |
| `static-files.ts` | Serving an addon's `ui/` and asset library with the sandboxing headers |
| `offered.ts` | What ready addons contribute, for `GET /api/addons` |
| `admin-view.ts` | The admin panel's picture of addons and the catalog; `installedResponse` |
| `support.ts` | Where addons run at all (`ODM_ADDONS`, not on Android yet) |
| `paths.ts` | `ADDONS_DIR` layout and `resolveInside`, the one path check every file access goes through |
| `use-addons.ts`, `follow-task.ts`, `upload-client.ts` | Client hooks: the offered list, following a run, sending an upload |

Routes:

| Route | |
|---|---|
| `GET /api/addons` | What the ready addons offer (any signed-in user) |
| `/api/addons/[addonId]/ui/[...path]` | An addon's web files, sandboxed, public |
| `/api/addons/[addonId]/assets/[...path]` | Its asset library (`data/<id>/public`), sandboxed, public |
| `/api/addons/uploads`, `.../[uploadId]` | Chunked uploads for importers |
| `/api/addons/tasks`, `.../[taskId]` | Start a run (import, map), follow it, cancel it |
| `/api/admin/addons` | The panel: installed addons, the downloader list, install (from the list or a GitHub link), switches |
| `/api/admin/addons/upload` | Install from a .zip of an addon's folder (for trying one) |
| `/api/admin/addons/[addonId]` | One addon: settings, on and off, setup, update, test, remove |
| `/api/workshops/import` (`addonTask`) | Preview and import the bundle an importer made |

The app around it:

| Where | |
|---|---|
| `src/app/admin/AdminAddonsPanel.tsx`, `AdminAddonCard.tsx` | Admin > Addons |
| `src/components/addons/AddonFields.tsx` | Draws settings and option fields from a manifest |
| `src/app/workshop/AddonImportButton.tsx`, `BundlePreview.tsx` | Import with an addon |
| `src/app/workshop/maps/AddonMapGenerator.tsx` | Build a map with an addon |
| `src/app/campaigns/[campaignId]/AddonBoardView.tsx`, `AddonViewSwitch.tsx` | The board view frame, the View switch and view options |
| `BattleMapPanel.tsx`, `TokenHud.tsx`, `BoardChrome.tsx` | Wiring the frame into the board; anchors for the action ring and the plate |
| `src/lib/db/map-addon-view*.ts`, `addon_view_json` on `prepared_maps` and `battle_maps` | View data stored with maps, carried in bundles |
| `next.config.ts` | Leaves `ui/` and `assets/` out of the app's framing headers |

The downloader list: `addons/catalog.json` (the entries; the build imports it
as the offline fallback), `scripts/addon-catalog.mjs` (writes an entry from a
GitHub link, verifies entries, checks the file) and
`.github/workflows/addon-catalog.yml` (the pull request audit: derive, check,
start, summarize).

Scripts and fixtures: `scripts/test-addons-core.mjs`, `scripts/test-addons-runtime.mjs`,
`scripts/check-addon.mjs` (what the audit runs on each addon), `scripts/build-addon-schema.mjs`,
and `examples/addons/hello-dungeon` (the reference addon authors copy, which
the tests run; it is not on the list).
The desktop app's renderer allows the board view frame in its CSP (`frame-src`),
in the client repository.

## Rules every change keeps

These are the framework's security and correctness lines. A change that has
to bend one needs saying so in its pull request, plainly.

1. **Addons propose, the server disposes.** Every result is parsed by a
   contract in `contracts.ts` (or `board-bridge.ts`) and written by server
   code. An addon never gets a database handle, a route of its own that
   writes, or a session.
2. **No secrets in an addon's environment.** `runtime.ts` builds it from an
   allowlist (`buildChildEnv`) and refuses to start if anything looks like a
   server secret (`leaksServerSecret`). Settings reach it as
   `ODM_ADDON_SETTINGS`, only its own.
3. **Board views are sandboxed.** `sandbox="allow-scripts"` and nothing more,
   files served with `Content-Security-Policy: sandbox allow-scripts`. The
   snapshot is built from the projection the server made for that viewer, so
   it never holds what that player may not see. A frame's messages are read
   by `readViewMessage`, strictly, and taps go through the same handlers as
   the flat grid's.
4. **Paths stay inside their folders.** Every file an addon names is resolved
   with `resolveInside`; a fetched folder or a zip is refused for absolute
   paths, `..`, links and submodules; served files are held to a list of
   types.
5. **Installs are admin-only and checked.** An addon from the list is the
   audited commit, and its files must hash to the entry's `contentSha256`;
   anything not on the list sits behind "Install addons from files and
   links"; a same-id addon from a different source is never replaced without
   the admin's yes.
6. **Permissions that can be enforced are enforced.** `ai.text` is a door the
   server holds shut until accepted; an update that asks for more waits for a
   new yes.
7. **Addons cannot hurt each other.** Separate processes, folders, Python
   environments, settings, asset URLs; declared conflicts never run together;
   shared resources are taken in turn (see below).
8. **Nothing of an addon runs where it should not.** `addon-catalog.mjs`
   runs no addon code; `check-addon.mjs --run` starts an addon only in a
   throwaway world, in a pull request job with a read-only token.
9. **The rules engine stays the rules engine.** Terrain is the only thing the
   rules read of a map; a model or a picture is decoration. A board view
   changes how the board looks, never what a move does.

## An addon's life, and its statuses

`installed.ts` gives every addon one status, checked in this order (the
first that applies wins):

| Status | Meaning | Leaves it when |
|---|---|---|
| `missing-files` | State says installed, the package is not on disk | Reinstall |
| `broken` | `addon.json` does not read, or names another id | A fixed version |
| `unsupported` | Addons are off here (Android, `ODM_ADDONS=off`) | |
| `unfit` | Wrong contract version, platform or server version | |
| `disabled` | Switched off | The admin switches it on |
| `needs-approval` | Asks for permissions not yet accepted | The admin accepts |
| `needs-settings` | A `required` setting is empty | The admin fills it in |
| `needs-setup` | Its setup has not finished for these files | Setup finishes |
| `conflict` | A conflicting addon is also on | One is switched off |
| `ready` | It runs, and its contributions are offered | |

Only `ready` addons are offered or called; `readyAddon(id, { forSetup: true })`
also lets the setup tool run in `needs-setup`. The admin routes start setup on
their own when it becomes due (`setupIfDue`): after switching on, after an
install or update of a switched-on addon, and after the settings it waited for
are filled in.

## Addons beside each other

Isolation does most of the work, by construction:

| Shared thing | How it is kept apart |
|---|---|
| Process | One child process per addon; calls to one addon run one at a time |
| Files | `packages/<id>`, `data/<id>`, `work/<run>`; nothing outside them is written |
| Python | Each addon's own venv in `data/<id>/.venv` |
| Settings and secrets | Per addon, sent only to that addon |
| URLs | `/api/addons/<id>/ui/...` and `.../assets/...` |
| Contributions | Keyed by addon id and contribution id; two importers for `.pdf` are both offered, labelled by addon |
| Board views | One per device at a time (the View switch) |
| Map view data | A map carries one addon's view data; other views see `view: null` |

For what isolation cannot cover there are three mechanisms:

- **Declared conflicts** (`conflicts` in the manifest). Either side may say
  it. `PATCH /api/admin/addons/<id>` refuses to switch one on while the other
  is on; if both end up on anyway (an update that started declaring it, a
  restored backup), both show `conflict` and neither runs. The catalog shows
  the clash before install.
- **Shared resources** (`exclusive`, like `gpu` or `blender`). `resources.ts`
  keeps a first-come queue per name: a run waits until no other addon's run
  holds what it names, says "Waiting for X, which is using the gpu" on its
  progress line, and can be cancelled while it waits. The wait happens in
  `callAddonTool` before the program is even started, for any call that
  carries a `task`. Names are free text by convention: `gpu`, `blender`,
  `comfyui`. The server's own model and picture backends are not in the queue.
- **The replace guard** (`install.ts`). An install whose id is already
  installed from a different source (catalog, another repository or folder,
  a file) answers 409 with `replaces`, and only goes ahead with
  `replace: true`; the replacement starts switched off with its permissions
  to accept again, keeping settings and data.

## Settings and setup

- **Settings** are fields the admin fills in once (`settings` in the
  manifest). `required` holds the addon in `needs-settings`; `affectsSetup`
  (and any setting a download's `when` names) makes setup due again when it
  changes, through `settingsEdit` in `setup.ts`. Values are held to their
  fields by `cleanSettings`; secrets are never sent back to the browser.
- **Options** are fields asked each time a contribution runs (an importer's
  page range), or, for a board view, chosen per device and handed to the view
  in `snapshot.options`. The browser keeps a device's view options in local
  storage (`AddonViewSwitch.tsx`), because the sandboxed frame cannot.
- **Setup** (`setup` in the manifest) runs once per set of installed files:
  a Python venv from a requirements file, https downloads checked by size and
  SHA-256 (per platform, and per setting with `when`), then the addon's own
  setup tool. Its progress is a task the admin card follows. A download
  already present with the right checksum is not fetched again.

## Making common changes

**A new manifest field.** Add it to `manifest.ts` with a default so older
manifests still read; add any cross-field rule to `manifestProblems`; run
`node scripts/build-addon-schema.mjs` (the core test fails until the
generated schema matches); show it where it matters (`admin-view.ts`, the
card, `check-addon.mjs`); if the downloader should show it before install,
add it to `registry-index.ts` and `catalogEntry` in `catalog-entry.ts` (with
a default, so entries already on the list still read); document it in
[authoring.md](authoring.md); add
a case to `test-addons-core.mjs`.

**A change to a contract.** Additive changes (a new optional result field,
a new snapshot field, a new message a view may ignore) keep
`ADDON_API_VERSION` and `BOARD_BRIDGE_VERSION`. A change that breaks an
existing addon bumps `ADDON_API_VERSION`, adds the new number to
`SUPPORTED_ADDON_API_VERSIONS`, and keeps reading the old one for as long as
practical; say so in [extension-points.md](extension-points.md) and in the
release notes. Update the example addon to show the change.

**A new board view message.** Host to view: add it to `HostMessage` in
`board-bridge.ts` and send it from `AddonBoardView.tsx`. View to host: add it
to `ViewMessage`, read it strictly in `readViewMessage` (shape, sizes,
characters), and handle it in `AddonBoardView.tsx` as the equivalent action
on the flat board would be handled. Add a case to the "messages are read
strictly" test, a line to the message tables in
[extension-points.md](extension-points.md), and use it in
`examples/addons/hello-dungeon/ui/board.js`.

**A new extension point.** The biggest change; plan it in an issue first.

1. The manifest: a schema for the contribution, a key in `contributes`,
   `CONTRIBUTION_KINDS` and `CONTRIBUTION_LABELS`.
2. The contract: arguments and a result schema in `contracts.ts`.
3. The run: a `run-<point>.ts` that creates a task, calls the tool with
   `task` (so shared resources are honoured), checks the result, writes it.
4. The route: start it through `/api/addons/tasks` (add a `kind`), with the
   same authority checks the app's own feature uses.
5. The UI: where it is offered, from `offered.ts` and `use-addons.ts`, with
   options drawn by `AddonFields`.
6. Docs, the example addon, and tests (a contract case in core, a full run in
   runtime).

**A new permission.** Add it to `ADDON_PERMISSIONS` with `enforced` true only
if the server can actually hold the door shut, and hold it shut where the
capability is used (as `sampling.ts` does for `ai.text`).

**A new status.** Add it to `AddonStatus`, place it in the order in
`describe` (or in `markConflicts` if it depends on other addons), give it a
label and tone on `AdminAddonCard.tsx`, and decide whether `readyAddon`
should let any call through.

**A change to the list's format.** `registry-index.ts` reads it,
`catalog-entry.ts` writes it, and servers of every version read the same
file from `main`. Additive fields need defaults so older servers and entries
still read; a change that breaks older servers bumps `ADDON_REGISTRY_VERSION`
and needs a second file for them, so avoid it.

## Testing

| Command | What it covers |
|---|---|
| `npx vitest run scripts/test-addons-core.mjs` | Contracts without a database or a process: manifest rules, settings, catalog entries, GitHub links, the bridge, view data |
| `npx vitest run scripts/test-addons-runtime.mjs` | End to end with the example addon in a scratch world: install, setup, runs, GitHub install and update (GitHub stubbed by replacing `fetch`), conflicts, turn-taking, sampling, removal |
| `node scripts/check-addon.mjs <folder or zip> --run` | What the audit runs on each addon a pull request adds |
| `node scripts/addon-catalog.mjs check` | The list's shape, offline (the core test runs it too) |
| `npm test` | Everything, including guards that catch new model calls, raw string sorts and banned literals |

To try a change by hand: point `ODM_ADDON_DEV_DIRS` at an addon folder and
run the server. To try the downloader without GitHub, write a list from a
local clone (`node scripts/addon-catalog.mjs add <link> --local owner/repo=<clone> --catalog /tmp/list.json`),
serve it from any https host together with GitHub's two file endpoints for
the clone (`<api>/repos/<owner>/<repo>/git/trees/<commit>?recursive=1` from
`git ls-tree -r -l`, and `<raw>/<owner>/<repo>/<commit>/<path>` from
`git cat-file blob`), and point the server at them with `ADDON_REGISTRY_URL`,
`ADDON_GITHUB_API_BASE` and `ADDON_GITHUB_RAW_BASE` (use
`NODE_EXTRA_CA_CERTS` for a self-signed certificate).

When a change touches the board view, look at it on a real table: the frame,
the View switch and options, anchors under the plate and the action ring,
both themes, and the enlarged tabletop.

## Platforms

- **Linux, Windows, macOS servers:** everything. Windows uses `tar.exe` for
  `.tar.*` downloads and `Scripts\python.exe` in a venv; paths go through
  `path` and `resolveInside`, never string joins; platform checks go through
  `src/lib/host-platform.ts`.
- **The desktop app:** the server runs inside it, so addons work there.
  `node` addons run on Electron's own Node (`ELECTRON_RUN_AS_NODE`). Board
  views need the renderer's CSP to allow the frame; that lives in the client
  repository.
- **Android:** off (`support.ts`), and the admin tab is hidden.
- **Docker:** an addon can only start programs inside the container.

## Not built yet

Ideas that came up and were left for when an addon needs them:

- Settings per campaign or per table (all settings are server-wide today;
  board view options are per device).
- A shared download cache, so two addons fetching the same file keep one
  copy (each keeps its own today).
- More than one addon's view data on one map.
- The server's own GPU users (the storyteller model, picture generation) in
  the shared-resource queue.

An addon that needs one of these is a good reason to build it: open an issue
describing the addon and what it needs.

## Submitting a framework change

A pull request that changes the framework:

- [ ] Keeps every rule in [Rules every change keeps](#rules-every-change-keeps), or says which and why
- [ ] Adds defaults for new manifest and catalog fields, so existing addons and catalogs still read
- [ ] Regenerates `docs/addons/addon.schema.json` when the manifest changed
- [ ] Updates the contract docs ([authoring.md](authoring.md), [extension-points.md](extension-points.md)) and this page's maps
- [ ] Shows the change in `examples/addons/hello-dungeon` when authors would use it
- [ ] Adds cases to `test-addons-core.mjs` and, for anything that runs, `test-addons-runtime.mjs`
- [ ] Passes `npm test`, `npm run lint` and `npm run build`
- [ ] Keeps `addons/catalog.json` reading for servers already released (the list is shared by every version)
- [ ] Notes any change the desktop app needs, with a pull request there
