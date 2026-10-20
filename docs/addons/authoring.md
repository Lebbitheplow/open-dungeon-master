# Writing an addon

An addon is a folder holding an `addon.json` manifest and a program, kept in a
GitHub repository (on its own, or as one folder of a bigger one). A server
installs it straight from the repository: it fetches the folder's files at one
commit, one by one, checked against git's own hashes. Nothing is packed into
an archive and there is no size ceiling on the repository. The server starts
the program when something needs it, talks to it over
[MCP](https://modelcontextprotocol.io) on its stdin and stdout, and calls its
tools for the extension points the manifest declares. Any language works; any
MCP SDK works. What it needs beyond its own source (Python packages, a
portable Blender or other 3D tools, models, texture packs) its setup
downloads on the server, as large as they need to be.

The example addon, [`examples/addons/hello-dungeon`](../../examples/addons/hello-dungeon),
is the template: a workshop importer, a map generator with a picture and a
`.glb` model, and an isometric board view, in plain Node with no
dependencies. Copy it and change it.

- [The package](#the-package)
- [addon.json](#addonjson)
- [Setup](#setup)
- [The program](#the-program)
- [Settings and options](#settings-and-options)
- [Living beside other addons](#living-beside-other-addons)
- [Asking the storyteller (sampling)](#asking-the-storyteller-sampling)
- [Trying it on a server](#trying-it-on-a-server)
- [Packaging and versions](#packaging-and-versions)

The contracts (what each tool receives and must return):
[extension-points.md](extension-points.md). Getting your addon on the
downloader list, and what the audit checks: [guidelines.md](guidelines.md). Changing the framework itself (a new
extension point, a manifest field your addon needs):
[framework.md](framework.md).

## The package

```text
hello-dungeon/
  addon.json        the manifest (required, at the root)
  server/main.mjs   the program (runtime.entry)
  ui/board.html     a board view's page, and anything it loads (only ui/ is served)
  sample/...        anything else the program reads
```

Rules the installer enforces: plain files only (no links, no git submodules,
no Git LFS pointers), no absolute paths or `..`. Everything the manifest names
must be in the folder. Large binaries do not belong in the repository (GitHub
refuses files over 100 MB): put them in a release of your repository, or link
the program's own download, and let [Setup](#setup) fetch them. Of the package, only the `ui/` folder is ever served
to a browser; the other served folder is the asset library your setup fills
(`publicDir`, below).

## addon.json

The full schema is [addon.schema.json](addon.schema.json) (point your editor's
`$schema` at it for completion). `node scripts/check-addon.mjs <folder>` runs
every check the server does, including the ones a JSON Schema cannot express.

| Field | |
|---|---|
| `id` | Lowercase words joined by hyphens, 3 to 50 characters (`pdf-rulebook-reader`). It is the folder name and part of URLs, so it never changes |
| `name`, `description` | What the admin sees in the catalog and on the addon's card. Plain words: say what it does for a DM, not how |
| `version` | `1.2.0`. The catalog offers an update whenever its version differs from the installed one |
| `apiVersion` | The addon contract it was written against: `1`. A server refuses a contract it does not know rather than guess |
| `author`, `license`, `homepage` | `license` is the addon's own (an SPDX id such as `MIT`) |
| `minServerVersion` | Optional: the oldest server it works with |
| `platforms` | Optional: `["linux", "win32", "darwin"]` or fewer. Absent means everywhere |
| `runtime` | How it is started; see below |
| `requires` | Programs it needs on the computer, checked before it starts |
| `permissions` | `ai.text`, `network`, `programs`; see [addons.md](../addons.md#switching-an-addon-on) |
| `setup` | Optional: what it fetches and prepares on the server before it is used; see [Setup](#setup) |
| `conflicts` | Optional: addons it cannot run beside, each `{ "id", "reason" }`; see [Living beside other addons](#living-beside-other-addons) |
| `exclusive` | Optional: shared resources its runs take turns for, like `["gpu"]`; see [Living beside other addons](#living-beside-other-addons) |
| `settings` | Fields the admin fills in once |
| `contributes` | The extension points it adds to: `workshopImporters`, `mapGenerators`, `boardViews` |

An optional `boardViews[].sessionLayout: "stage"` selects the host's native
session-region layout when that viewer selects the view. It requires
`needsViewData: false` and handling the no-map `scene` message. See
[the session stage contract](extension-points.md#optional-session-stage-layout).

Stage views may also supply `sessionTheme: { "surface": "#17212b", "accent": "#7dd3fc" }`.
These are opaque six-digit hex colors, not CSS. Surface channels must each be
0–63 (a dark background for native light text). The accent colors decorative
borders, not text, health, errors or focus indicators. The optional theme applies
only to selected desktop stage views in night mode; omit it for native styling.

### runtime

```json
{ "kind": "node", "entry": "server/main.mjs", "args": [] }
{ "kind": "python", "entry": "server/main.py", "minVersion": "3.10" }
{ "kind": "executable", "executables": { "linux-x64": "bin/addon", "win32-x64": "bin/addon.exe", "darwin-arm64": "bin/addon-mac" } }
```

- **node** runs on the server's own Node, including the desktop app's (it
  needs nothing installed). Prefer it when you can. Node 22 is the floor.
- **python** runs on the Python found on the computer (`python3`, `python`,
  or the Windows `py` launcher), held to `minVersion`. List its packages in a
  requirements file and name it in `setup.python`: the setup makes a virtual
  environment in the data folder, installs them there, and the addon runs on
  that environment from then on.
- **executable** is a program you built for each platform, keyed
  `<platform>-<arch>`. A server with no key for itself refuses to install it.

### requires

```json
{
  "program": "blender",
  "aliases": ["blender-4.2"],
  "setting": "blenderPath",
  "versionArgs": ["--version"],
  "versionPattern": "Blender (\\d+\\.\\d+)",
  "minVersion": "4.2",
  "hint": "Install Blender 4.2 or later, or set its path in this addon's settings.",
  "url": "https://www.blender.org/download/"
}
```

The server looks for `program` (then each alias) on the PATH, the login
shell's PATH and the usual install folders, or uses the `path` setting named
by `setting` when the admin filled it in. It runs `versionArgs`, reads the
first group of `versionPattern`, and compares it with `minVersion`. The admin
sees the result on the addon's card.

## Setup

```json
"setup": {
  "python": { "requirements": "requirements.txt" },
  "downloads": [
    {
      "id": "blender",
      "url": "https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz",
      "sha256": "<the file's SHA-256, lowercase hex>",
      "bytes": 345678901,
      "platforms": ["linux-x64"],
      "unpack": "tar.xz",
      "to": "tools/blender"
    }
  ],
  "tool": "odm_setup",
  "diskMB": 1200
}
```

The setup runs once per installed version (and again whenever an install
brings different files), as a task the admin follows on the addon's card,
before the addon is offered anywhere. In order:

1. **python** (Python addons only): a virtual environment at
   `<data folder>/.venv`, then `pip install -r <requirements>`. Pin your
   versions.
2. **downloads**: each one fetched over https, refused unless its size and
   SHA-256 match, then unpacked (`none`, `zip`, `tar.gz`, `tar.xz`) to `to`, a
   path inside the data folder. `platforms` (`linux-x64`, `win32-x64`,
   `darwin-arm64`, ...) limits one to those computers, and `when` to a
   setting's value (`"when": { "setting": "quality", "equals": "high" }`, or
   a list of values), so the admin's choice decides what is fetched. A
   download already in place with the same checksum is not fetched again.
3. **tool**: your own setup step, a tool your program offers, called with
   `{ dataDir, publicDir, packageDir, host }`. Check a program, build a cache,
   fill the asset library. It may report progress and ask the storyteller like
   any call.

`diskMB` is what the card shows the admin before they install. A setup step
that fails stops the setup; the card shows your error, and **Run its setup
again** starts it over.

**Big programs and assets.** Setup is where a 3D addon gets its tools: a
portable Blender (a few hundred MB to download, over a GB unpacked), a model,
a texture library. Each download may be up to 20 GB; it is streamed to disk,
checked against its size and SHA-256, and unpacked from disk (zip, tar.gz or
tar.xz) without being held in memory, so size is a matter of the admin's disk
(say how much in `diskMB`). Host your own builds as release files of your
repository (GitHub allows 2 GB per file) or point at the program's own
download site; give each platform its own entry with `platforms`. If the
program may already be installed (Blender usually is, on a 3D artist's
machine), declare it in `requires` with a path setting and fall back to a
download only when the admin wants one.

**Settings a setup needs.** Mark a setting `"required": true` (an API key, the
folder of a model) and the addon waits in **Needs settings**, with the card
opening them, until it has a value; its setup starts once they are filled in.
Mark one `"affectsSetup": true` (a quality tier your setup tool reads) and
changing it makes the setup due again; a setting a download's `when` names
counts as this without saying so. Your setup tool reads the settings from
`ODM_ADDON_SETTINGS` like the rest of your program (the server restarts it
before setup).

**The asset library.** Anything written to `publicDir` (`<data folder>/public`)
is served at `/api/addons/<id>/assets/<name>`, which a board view reads as
`snapshot.assetsUrl + name`: models, sprite sheets, textures, tile sets. It is
served to anyone who can reach the server, like your `ui/` files, so nothing
private belongs there. Models are `.glb`; pictures PNG, JPEG, WebP, GIF or
SVG; also `.json`, `.ktx2`, `.wasm` and `.woff2`.

## The program

The program is an MCP server on stdio: one JSON-RPC message per line on stdout,
requests on stdin. **stdout is the protocol**: log to stderr, which the server
keeps as the addon's log (and shows the admin), or send
`notifications/message`.

What the server does, in order:

1. Starts the program with its working directory set to the package folder.
2. `initialize` (it offers the `sampling` capability only when `ai.text` was
   accepted), then `notifications/initialized`.
3. `tools/list`. Every `tool` the manifest names must be there.
4. `tools/call` for each run, with a `progressToken` in `_meta`.
5. Stops the program after ten minutes idle, when its settings change, before
   an update, and when the server stops.

Calls to one addon run one at a time, in order. A heavy addon (Blender, a PDF
pipeline) never competes with itself.

**Progress.** Send `notifications/progress` with the call's token as you work:
`{ progressToken, progress, total, message }`. The message is shown to the DM
("Reading page 112 of 320"). A call that reports nothing for five minutes is
cancelled, and no call runs longer than an hour.

**Cancellation.** When the DM presses Stop, the server sends
`notifications/cancelled` with the call's id. Stop work and return.

**Errors.** Return a result with `isError: true` and a text block saying what
went wrong in words a DM can act on ("No stat blocks were found on those
pages"). Throwing inside a tool is the same to the server; a crash shows the
end of your stderr instead.

**Results.** Return `structuredContent` (or a text block holding JSON when your
SDK cannot), shaped as the extension point's contract says. Large output goes
in files in the call's `outputDir`, named by plain file names in the result.

### The environment

The program starts with an environment built from an allowlist: the user's
home, locale, temp folders, proxy settings and PATH, and none of the server's
secrets. Added for the addon:

| Variable | |
|---|---|
| `ODM_ADDON_ID`, `ODM_ADDON_VERSION` | Its own id and version |
| `ODM_ADDON_DIR` | The package folder (read-only by convention; an update replaces it) |
| `ODM_ADDON_DATA_DIR` | A folder of its own that survives updates: caches, downloaded models, its virtual environment |
| `ODM_ADDON_PUBLIC_DIR` | Its asset library, inside the data folder, served to its board views |
| `VIRTUAL_ENV` | A Python addon's environment, once its setup made one (its `bin` or `Scripts` folder leads the PATH) |
| `ODM_ADDON_SETTINGS` | The admin's settings as JSON, defaults filled in, secrets included |
| `ODM_ADDON_API_VERSION`, `ODM_SERVER_VERSION` | The contract and the server it is running under |

## Settings and options

Both are lists of fields the app draws controls for, so an addon never ships UI
for configuration:

- **settings** (manifest top level) are filled in once by the admin on the
  addon's card and reach the program as `ODM_ADDON_SETTINGS`. Types: `text`,
  `textarea`, `number`, `boolean`, `select`, `path`, `secret` (stored, sent to
  the program, never shown again). `required` and `affectsSetup` tie them to
  setup ([Setup](#setup)).
- **options** (on a workshop importer or map generator) are asked each time it
  runs and arrive in the call as `options`. Types: `text`, `textarea`,
  `number`, `boolean`, `select`.
- **board view options** (on a board view) are chosen by each viewer for
  their own device (a pixel scale, a quality tier for a slower computer) and
  arrive in the snapshot as `options`; see
  [extension-points.md](extension-points.md#board-views).

```json
{ "key": "pages", "label": "Pages to read", "type": "text", "default": "", "help": "Blank reads the whole book; 12-40 reads those pages." }
{ "key": "detail", "label": "Detail", "type": "select", "default": "full", "choices": [{ "value": "full", "label": "Everything" }, { "value": "quick", "label": "Names and stats only" }] }
```

Values always arrive as the field promised: unknown keys are dropped, numbers
clamped to `min` and `max`, a select held to its choices, missing values
filled with the default.

## Living beside other addons

A server may run several addons at once: a 3D board, an isometric one, a PDF
importer, a map maker. Most of what could collide is kept apart for you:
your own process, your own package and data folders, your own Python
environment, your own settings, your own URLs, and contributions keyed by
your id (two importers that both read `.pdf` are both offered, labelled by
addon). Two things are yours to declare:

- **`conflicts`**: addons yours truly cannot run beside, and why
  (`{ "id": "other-3d-board", "reason": "Both take over the GPU for the whole session." }`).
  The server will not switch on one while the other is on, whichever of the
  two declares it, and the catalog shows it before install. Use it for real
  incompatibilities, not for overlap: two board views already never draw at
  once on a device.
- **`exclusive`**: shared resources only one addon should use at a time,
  like `["gpu"]` for a model on the graphics card or `["blender"]` for a
  Blender that should not run twice. Your runs wait their turn behind other
  addons' runs that name the same thing, with "Waiting for X, which is using
  the gpu" on the progress line. Use the common names (`gpu`, `blender`,
  `comfyui`) so addons by different authors line up.

And three habits keep you out of trouble: never bind a fixed network port
(use port 0 and let the system pick, or better, do the work over stdio);
write only to `outputDir`, your data folder and temp; and keep anything
another addon might also download in your own data folder rather than a
shared place.

## Asking the storyteller (sampling)

With the `ai.text` permission, an addon can ask the server's configured model
for text through MCP's `sampling/createMessage`, so it needs no API key of its
own and follows the admin's choice of model (a local one, usually). The PDF
importer is the case this exists for: read the page text yourself, then ask
the storyteller to turn a stat block's prose into fields.

```json
{
  "method": "sampling/createMessage",
  "params": {
    "systemPrompt": "Return the stat block as JSON with these keys: ...",
    "messages": [{ "role": "user", "content": { "type": "text", "text": "GOBLIN\nSmall humanoid..." } }],
    "maxTokens": 800,
    "temperature": 0.2
  }
}
```

A user message may also carry pictures, as MCP image blocks
(`{ "type": "image", "mimeType": "image/png", "data": "<base64>" }`): a scanned
page, a map to describe, a portrait. PNG, JPEG or WebP, up to 8 MB each and 8
per request; a request is one line of at most 32 MB, so send a few at a time.
A model that cannot see pictures is asked again with the text alone, so say in
the text what you want from the picture.

The answer is `{ role: "assistant", content: { type: "text", text }, model, stopReason }`.
Up to 200,000 characters of text per request (audio is refused by name); send
long work in pieces. Requests are answered only while one of
your calls is running, and each one is counted under Usage against the person
who started the run. Treat the reply as a draft: check it, and say in your
result's `notes` what you were unsure of.

## Trying it on a server

1. Run your own server from a checkout (`npm run dev`), or use any server you
   administer.
2. Point `ODM_ADDON_DEV_DIRS` at your addon's folder and restart. It appears
   under Admin > Addons as a development folder, read live from disk.
3. Switch it on, open **Settings and checks**, and press **Start it and list
   its tools**. The log shows what your program wrote to stderr.
4. Use it where it appears (the workshop shelf, the map library, the board's
   View switch).

`node scripts/check-addon.mjs <folder> --run` does steps 2 and 3 headless and
fails if a tool the manifest names (its setup tool included) is missing. It
does not run the setup; switch the addon on in a server to run that. The MCP Inspector
(`npx @modelcontextprotocol/inspector node server/main.mjs`) is handy for
calling your tools by hand with test arguments.

## Packaging and versions

An addon is installed from its GitHub repository at one commit: the server
fetches the addon's folder file by file, so the rest of a bigger repository is
never downloaded. On the downloader list, that commit is the one that was
audited; open a pull request to the Open Dungeon Master repository adding your
addon's entry ([guidelines.md](guidelines.md#submitting-an-addon)). An admin
can also paste a link to your repository (its newest release's tag, else its
default branch), a release, or a folder at a branch. For trying an addon on
your own server, a .zip of its folder installs too (or point
`ODM_ADDON_DEV_DIRS` at the folder).

Whatever is at the commit is what ships: no install scripts and no build step
run on a server. A Node addon commits its bundled entry file (esbuild works
well); a Python addon lists its packages for the setup; anything large comes
through setup downloads.

- Bump `version` for every release; servers offer updates by version.
- Keep `id` forever.
- An update replaces `ODM_ADDON_DIR` and keeps `ODM_ADDON_DATA_DIR`: anything
  you install or cache belongs in the data folder, keyed by your version if a
  new version needs it rebuilt.
- Asking for a new permission in an update sends the addon back to the admin
  for a yes. Ask only for what you use.
- `apiVersion` changes only when the server's contract changes; the server
  keeps reading older ones for as long as practical.
