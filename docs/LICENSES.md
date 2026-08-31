# Licenses

## Application

Open Dungeon Master is a fork of
[Open Dungeon](https://github.com/newideas99/open-dungeon) by Jacob Ferrari,
released under the MIT license. This fork keeps the MIT license; see
[LICENSE](../LICENSE).

## Game rules data (SRD 5.1)

The rules data in `src/lib/srd/` (skills, classes, races, backgrounds, and
spell slot tables) derives from the System Reference Document 5.1 ("SRD 5.1")
by Wizards of the Coast LLC, available at
https://dnd.wizards.com/resources/systems-reference-document

The SRD 5.1 is licensed under the Creative Commons Attribution 4.0
International License (CC-BY-4.0):
https://creativecommons.org/licenses/by/4.0/legalcode

This work includes material taken from the System Reference Document 5.1
("SRD 5.1") by Wizards of the Coast LLC. The SRD 5.1 is licensed under the
Creative Commons Attribution 4.0 International License.

## Ambience and music

**No audio ships with this project.** `src/lib/ambience/catalog.ts` names the
cues the app can play; the files live in `public/ambience/`, are not in git,
and arrive only when an operator runs `scripts/fetch-ambience.mjs`.

That script reads the licence each archive records for a file and refuses
anything it cannot positively identify, including a blank licence field. By
default it accepts only public-domain dedications: CC0 and the Public Domain
Mark, both of which impose no further obligation on a downstream user.

`--allow-attribution` widens it to CC BY and CC BY-SA. Those are usable but
oblige you to keep the credit visible, which the app does for you: every
accepted file's title, author, source URL and licence are written into
`public/ambience/manifest.json` and listed on the in-app `/licenses` page,
under "Sound library". NonCommercial and NoDerivatives licences are refused
under every setting, because whether a given install is a commercial or a
derivative use is a question about the operator, not about this project, and
the script must not answer it on their behalf.

Files an operator supplies by hand (dropped into `public/ambience/`, or pinned
in `data/ambience-sources.json`) are credited as locally supplied. The licence
for those is the operator's to establish and to stand behind; this project
makes no claim about them.

**The rule for contributors:** do not add audio files to this repository, and
do not add a source to the fetch script that cannot report a machine-readable
licence per file. A cue with no file is silent, which is a visible and
harmless failure. A cue playing something nobody can account for is not.

## Expanded options (original content)

Many class options, spells, feats and lineages that players expect at a 5e
table appear in no openly licensed dataset: no SRD release, and no OGL or
Creative Commons third-party document, carries Circle of the Moon, Battle
Master, Assassin, Sharpshooter and the rest. We implement them ourselves.

These live in:

- `src/lib/srd/subclasses.json` (subclass feature tables and rules text)
- `src/lib/srd/authored-resources.json` (their limited-use counters)
- `src/lib/srd/authored-spells.json`, `src/lib/srd/authored-feats.json`
- the lineages added below the SRD nine in `src/lib/srd/races.json`

They ship as the `odm-expanded` document in the content pack and are listed
on the in-app `/licenses` page as original content.

**The rule for contributors: game mechanics are not copyrightable, but the
words describing them are.** Every line in those files is written from
scratch to state what a feature does. Do not paste text from any published
book, SRD or otherwise, into them. If you are adding an option, describe its
mechanics in your own words or do not add it.

Restating is not the same as reordering. A short feature is the easy one to
get wrong: when a spell does one simple thing there is little room to compress,
and a "paraphrase" collapses back onto the printed sentence. Lead with the
trigger and the number, drop the flavor clause, and do not preserve the book's
sentence order.

**The second rule: no personal names in canonical titles.** Wizards stripped
every wizard-named spell when it released the SRD ("Melf's Acid Arrow" is
published there as "Acid Arrow"), which marks those names as the part it
treats as protected identity. We follow suit: entries are stored under the
generic title, and the printed name is kept as a search alias so players can
still find it. Spell aliases live in `src/lib/srd/manifest/spells.json` as
`{ n: "<canonical>", a: ["<printed name>"] }` and are applied to the pack by
`scripts/import-open5e.mjs`; `searchSpells` matches on them.

## Ideas borrowed from other MIT projects

No code from these is in this repository. Each is named because its SHAPE
informed a module here, and saying so is cheaper than leaving a reader to
wonder.

- **foundryvtt/dnd5e** (MIT). Its `data/calendar/` shape (a generic calendar
  model plus optional setting presets rather than a hard-coded year) informed
  `src/lib/dm/calendar.ts`. Its `data/actor/group.mjs` (a party as a container
  with its own currency and inventory, not a sixth character) informed
  `src/lib/dm/party-logic.ts`. Its ActiveEffect model informed the shape of
  `src/lib/dm/effects-logic.ts`.
- **Simple Worldbuilding** (MIT). Its idea of typed key/value attributes with
  groups, including rollable formula attributes, is reimplemented in
  `src/lib/dm/attributes-logic.ts`.
- **NE-P** (MIT). Its swipe generation informed the reroll temperature offset
  in `src/lib/dm/renarrate-logic.ts`, which carries the reference in place.

## Campaign plugins (world packs)

**The application is MIT licensed. Third-party and unofficial campaign content
is not included with this repository and is not covered by the MIT license.**

World packs are the plugin format described in [worlds.md](worlds.md). They come
from two places, and the split is a licensing boundary:

- `src/lib/worlds/bundled/` ships with the app and is therefore MIT. **Bundled
  packs must be original works.** A pack built on somebody else's setting cannot
  go here. `scripts/test-world-packs.mjs` fails the build if a bundled pack
  names a `rightsHolder`.
- `data/worlds/` is gitignored and populated at runtime by an admin, from a
  registry or an uploaded file. Those packs are not part of this repository, are
  not distributed by this project, and belong to their authors.

No registry is configured by default. Pointing a server at one is an explicit
act by its operator, and installing a pack is a decision that operator makes.

A pack carries no rules text. It maps canonical SRD ids and names to display
names and adds original flavor prose, so the surface where copying could happen
is small. Two rules for pack authors:

1. **Write every blurb yourself.** Researching an existing fan conversion to
   decide which canonical class a concept maps onto is fine. Copying its prose,
   or a publisher's, is not.
2. **Name the rights holder.** A pack that references an existing universe must
   set `rightsHolder`. That is what turns every surface showing the pack into an
   explicit notice that it is a fan work carrying no affiliation or endorsement.
   The exposure worth avoiding is a player believing the rights holder made it.

Dungeons & Dragons and D&D are trademarks of Wizards of the Coast LLC. This
project is not affiliated with, endorsed, or sponsored by Wizards of the
Coast.
