// The catalogue of decals: the painted edges and the small scatter that pull a
// composed map into one picture.
//
// Two shapes. An `edge` decal is a wide strip that the renderer lays along a
// contour: the mossy lip along a wall's floor side, foam along a shore, a
// scorch along lava. A `scatter` decal is a small loose thing dropped by
// noise on open ground: a crack, a puddle, a drift of leaves. Neither is a
// rule; the renderer places them where the rules have nothing to say.
//
// Consumed by scripts/generate-props.mjs. Pure data plus prompt assembly.

import { MAP_STYLE } from "./prop-set.mjs";

const EDGE_LOOK =
  "a long horizontal band running the full width of the frame from the left edge to the right edge, " +
  "seen from directly above, isolated on a plain flat white background above and below the band, " +
  "the band is thin and sits in the middle of the frame, no other objects";

const SCATTER_LOOK =
  "a single small patch seen from directly above, isolated on a plain flat white background, " +
  "centred, soft irregular edges, empty margin around it, no other objects";

// Edge decals. `family` says which mask edge they follow: a wall family lays
// along the floor side of that wall material's contour, `water`, `lava`,
// `chasm` and `rough` along those regions' outlines.
//
// [id, what the band is, family]
const EDGES = [
  ["edge-mortar-lip", "a strip of dark mortar and small chipped stone crumbs along the base of a stone wall", "wall-stone"],
  ["edge-moss-lip", "a strip of green moss and a few tiny ferns growing along the base of a stone wall", "wall-stone"],
  ["edge-rubble-crumbs", "a scatter of small grey stone chips and dust along a line", "wall-stone"],
  ["edge-cobweb-lip", "thin grey cobweb strands and dust stretched along a line, wispy and translucent", "wall-stone"],
  ["edge-damp-stain", "a dark damp stain with green algae along the base of a wall", "wall-stone"],
  ["edge-ivy-lip", "a strip of dark green ivy leaves and tendrils trailing along a line", "wall-green"],
  ["edge-leaf-fringe", "a fringe of small green leaves and twigs along a line", "wall-green"],
  ["edge-root-lip", "a strip of pale tangled tree roots and dark soil along a line", "wall-earth"],
  ["edge-grass-fringe", "a fringe of small grass tufts along a line", "wall-earth"],
  ["edge-timber-shavings", "a thin scatter of pale wood shavings, splinters and sawdust along a line", "wall-wood"],
  ["edge-ice-rime", "a strip of white frost crystals and rime along a line", "wall-ice"],
  ["edge-snow-lip", "a low drift of white snow along a line", "wall-ice"],
  ["edge-ash-lip", "a strip of grey ash and black cinder crumbs along a line", "wall-volcanic"],
  ["edge-scorch-lip", "a strip of black scorching and glowing orange embers along a line", "wall-volcanic"],
  ["shore-foam", "a thin lacy strip of bright white sea foam and small bubbles along a shoreline, wet dark sand below it", "water"],
  ["shore-wet-sand", "a strip of dark wet sand with small pebbles and shells along a shoreline", "water"],
  ["shore-reeds", "a long thin row of green reed stems and grass blades growing all along a shoreline, evenly spread across the full width", "water"],
  ["shore-lily-fringe", "a strip of small green lily pads and duckweed along a shoreline", "water"],
  ["shore-scum", "a strip of brown green pond scum and floating leaves along a shoreline", "water"],
  ["shore-ice-edge", "a strip of broken white ice plates along a shoreline", "water"],
  ["lava-crust", "a strip of black cooled lava crust with glowing orange cracks along a line", "lava"],
  ["lava-scorch", "a strip of scorched black rock and grey ash along a line", "lava"],
  ["lava-embers", "a scatter of glowing orange embers and sparks along a line", "lava"],
  ["chasm-lip", "a strip of crumbling broken stone edge with small stones falling away along a line", "chasm"],
  ["chasm-roots", "a strip of pale roots and dark soil hanging over a broken edge along a line", "chasm"],
  ["chasm-ice-lip", "a strip of jagged broken blue ice along an edge", "chasm"],
  ["rough-bramble-fringe", "a fringe of dark thorny bramble twigs along a line", "rough"],
  ["rough-grass-fringe", "a fringe of tall dry grass stems along a line", "rough"],
  ["rough-gravel-spill", "a spill of small grey gravel stones along a line", "rough"],
  ["rough-mud-edge", "a strip of dark wet mud with small puddles along a line", "rough"],
  ["rough-snow-edge", "a soft edge of white snow along a line", "rough"],
  ["rough-bone-fringe", "a scatter of small pale bone fragments along a line", "rough"],
];

