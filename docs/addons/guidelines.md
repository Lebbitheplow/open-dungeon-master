# Addon guidelines

What the downloader list accepts, how an addon gets on it, and how it is
audited. Addons are their authors' own projects, in their authors' own GitHub
repositories: Open Game Master does not write, ship or update them. It
provides the framework, and it keeps one list of addons that have been
audited, [`addons/catalog.json`](../../addons/catalog.json) in this
repository, which every server shows under **Admin > Addons** unless its
operator points elsewhere. An author adds their addon to that list with a pull
request here.

An addon runs as a program on somebody's computer with their server's rights.
The audit is what makes installing one from the list a reasonable thing to
do, so these rules are firm.

- [What belongs on the list](#what-belongs-on-the-list)
- [Security](#security)
- [Privacy](#privacy)
- [Content and rights](#content-and-rights)
- [Behaviour and quality](#behaviour-and-quality)
- [How it looks and reads](#how-it-looks-and-reads)
- [Submitting an addon](#submitting-an-addon)
- [The review checklist](#the-review-checklist)
- [How the list works](#how-the-list-works)

## What belongs on the list

Addons that make running or prepping a game better through the
[extension points](extension-points.md): importers that turn material a GM owns
into workshop content, map generators, board views. An addon that would need
something the extension points do not offer starts as an issue on the server
repository ([asking for a new extension point](extension-points.md#asking-for-a-new-extension-point)),
not as a workaround.

Not accepted: anything that reaches around the contracts (reading or writing
the server's database or files outside its own folders, patching the app),
crypto mining, advertising, analytics, account systems of its own, and
anything whose main purpose is to fetch content the user has no right to.

## Security

- **Source, not binaries.** The repository holds the addon's source. An
  `executable` runtime commits its programs beside the source and the script
  that builds them, and the reviewer rebuilds them to compare; prebuilt
  binaries without their source are not accepted. Prefer `node` or `python`. Minified or obfuscated
  code is not accepted (a bundled library such as three.js, unmodified and at
  a named version, is fine).
- **Dependencies are pinned.** A lockfile, or vendored copies at named
  versions, for everything the addon runs or downloads. Downloads on first run
  (models, Python wheels) name exact versions and verify a checksum.
- **Declare what you do.** `network` if the addon ever reaches the internet,
  `programs` if it starts other programs, `ai.text` if it asks the
  storyteller, `threads` if its board view shares memory between threads
  (`SharedArrayBuffer`). A permission that is used but not declared fails
  review; so does one that is declared but never used.
- **Stay in your folders.** Write only to `outputDir` and `ODM_ADDON_DATA_DIR`
  (and the system temp folder). Read the input you were given, your own
  package, and the programs you declared.
- **No secrets go anywhere.** Settings of type `secret` are used for the
  service they name and never logged, written to output, or sent elsewhere.
- **No code from the network.** An addon never downloads and runs code that
  was not reviewed: no `pip install` of a package by name without a pin and a
  hash, no `eval` of fetched text, no auto-updater of its own. Updates come
  through the list, one audited commit at a time.
- **Board views stay inside the frame.** They load nothing from outside their
  `ui/` folder and send nothing anywhere (the frame's policy enforces most of
  this; review checks the rest).

## Privacy

- What a GM gives an addon (a rulebook, a map request, the board) stays on
  their server. An addon that uses an outside service says so in its
  description, sends only what the service needs, and says what it sends in its
  settings' help text.
- No telemetry, crash reporting or "phone home", on by default or otherwise.
- Sampling requests go through the server so the admin's model choice, the
  paid-host rules and the Usage ledger apply. Do not bring your own model key
  unless the addon's whole point is a specific service.

## Content and rights

Open Game Master runs the D&D 5e SRD 5.1 under its open license. Material
outside it belongs to its publishers.

- **An addon ships no copyrighted game content.** No rulebook text, stat
  blocks, spell descriptions, maps or art from published products, in the
  package or in anything it downloads. SRD material and the addon's own
  original material are fine.
- **Importers work on what the user owns.** A rulebook importer reads a file
  the user provides, on their own server, into a workshop that is theirs. It
  never uploads the book, never shares what it extracted, and its output names
  its source: `manifest.inspiredBy` is the book's title and
  `manifest.rightsHolder` its publisher, which the app shows as a notice on the
  workshop. It reads books in formats the user can open; it does not break DRM.
- **Generated art follows the app's art rules.** Read
  [docs/art/creature-art-guidance.md](../art/creature-art-guidance.md) and
  [docs/art/token-readability.md](../art/token-readability.md) before an addon
  generates creatures or tokens. A generic prompt must not produce a protected
  creature (a beholder, a mind flayer); name an SRD creature or describe an
  original one.
- **Licenses are compatible.** The addon's own license is OSI-approved, and
  every bundled library's license allows redistribution. List bundled
  third-party code and assets with their licenses in the addon's folder
  (`THIRD_PARTY.md` or similar).

## Behaviour and quality

- **Works everywhere it claims.** If `platforms` is absent it runs on Linux,
  Windows and macOS. Prefer the `node` runtime; a `python` addon works with the
  Python versions it names.
- **Tells the GM what is happening.** Progress at least every minute on long
  work, with words a GM understands ("Rendering the room", not "stage 3/7").
  Errors say what to do next.
- **Stops when asked.** Cancellation ends the work promptly and cleans up.
- **Light when idle.** The server stops an idle addon after ten minutes; it
  must start again cleanly. No background work between calls.
- **Results that read.** An importer's bundle passes the bundle reader with no
  surprises, and its `notes` say what it was unsure of. A map generator's
  terrain and its picture and model agree square for square.
- **Tested.** The repository's checks run `node scripts/check-addon.mjs
  <addon> --run` from the server; an addon with tests of its own (a `test`
  script in its `package.json`, or `tests/` for Python) has them run too.
- **Versioned.** Every release bumps `version`; `id` never changes.

## How it looks and reads

The app's own controls draw an addon's settings, options and progress, so most
of the look is not yours to get wrong. What is:

- `name`, `description`, titles and help text in plain, short sentences, in
  the second person where it helps. Say what it does for a GM.
- A board view follows the table's appearance (`appearance.theme`) and honours
  `reducedMotion`, reads at phone and desktop sizes, and keeps the board
  legible: figures distinguishable at a glance, the active turn obvious, fog
  respected.

## Submitting an addon

Your addon lives in your own public GitHub repository, on its own or as one
folder of a bigger repository. Getting it on the list is a pull request to
this repository that adds one entry to `addons/catalog.json`, written for you
by a script from your repository.

1. Read this page, [authoring.md](authoring.md) and
   [extension-points.md](extension-points.md). Start from a copy of
   [`examples/addons/hello-dungeon`](../../examples/addons/hello-dungeon), the
   framework's reference addon (it is not on the list itself).
2. Keep the addon's source readable in your repository. Whatever is at the
   commit you submit is what servers install: no install scripts and no build
   step run on a server, so commit a bundled entry file, and let the
   manifest's `setup` download what is too big or too platform-specific to
   commit (a portable Blender, models, texture packs: each download may be up
   to 20 GB, streamed to disk and checksummed). A server fetches only your
   addon's folder at that commit, file by file, so the rest of the repository
   costs nothing.
3. From a checkout of this repository, check it the way a server will:

   ```bash
   node scripts/check-addon.mjs ../your-addon --run
   ```

4. Push the commit you want audited, then write its entry:

   ```bash
   node scripts/addon-catalog.mjs add https://github.com/you/your-addon --category maps
   # or a folder at a branch or commit:
   node scripts/addon-catalog.mjs add https://github.com/you/tools/tree/main/addons/iso-board --category maps
   ```

   A branch or tag is resolved to its commit, which is what gets audited. The
   entry holds your addon's name, author, description, permissions and what it
   adds (all read from your `addon.json`), the repository, folder and commit,
   and a hash of the folder's files. Do not edit it by hand: the check
   derives it again and fails on any difference. Categories: `maps` (maps and
   the board), `content` (content and import), `table` (at the table), `tools`.
5. Open a pull request with only that change. Say what the addon does, which
   programs and services it needs, and how a reviewer can try it (a sample
   input file is a good idea, your own or one you have the right to share).
6. The **Addon catalog** check derives the entry from your repository, runs
   the checker on it, starts it, and writes a summary for the reviewer: the
   source at the audited commit, what it asks for, and for an update the
   changes since the last audited commit. A reviewer walks
   [the checklist](#the-review-checklist), tries it on a server, and merges.

Every update is a new pull request: bump `version` in your `addon.json`, push,
and run `add` again. The check fails if the commit changed but the version did
not, since servers offer an update when the version changes. The diff since
the last audited commit is what the review reads.

## The review checklist

- [ ] `check-addon --run` passes; the manifest's tools exist; the package holds
      what the manifest names and nothing it should not (no secrets, no build
      junk, no copyrighted content).
- [ ] Source is readable; dependencies are pinned and licensed for
      redistribution; third-party code is listed.
- [ ] Permissions match what the code does: network calls, programs started,
      sampling.
- [ ] It writes only to `outputDir`, its data folder and temp; it never reads
      the server's files.
- [ ] Nothing downloaded at runtime is unpinned or unverified; nothing fetched
      is executed. Setup downloads name their size and SHA-256 and come from
      the project that publishes them; Python requirements are pinned.
- [ ] The asset library (`publicDir`) holds only what any visitor to the
      server may see.
- [ ] It declares `conflicts` with addons it truly cannot run beside, and
      `exclusive` for shared resources it occupies (`gpu`, `blender`); it
      binds no fixed network port.
- [ ] Settings its setup needs are `required`; settings that change what
      setup does are `affectsSetup` (or named by a download's `when`).
- [ ] Secrets are used only for their service and never logged.
- [ ] Results pass the server's contract checks on real inputs; notes are
      honest about uncertainty.
- [ ] Progress, cancellation, errors and idle restart behave.
- [ ] Runs on every platform it claims (CI, or a reviewer's machine).
- [ ] Content: no published material shipped; an importer names its source
      and keeps the user's material local; generated art follows the art
      guidance.
- [ ] Words read plainly; a board view respects fog, theme and reduced motion.

## How the list works

- **Where servers read it.** From the `main` branch of this repository
  (`https://raw.githubusercontent.com/Lebbitheplow/open-game-master/main/addons/catalog.json`),
  so an addon is offered as soon as its pull request is merged, without
  waiting for a release. When GitHub cannot be reached, a server shows the
  copy of the list its own version shipped with. That copy is only the list:
  no addon's code is in this repository or in the app.
- **What a server installs.** The addon's folder in the author's repository at
  the audited commit, fetched from GitHub file by file when the admin presses
  Install. Each file is checked against the hash git recorded for it, and the
  folder as a whole against the entry's content hash; a difference installs
  nothing. A commit cannot change, so
  later pushes to the author's repository never reach a server until a new
  entry for a new commit has been audited.
- **What the entry shows.** Name, creator, the GitHub user and a link to the
  exact source, what it adds and asks for, the programs it needs, how much
  its setup downloads, and any conflicts or shared resources, all read from
  the addon's `addon.json` at that commit.
- **Removing an addon** from the list is a pull request deleting its entry.
  Servers that installed it keep it until an admin removes it.

The entry format is [`src/lib/addons/registry-index.ts`](../../src/lib/addons/registry-index.ts),
written by [`scripts/addon-catalog.mjs`](../../scripts/addon-catalog.mjs) and
checked by [`.github/workflows/addon-catalog.yml`](../../.github/workflows/addon-catalog.yml).
An operator can point a server at a list of their own in the same format
(Admin > Addons, or `ADDON_REGISTRY_URL`).
