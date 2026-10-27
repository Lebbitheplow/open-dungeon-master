# Choosing creature art for ODM

Use this guide when adding shipped artwork, bestiary entries, world-pack art,
or generation prompts. It records ODM's conservative publishing practice, not
a claim that every creature outside the SRD is legally prohibited. Checked
against Wizards' sources on 2026-10-11.

## Choose and record the source

Prefer a creature with its own stat block in the licensed System Reference
Document (SRD). ODM's `/rulebook` and `src/lib/rulebook/srd-5.1.json` provide a
convenient starting point. A passing mention of a name does not establish
permission to reproduce that creature's full design or lore.

Original creatures, traditional folklore, and separately licensed third-party
content are also possible. For third-party content, record the exact source,
license, permitted use, and required attribution. Presence in an installed
Open5e pack or a user's homebrew collection is not automatic permission to ship
its art. Rules permission and permission to copy an illustration are separate.

Create original illustrations. Do not copy or trace official pictures, use
them as image-edit inputs, or request reproduction of a specific published
design without permission for that artwork. A generic folklore creature does
not make a publisher's particular illustration free to reuse.

## Subjects to avoid in shipped art without separate clearance

Wizards' SRD 5.1 **OGL edition**, page 1, explicitly lists these creatures or
names as Product Identity: beholder, gauth, carrion crawler, displacer beast,
githyanki, githzerai, mind flayer/illithid, umber hulk, yuan-ti, tanar'ri and
baatezu. This is an OGL designation, not a universal legal classification or
an extra restriction to paste onto the separate Creative Commons license.

Also avoid WotC-specific depictions of kuo-toa, slaadi, flumphs, neogi, hook
horrors, grells, intellect devourers and death knights without a documented
permission basis. These have no individual monster entries in ODM's bundled
SRD 5.1 rulebook; that absence is a reason to check the source, not proof that
every independently created fish-person, floating creature or undead knight
is prohibited. This watch list is not exhaustive.

Apply the same source check to branded characters, settings, locations and
spell names. Do not assume that an SRD reference to a place licenses its
setting lore. Use ODM's plain SRD spell names. Wizards' FAQ explains both
renamed content and exclusions; check the exact SRD version rather than
treating a combined internet list as definitive.

## Prompt and visual review

Name the intended creature instead of relying on a category alone. For the
aberration plate, use an aboleth or chuul. Other verified SRD 5.1 subjects
include owlbear, rust monster, gelatinous cube, mimic, otyugh, bulette, cloaker,
roper and tarrasque.

Example: "An original aboleth in flooded ruins, an elongated aquatic body and
four tentacles; no beholder, floating eyeball with eyestalks, or mind flayer;
do not reproduce a published illustration."

Inspect the finished image at full size and at thumbnail size. Check every
creature in a composite, including background subjects. Renaming a recognizable
beholder does not fix its visual design. If generation drifts to an excluded
subject, replace the anatomy and inspect again before shipping.

Save the subject, source/license reference, prompt, dimensions and file hash
with the art change. Keep original vote records historical; an edited image
does not inherit votes cast for its predecessor. The two aboleth replacements
are recorded in [aboleth-replacements-2026-10-11.json](aboleth-replacements-2026-10-11.json).

## What happens during play

The curated Bestiary is not the GM's only source. `resolveMonster` in
`src/lib/bestiary/index.ts` also resolves installed content and table authors'
homebrew. World packs can overlay or extend the genre catalog. In
`src/lib/dm/encounter-spawn.ts`, an unresolved name with a supplied challenge
rating (CR) receives generic synthesized stats; without a CR, the request
returns an unknown-monster error. These are mechanical fallbacks, not source
or rights checks.

For `MonsterTile` in `src/lib/ui.tsx`, explicitly supplied art wins. Otherwise
`monsterPlaceholder` in `src/lib/placeholders.ts` chooses, in order:

1. A genre boss plate for CR 11 or above in supported genres.
2. A genre/type plate, with a stable name/slug seed choosing between variants.
3. The general creature-type plate, or monstrosity for an unrecognized type.

This path does not generate a portrait or find the visually nearest species.
Several distinct aberrations can therefore share the aboleth category picture.
Separate scene illustration through `generate_image` can run when campaign
image generation and a working image producer are available
(`src/lib/dm/images.ts`). It attaches art to narration; missing monster
thumbnails do not trigger it. Other portrait/world-art tools are separate too.

This guide is a contributor instruction. It does not add a runtime creature
blocklist or inspect every image generated during play.

## Primary sources

- [Wizards' SRD page and FAQ](https://www.dndbeyond.com/srd): current releases,
  version-specific exclusions, renamed content and Creative Commons terms.
- [SRD 5.1, Creative Commons edition](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf):
  license on page 1; aboleth stat block on page 261.
- [SRD 5.1, OGL edition](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD-OGL_V5.1.pdf):
  historical Product Identity list on page 1.
- [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf):
  a separately licensed version; do not assume its contents match 5.1.

Keep applicable attribution in [../LICENSES.md](../LICENSES.md) accurate when
adding content from another source or SRD version.
