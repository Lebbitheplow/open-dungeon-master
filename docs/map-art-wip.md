# Map art: work in progress

Paused 2026-09-16. Goal: battle maps that look as good as Inkarnate, built from
ComfyUI-generated assets, with nothing AI in the loop per map.

## Where it stands

- The latest look is **renderer v2**. See
  `data/map-render-wip/reference/renderer-v2-latest.png`, or open
  `data/map-render-wip/renderer/preview-v2.html` in a browser.
- `/NAS/odm-tileset-comparison.html` is **out of date**: it still shows
  renderer v1 (soft edges, no props, blocky walls). It was never rebuilt with v2.
- Nothing in `src/` has changed. The app still draws the old vector terrain.
- Nothing is committed.

## Uncommitted changes in the repo

| Path | State | What it is |
| --- | --- | --- |
| `scripts/lib/comfy-render.mjs` | modified | New `tiling` option: true seamless generation via `SeamlessTile` + `CircularVAEDecode` |
| `scripts/tile-set.mjs` | new | 182-tile catalogue across 9 terrain roles, painted art direction, per-category framing |
| `scripts/generate-tiles.mjs` | new | Tile renderer. Flags: `--dry-run`, `--only a,b,c`, `--force`, `--reencode`, `--seed-salt`. Per-tile saturation ceiling. Merges into the manifest instead of overwriting it |
| `public/assets/tiles/` | new | 182 WebP tiles at 256px (~3.8 MB) plus `manifest.json` |
| `data/tile-src/` | gitignored | 1024px originals for `--reencode` |
| `data/map-render-wip/` | gitignored | Renderer prototype, prop library and reference images (below) |
| `docs/map-art-wip.md` | new | This file |

Last verified: `scripts/test-placeholders.mjs` passes, because the tiles sit outside its
byte budgets. Lint was clean *before* the saturation ceiling went into
`generate-tiles.mjs`. Run lint again before committing.

## Changes on this machine, outside the repo

- Installed the ComfyUI custom node `spinagon/ComfyUI-seamless-tiling` into
  `~/ComfyUI/custom_nodes` and restarted the `comfyui` systemd user service.
- Left some `odm-*` draft images in `~/ComfyUI/input` from experiments. Safe to delete.

## What was tried, and what was learned

1. **Photoreal tiles with a mirror-blend seam: rejected** ("early 80s").
   Mirroring matches edges by reflection, which prints visible symmetry across a
   tiled floor. The seam test was also wrong: comparing the first and last columns
   rewards duplication. The right test is a ratio against the texture's own
   interior column pairs, where ~1.0 means seamless. Mirrored tiles scored 0.18.
2. **True seamless plus painted style: fixed the seams, not the look.** Circular
   padding scores a median of 1.02. A photorealism checkpoint gives incoherent sets,
   so the art is now painted with a saturation ceiling.
3. **One texture per square: rejected** ("bunch of squares"). Hard terrain edges on
   grid lines are the problem. More variants would not fix it.
4. **Soft-edge blending, renderer v1: better, still rejected** against Inkarnate.
5. **img2img repaint of each map with Flux or SDXL: rejected by the user.** "I want
   it to look good naturally, not for the AI to remake each map." The rule now:
   AI makes reusable assets once, and the renderer composes every map
   deterministically. (Flux schnell nailed the look but ignored the layout; the
   contact sheet is in `reference/img2img-experiment-rejected.png`.)
6. **Renderer v2, the current direction.** Details below.

## Renderer v2: what it does

File: `data/map-render-wip/renderer/splat-renderer.js`. It is canvas 2D, needs no
dependencies, and draws 4 maps in about 3 to 4 seconds. The grid stays authoritative
for the rules; the art only starts from it.

- **Terrain masks:** each terrain's squares are blurred into a soft field, pushed around
  by fbm noise, then cut with a smoothstep. Boundaries stay near the grid lines
  without being drawn on them.
- **Floor:** stones at a believable scale (`floorSpan` ~1.6 squares per texture).
  Texture bombing breaks repetition: the same texture again at 1.37x scale and a
  quarter turn, revealed through noise.
- **Ground patches:** a second material shows through in soft noise patches
  (`grass-dry` on grass, `ash-grey` on basalt), plus subtle grime.
- **Walls:** low blur with fine noise, soft shading on the floor at the base, a drop
  shadow, masonry darkened by `wallTint`, a lit top edge, a shaded bottom edge, and
  a hard outline. Use `wall-volcanic`, `wall-rubble-collapsed` or
  `wall-ruined-overgrown`. **Never `wall-castle-block`**: its square blocks bring
  back the grid look.
