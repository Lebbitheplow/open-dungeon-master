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

Dungeons & Dragons and D&D are trademarks of Wizards of the Coast LLC. This
project is not affiliated with, endorsed, or sponsored by Wizards of the
Coast.