// Scatter decals. `on` says which ground they suit, so a leaf drift lands in
// a forest and not in a sewer. A stain (a crack, a puddle, blood, soot) draws
// in multiply blend, because the model paints it on a patch of pale ground
// that multiply makes vanish while the dark marks stay; loose things (leaves,
// pebbles, coins) draw normally.
//
// [id, what the patch is, on]
const SCATTERS = [
  ["crack", "a thin jagged dark crack across pale stone", "stone"],
  ["cracks-web", "a small web of thin dark cracks in pale stone", "stone"],
  ["puddle", "a small dark puddle of water with a soft reflective sheen", "stone earth"],
  ["puddle-mud", "a small brown muddy puddle", "earth"],
  ["leaf-drift", "a small drift of fallen brown and orange leaves", "earth grass stone"],
  ["leaves-green", "a few scattered small green leaves", "grass earth"],
  ["moss-patch", "a soft patch of green moss", "stone earth"],
  ["lichen-patch", "a patch of pale grey green lichen", "stone"],
  ["blood-pool", "a dark red pool of blood with a smear", "stone earth"],
  ["blood-drops", "a few dark red drops and a small spatter", "stone earth"],
  ["ash-pile", "a small pile of grey ash", "stone volcanic"],
  ["soot-stain", "a dark grey soot stain", "stone"],
  ["bone-chips", "a few small pale bone fragments", "stone earth"],
  ["footprints-mud", "a few muddy boot prints in a line", "earth stone"],
  ["straw-scatter", "a scatter of loose golden straw", "stone earth"],
  ["sand-ripple", "a small patch of rippled golden sand", "sand"],
  ["sand-drift", "a soft drift of pale sand", "sand stone"],
  ["oil-stain", "a dark oily stain with a faint rainbow sheen", "stone"],
  ["chalk-marks", "a few thin white chalk lines and a small scrawled circle", "stone"],
  ["scorch-mark", "a black scorch mark with a soft grey halo", "stone earth"],
  ["grass-tuft", "a small tuft of green grass", "earth stone sand"],
  ["grass-tuft-dry", "a small tuft of dry straw coloured grass", "earth sand"],
  ["pebbles", "a few small grey and brown pebbles", "earth stone sand"],
  ["mushrooms-small", "three tiny pale mushrooms", "earth stone"],
  ["cobweb-corner", "a small grey cobweb", "stone"],
  ["drip-stain", "a dark wet drip stain running downward, no rock, just the stain", "stone"],
  ["coins", "a few scattered gold coins", "stone earth"],
  ["broken-arrows", "two broken arrows with fletching", "earth stone grass"],
  ["torn-cloth", "a scrap of torn brown cloth", "stone earth"],
  ["shattered-pot", "the shards of a broken clay pot", "stone earth"],
  ["ivy-sprig", "a small sprig of dark green ivy", "stone"],
  ["frost-patch", "a patch of white frost crystals", "stone ice"],
  ["snow-patch", "a small soft patch of white snow", "ice earth stone"],
  ["mud-splash", "a brown mud splash", "earth"],
  ["rune-mark", "a small faintly glowing violet rune carved in stone", "stone"],
  ["salt-ring", "a small ring of white salt", "stone earth"],
  ["feathers", "a few small grey and white feathers", "earth stone grass"],
  ["twigs", "a few small dry twigs", "earth grass"],
  ["flowers-small", "a few tiny wildflowers in a patch of grass", "grass"],
  ["embers", "a few small glowing orange embers on black", "volcanic stone"],
];

export const EDGE_LIST = EDGES.map(([id, detail, family]) => ({
  id,
  shape: "edge",
  detail,
  family,
  width: 1024,
  height: 256,
  prompt: `${EDGE_LOOK}, the band is ${detail}, ${MAP_STYLE}`,
}));

const STAINS = new Set([
  "crack", "cracks-web", "puddle", "puddle-mud", "blood-pool", "blood-drops", "soot-stain", "oil-stain",
  "scorch-mark", "drip-stain", "mud-splash", "rune-mark",
]);

export const SCATTER_LIST = SCATTERS.map(([id, detail, on]) => ({
  id,
  shape: "scatter",
  detail,
  on: on.split(" "),
  blend: STAINS.has(id) ? "multiply" : "normal",
  width: 1024,
  height: 1024,
  prompt: `${SCATTER_LOOK}, the patch is ${detail}, ${MAP_STYLE}`,
}));

export const DECAL_LIST = [...EDGE_LIST, ...SCATTER_LIST];