- **Doors:** a thin slab set into the wall run and rotated to match it, not a square.
- **Water:** a dark wet margin, depth shading along the near bank, and an outline.
  **Lava** (`glow: true`) gets an orange additive glow instead.
- **Props, placed from a fixed seed:**
  - About 26% of floor squares next to walls get a prop, pushed toward the wall.
    Long props are rotated to lie parallel to it.
  - About 5 to 10% of open squares get a scattered prop.
  - Doorways, corridors (walls on opposite sides) and squares next to another prop
    are skipped, so props never suggest an obstacle the rules do not have.
  - Each prop gets a dark outline and a soft contact shadow.
- **Final grade:** a slow tonal drift across the map (soft-light), then a tint per skin.

The skin configs live in `renderer/build.mjs` (`SKINS`: Stone dungeon, Sunken crypt,
Overgrown ruin, Volcanic deep). Each sets bound tiles, spans, tints, patch, glow,
prop densities and a weighted prop list.

## Prop library

Generator: `data/map-render-wip/props/gen.mjs`. It runs SDXL, then BEN2 background
removal (the `easy imageRemBg` node), then `cutout.sh`, which fills holes in the
matte, trims the image and adds a margin.

**28 done**, in `props/library/`:
barrel, bedroll, bones, bookshelf, boulder, brazier, bush, campfire, candles, chest,
crate, fern, log, mushrooms, pillar, rocks, rubble, rug, sacks, sarcophagus, skulls,
stalagmites, stool, stump, table, tree, urn, weapon-rack.

**6 never rendered:** flowers, obsidian, lava-rock, coffin, cauldron, anvil. The
crypt and volcanic skins reference these, so those two maps are thin on props.

**Not reviewed yet:** most of the 22 props made with the corrected style. Only table
and stool were checked. Review them all on a contact sheet before trusting them.

Prompt lessons, all hit in practice:
- Never put "battle map", "Inkarnate" or "Dungeondraft" in a prop prompt. The model
  draws parchment maps with compass roses.
- Without fantasy context, props turn modern: toast on a cutting board, an orange
  bar stool. The working style line is the one currently in `gen.mjs`
  ("a single medieval fantasy RPG prop, hand painted..."), plus the anti-modern
  negative prompt.
- ImageMagick gotcha: `-compose CopyAlpha` stays active for a later `-border` and
  wipes the colour. Reset with `-compose Over` (already done in `cutout.sh`).
- Re-rendering a bad asset on the same seed repeats the mistake. Use a seed salt.

## Plan to finish

1. **Finish props.** Render the 6 missing ones. The scripts hardcode `/tmp/props`
   paths, so fix those first. Put every prop on a contact sheet, then reprompt or
   re-seed the bad ones.
2. **Tune v2 with the full prop set.** Known issues:
   - The crypt blood pool is too loud.
   - The volcanic ash rough terrain is a flat block.
   - Rough regions still read as rectangles when they fill a room.
   - The low-wall strip looks odd.
   - Props read small at page zoom.
3. **Publish v2 to NAS.** Update `build.mjs` paths, rebuild
   `/NAS/odm-tileset-comparison.html`, and get sign-off on the look.
4. **Only then, port into the app:**
   - Move props into the repo like tiles: a `prop-set.mjs` / `generate-props.mjs` pair,
     `public/assets/props/` plus a manifest, and a byte budget test.
   - Replace the per-square drawing in `terrainDraw.ts` (editor canvas) and
     `battleMapCells.tsx` (play view, which is SVG today and probably needs a canvas
     layer) with the layered renderer. Cache masks per map, not per frame.
   - Map the existing `MapTheme` values (cave, forest, swamp, riverside, interior,
     field) onto skins.
   - Fog of war currently hides whole squares. Soft edges need fog drawn above the
     art, and fog must not leak unexplored detail.
   - Keep the grid overlay toggle, and keep props from implying obstacles.
   - Carry the change to the client apps.
5. **Open questions for the user:**
   - Should DMs be able to place, move and delete props as editor stamps, or only
     get the automatic ones?
   - Several variants per material?
   - Fitting orientation (stairs, bridges) is still inconsistent.

## Heads-up for other map changes

Step 4 rewrites the terrain drawing in `terrainDraw.ts` and `battleMapCells.tsx`.
If those files change in the meantime, the port will need to follow those changes.
The renderer only depends on the terrain string (`# . ~ , + |`) and the theme, so
changes elsewhere should not conflict.
