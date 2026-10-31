# Genre action cards

The fifteen core action illustrations have five genre variants (75 paintings).
The campaign's existing `gameSettings.genre` selects them in the hand, More
actions, grouped cards and Customize Hand. High fantasy, dark fantasy, custom, unknown or
missing genres retain the original set. A missing variant falls back to the
base illustration. This does not change card mechanics or rename equipment.

| Setting | Equipment and visual direction |
| --- | --- |
| Cyberpunk | Cybernetic fist, electronic scanners and a futuristic rifle for Ready; cyan and magenta |
| Steampunk | Fist with a leather/brass cuff, pneumatic rifle, brass valves and aether machinery; copper and teal |
| Mystery | Bare fist, period revolver, camera, case notes and magnifying glass; sepia noir |
| Horror | Bare fist, worn shotgun, flashlights and protective charm; drained colors and harsh lamplight |
| Post-apocalyptic | Wrapped fist, repaired hunting rifle, salvaged emitter, crank radio and scavenged supplies; dust and rust |

This set covers the core actions, not individual weapon, gear, spell or class
feature paintings. An inventory longsword keeps its own painting; it is never
silently shown as a firearm. The genre's named equipment retains its existing
item icons.

The legacy `attack` asset filenames depict fists and are also selected for the
actual `unarmed-strike` card key. All Stand Up variants include an upward arrow,
all End Turn variants pair an hourglass with a completion mark, and Escape uses
a broken-chain symbol without hands. The [meaning review](genre-action-semantic-review.md) records
the 27 replacements and the review of the remaining 48 illustrations.

The latest refinement gives Mystery Cast an active seance and Steampunk Cast a
projected aether vortex. Search shows a magnified footprint in Steampunk, an
unsettling discovery at a damaged door in Horror, and supplies revealed beneath
rubble in Post-apocalyptic. Earlier versions remain in the source history.

## Sources and maintenance

The paintings were produced with the built-in `image_gen` tool. Selected source
filenames, retained prompts, edit history and hashes live in
`genre-action-cards-2026-10-26.json`. The first batch's missing full prompts are
explicitly marked; descriptions are not presented as verbatim generation prompts.

`scripts/genre-action-subjects.json` registers the set with the icon catalogue.
The square ComfyUI generator preserves these externally authored paintings and
includes them when rebuilding the public manifest and painted-icon index.

To re-encode the selected originals and regenerate the compact review sheets:

```sh
node scripts/package-genre-action-art.mjs /path/to/source-png-directory
node scripts/test-card-art.mjs
node scripts/test-icons.mjs
node scripts/test-hand-look.mjs
```

The shipped assets are 256x128 WebP with alpha. Review sheets show every action
at 112x56 and 80x40 against dark and light surfaces. Original generated PNGs are
retained outside the repository; the shipped WebP files are self-contained.

## Validation

All 75 files were checked for 256x128 dimensions and both transparent and opaque
pixels. The active manifest records the set's byte size. The card-art, icon and
hand-look scripts include 32 checks in total, including an actual dealt unarmed
card. TypeScript and lint are also checked. These checks verify integration and
file integrity; they do not evaluate the meaning of the artwork.

`genre-action-cards-desktop.png` and `genre-action-cards-mobile.png`, plus their
`-light.png` counterparts, show the
actual `HandCardFace` component and application CSS in a static browser gallery
at 1020px and 390px viewport widths in night and day themes. The gallery spreads the cards out and
removes the session hand's scroll-height cap for review. These are component
previews, not screenshots of an authenticated campaign or interaction tests.
