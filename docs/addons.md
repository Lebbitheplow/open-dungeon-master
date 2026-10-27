# Addons

An addon is a program that runs beside the server and adds to what it can do:
reading a rulebook PDF into a workshop, building a battle map with 3D tools,
drawing the board another way. Addons reach the app only through the doors it
opens for them (the *extension points*), and everything an addon hands back is
checked by the same rules the app's own features use before it is written.

This page is for whoever runs a server. Writing an addon:
[addons/authoring.md](addons/authoring.md). The contracts in detail:
[addons/extension-points.md](addons/extension-points.md). What the downloader
list accepts and how an author submits an addon: [addons/guidelines.md](addons/guidelines.md).

Addons are their authors' own projects. Open Game Master provides the
framework they plug into and a list of addons that have been audited; it does
not write, ship or update any addon itself.

- [Where addons run](#where-addons-run)
- [Installing from the list](#installing-from-the-list)
- [Switching an addon on](#switching-an-addon-on)
- [Setup](#setup)
- [What addons add to the app](#what-addons-add-to-the-app)
- [Installing from a file or a GitHub link](#installing-from-a-file-or-a-github-link)
- [Settings and configuration](#settings-and-configuration)
- [What an addon can and cannot do](#what-an-addon-can-and-cannot-do)
- [Troubleshooting](#troubleshooting)

## Where addons run

| Where the server runs | Addons |
|---|---|
| A server you run (Linux, Windows, macOS) | Yes |
| The desktop app's own world | Yes. Addons live in the world's `data/addons`, which the app keeps across upgrades |
| Docker | Yes, with a caveat: an addon can only start programs inside the container. Node addons always work; one that needs Python or Blender needs an image that has them |
| The Android app's world | Not yet. The server there runs on the phone and says so under Admin > Addons |

Addons are a server feature. A player never installs anything: what an addon
makes (a workshop, a map and its picture) is ordinary content, and every
browser and app shows it. The controls addons add (Import with an addon, Build
a map with an addon, the board's View switch) appear in the browser and the
desktop app; the Android app does not offer them yet.

An operator can switch addons off entirely with `ODM_ADDONS=off`.

## Installing from the list

**Admin > Addons** lists what this server has and the addons on the
downloader list. The list is [`addons/catalog.json`](../addons/catalog.json)
in the Open Game Master repository, read from its `main` branch so a newly
audited addon shows up without waiting for a release (and from the copy this
version shipped with when GitHub cannot be reached; that copy is only the
list, never an addon's code). Each addon lives in its author's own GitHub
repository and got onto the list through a pull request that was audited
against [the guidelines](addons/guidelines.md). An entry pins the exact
commit that was audited and a hash of the addon's files at that commit:
**Install** downloads that commit from the author's repository, checks the
hash before unpacking anything, and installs nothing if it differs.

Each entry shows the addon's name, its creator, and the GitHub user it comes
from, linked to the exact source that was audited. It says what the addon
adds, which programs it needs installed (for example Blender), what
permissions it asks for, how much its setup downloads, and whether it runs on
this server. **Install** downloads and unpacks it; it stays **off** until you
switch it on. When the list has a newer version of an installed addon, its
card offers **Update**. An update keeps the addon's settings and its data
folder. New addons and new versions reach the list through pull requests that
are audited before they are merged.

## Switching an addon on

Switching an addon on is where you accept the permissions it asks for, all at
once:

| Permission | What it means | Enforced by the server |
|---|---|---|
| Use this server's storyteller model (`ai.text`) | The addon can ask the model you configured for text. Each request is counted under Usage like any other call | Yes: refused unless accepted |
| Reach the internet (`network`) | It downloads or calls web services on its own | No: a statement of what it does |
| Run other programs (`programs`) | It starts programs installed here, such as Blender or Python | No: a statement of what it does |
| Use several threads in its board view (`threads`) | Its board view may share memory between threads and use the precise timers that come with that, as threaded 3D engines need. While an addon that is on has it, the server's pages are cross-origin isolated | Yes: its view runs on one thread unless accepted. Firefox does not hold that line per addon: on a server where one addon has it, every board view there can share memory |

An update that asks for a permission you have not accepted switches the addon
to **Waiting for your yes** until you accept again.

An addon whose manifest says it cannot run beside another one (and why) will
not switch on while that one is on; its card names the other addon, and the
list says so before you install. Switch one of them off first. If two
such addons end up on together anyway (an update that started declaring it),
both show **Conflict** and neither runs until one is switched off.

Open **Settings and checks** on an addon's card to fill in its settings, see
whether the programs it needs were found (and the version each reported), read
its log, and start it once to see the tools it offers.

## Setup

An addon that needs more than its own files has a setup: a Python environment
with the packages it lists, downloads (models, a portable copy of a tool,
textures), and a step of its own (checking Blender, preparing its asset
library). The card lists what the setup does and how much disk it needs.

Some addons need settings before they can be set up (an API key, where a
model is). Those show **Needs settings**: switching one on opens its settings,
and its setup starts as soon as you save what it needs. A setting marked as
changing the setup (a quality tier that picks which model is downloaded)
runs the setup again when you change it.

Setup runs when you switch the addon on, and again after every install or
update that changes its files. The card shows how far it has got, and the
addon shows **Needs setup** and is not offered anywhere until it finishes.
**Run its setup again** repeats it (after you install a program it was
missing, say); a download already in place with the right checksum is not
fetched again. If it fails, the card says why and the log has the detail.

Everything a setup writes goes into the addon's data folder, which an update
keeps. Every download is https and is checked against the size and SHA-256
its manifest declares before it is used.

## What addons add to the app

| Extension point | Where it appears | What the addon does |
|---|---|---|
| Workshop importer | Workshop shelf and hub: **Import with an addon** | Reads a file you pick (a rulebook PDF, a stat block file) and returns a workshop bundle. You see the same preview a bundle file gets, untick what you do not want, and **Import** creates a new workshop |
| Map generator | Map library (workshop Maps, and the GM's map drawer): **Build a map with an addon** | Builds a battle map from a request (size, kind of place, light, a description in your words). It lands in the library as a prepared map, with a picture under the grid and, if the addon makes one, a 3D model for its board view |
| Board view | The board's **View** switch (with **Options** for that device, when the view has any) | Draws the board in a sandboxed frame instead of the grid (an isometric, pixel-art or 3D table): the map, the figures, spell areas, auras, labels and the enemies' intents, with attacks, spells and pings as they happen. Taps on squares and figures work as they do on the flat board, and the plates and action ring open on the figures it drew |

The rules engine stays in charge throughout. A map's walls, doors and water
are the terrain the server checked; a picture or a 3D model is how it looks. A
move made in a 3D view goes through the same checks as a click on the grid.
Fog applies too: a player's board view only ever receives what that player's
flat board would show.

## Installing from a file or a GitHub link

To try an addon before it is on the list, or to run your own, switch on
**Install addons from files and links** under **Addon list, files and links**.
Then paste a GitHub link and press **Install from GitHub**, or, for an addon
folder you have on hand, **Choose an addon .zip** of it (up to 64 MB; the
addon's big downloads come later, through its setup). Nobody has reviewed an
addon that arrives either way; its card says so.

Either way the server fetches the addon's folder at one commit, file by file,
checked against git's hashes: no archive, and nothing outside the folder. A
GitHub link may be:

| Link | What is installed | Updates |
|---|---|---|
| `owner/repo` or the repository's page | Its newest release (the commit its tag names); with no releases, its default branch | A newer release |
| A release page (`.../releases/tag/v1.2.0`) | That release | A newer release |
| A folder at a branch (`.../tree/main/addons/my-addon`) | That folder at the branch's newest commit, for a repository holding more than one thing | A newer commit on the branch |

The card names the repository and the release or commit it came from, and
offers **Update** when there is something newer (it looks at most every
fifteen minutes). Updating needs the switch on, like the first install.

If an addon with the same id is already installed from somewhere else (the
list's copy, a different repository or fork, a file), the panel asks
before replacing it. A replacement keeps the addon's settings and data
folder, and starts switched off so you can read what it asks for.

For writing an addon there is a faster loop: point `ODM_ADDON_DEV_DIRS` at its
working folder (several folders separated by `:` on Linux and macOS, `;` on
Windows) and restart the server. A development folder is listed live, read
from disk on every change, and marked as such. See
[addons/authoring.md](addons/authoring.md#trying-it-on-a-server).

## Settings and configuration

| Variable | Default | |
|---|---|---|
| `ADDON_REGISTRY_URL` | the Open Game Master list | The https address of an addon list in the same format (or set it under Admin > Addons). `off` browses none |
| `ADDONS_DIR` | `data/addons` | Where addon packages, their data folders and their working files live |
| `ODM_ADDONS` | on | `off` switches addons off on this server |
| `ODM_ADDON_DEV_DIRS` | unset | Development folders to load addons from, for authors |

On disk, under `ADDONS_DIR`:

```text
packages/<id>/          the unpacked addon, replaced whole on update
data/<id>/              the addon's own folder (downloaded models, caches), kept on update
data/<id>/.venv/        a Python addon's environment, made by its setup
data/<id>/public/       its asset library, served to its board views
work/<run>/             one run's input and output, removed after the run
incoming/               uploads on their way in
```

Removing an addon deletes its package and its data folder. What it made
(workshops, maps, their pictures and models) stays.

Backups and **Move your world** carry the database, which remembers which
addons were installed, their settings and their permissions, but not the
packages themselves. On the new machine those addons show **Files missing**;
press **Reinstall** on each to fetch it from the list again.

## What an addon can and cannot do

An addon runs as a program on this computer, with the same rights as the
server's user. The audit for the list is the real trust boundary, which is why
an addon from a file is labelled unreviewed. Beyond that, the server holds
these lines:

- **No secrets.** An addon starts with an environment built from an allowlist:
  no database key, no provider keys, nothing the server holds as a secret
  (the same rule agent programs follow). Its own settings reach it as
  `ODM_ADDON_SETTINGS`.
- **No database.** An addon never writes the app's data. It returns results;
  the server checks them against the extension point's contract (a bundle
  against the bundle schema, terrain against the rules' alphabet and the map's
  size, a picture by its bytes, a model by its header) and writes them through
  its own code.
- **No model access unless accepted.** Sampling is refused without the
  `ai.text` permission, and every call it makes is counted under Usage.
- **Board views are sandboxed.** A board view runs in a frame with scripts and
  nothing else: an opaque origin with no cookie, no access to the page around
  it, no network beyond this server's public files, and only the board its
  viewer may see. Its page and its asset library (`data/<id>/public`) are
  served to anyone who can reach the server, like the app's own scripts, so
  nothing private belongs there.
- **Setup downloads are checked.** https only, and refused unless the size
  and SHA-256 match what the manifest declares.
- **Addons do not trip over each other.** Each has its own process, folders,
  Python environment, settings and addresses. Addons that declare a conflict
  never run together, and addons that share a resource such as the graphics
  card take turns: a run that has to wait says "Waiting for X, which is
  using the gpu" and can be stopped while it waits.
- **Files stay inside their folders.** An addon's files are fetched from its
  repository one by one and checked against git's hashes; paths that are
  absolute or climb with `..`, links and submodules are refused; anything an
  addon names in a result must be a plain file in its own output folder.

## Troubleshooting

- **An addon says a program is missing.** Open **Settings and checks** and
  press **Check what it needs**. Install the program, or point the addon's
  path setting at it, and check again.
- **An addon does not start.** Press **Start it and list its tools**; the log
  under it shows what the program wrote. A Python addon needs Python 3.10 or
  later (or what its manifest names) on the PATH.
- **Setup failed.** The card says why; **Check what it needs, and its log**
  shows each step. On Debian and Ubuntu a Python addon's setup needs the
  `python3-venv` package. Fix the cause and press **Run its setup again**.
- **A run stops after five minutes.** An addon must report progress at least
  every few minutes; a run that says nothing for five is cancelled.
- **Nothing appears in the workshop or the map library.** Only switched-on
  addons are offered, and the pages read the list when they load: reload the
  page after switching one on.
