// The catalogue of map tiles: every surface, blocker, liquid and fitting the
// map editor can paint a dungeon out of.
//
// A tile here is a material, not a picture of a room. Each one renders as a
// square swatch lit flat from nowhere, so the board's own light layer
// (src/lib/battlemap/types.ts) stays the only thing that decides how bright a
// square is. Surfaces are made seamless after rendering and repeat across a
// region; fittings (doors, stairs, spans) are single objects in one square and
// are left alone.
//
// Every entry maps back onto one of the six terrain characters the engine
// already understands (TERRAIN in src/lib/battlemap/types.ts), so a bigger
// palette never means a new rule: a crystal wall and a hedge are both "#".
//
// Consumed by scripts/generate-tiles.mjs. Pure data plus prompt assembly and
// no I/O, so the whole set can be inspected with --dry-run.

import { MAP_STYLE } from "./prop-set.mjs";

// ---- the shared look ----

// Flat, shadowless and straight down. Every one of these clauses is load
// bearing: a tile with its own baked sunlight fights the light layer drawn
// over it, and a tile with any perspective stops lining up with its
// neighbours the moment the grid repeats it.
// Hand painted, not photographed. The first pass rendered every tile as a
// photograph of a material on a photorealism checkpoint, so 182 independently
// lit photos sat next to each other with luminance from 0.11 to 0.73 and read
// as a texture sampler rather than one map. The reference for what this should
// look like is Inkarnate: painted, flat lit, and harmonised to one palette.
const LOOK =
  "top-down orthographic view straight down, hand painted fantasy battle map art, " +
  "painterly digital illustration, gouache and dry brush, stylised not photographic, " +
  "muted harmonised earthy palette, low saturation, soft flat even lighting, " +
  "no cast shadows, clean readable shapes";

const SEAMLESS_LOOK =
  "seamless repeating tileable texture, one uniform material across the whole frame, " +
  "fills the frame edge to edge, no focal point";

// A fitting is not a material, and the first attempt at one proved it: asking
// for a banded door "seen from directly overhead, centred" produced a round
// iron hatch lying in the floor, because overhead plus centred plus a single
// object is a manhole. A door on a battle map is a floor plan symbol. It
// spans its square between two jambs, so the prompt has to say so, and has to
// say what the door is not.
// Second correction. Framing the door inside a doorway gave a small leaf with
// a lot of floor around it and a lintel shadow baked in, which is a picture of
// a door rather than a door tile. One square of the grid IS the doorway, so
// the door should fill it completely and let the neighbouring wall tiles be
// the jambs.
const DOOR_LOOK =
  "a closed door filling the entire frame from edge to edge, seen from directly above, " +
  "the whole door from top to bottom is the image, not a close up detail of it, " +
  "no surrounding floor and no doorway visible";

// Third correction, and this one is a genuine conflict rather than a bad
// prompt. Seen from straight overhead a flight of stairs really is a row of
// parallel bands, so "stone steps from above, fills the frame" came back as
// cobble paving. What makes a stair read as a stair on a map is the shadow
// line at the lip of every tread, which is exactly the thing the surface
// negative spends its weight suppressing. Spans therefore ask for those
// shadow lines outright, and their negative leaves cast shadow alone.
const SPAN_LOOK =
  "fills the entire frame from edge to edge seen from directly above, " +
  "a row of parallel step treads running horizontally across the full width, " +
  "a crisp dark shadow line along the lip of every tread so the flight reads as descending, " +
  "no surrounding floor and no background visible";

// The handful of fittings that really are a centred thing in a floor: a
// trapdoor, a well mouth, a wheel-locked vault door, a spiral stair.
const OBJECT_LOOK =
  "a single object centred in the frame seen from directly above, " +
  "plain dark stone floor surrounding it, the object fills most of the frame";

// The renders also came back with a heavy vignette and a spotlight the shared
// negative did not hold off, so the fittings carry a weighted top-up. The anti
// round terms only ride along with the spanning framings, which is the whole
// point of splitting them: a vault door and a spiral stair are supposed to be
// circular.
const FITTING_NEGATIVE =
  ", (vignette:1.4), (dramatic lighting:1.4), (cast shadow:1.5), (drop shadow:1.4), " +
  "spotlight, glow, dark corners, floor around the object, empty space, margin";
const ROUND_NEGATIVE = ", round, circular, disc, manhole, hatch, wheel, shield, medallion";
// Deliberately not FITTING_NEGATIVE: a span needs its tread shadows.
const SPAN_NEGATIVE =
  ", (vignette:1.4), (dramatic lighting:1.4), spotlight, dark corners, " +
  "floor around the object, empty space, margin, flat paving, cobblestones, smooth floor" +
  ROUND_NEGATIVE;

// Water gets a framing of its own. Fourth correction, and the costly one: a
// positive prompt that says "no shore, no stones" hands SDXL the words shore
// and stones, and it paints them. Negated nouns go in the negative prompt,
// where the model honours them; the positive describes a close-up of a
// liquid surface and nothing else.
const WATER_LOOK =
  "seamless repeating tileable close-up texture of a liquid surface, one uniform water surface across the whole frame, " +
  "fills the frame edge to edge, no focal point, no composition";
const WATER_NEGATIVE =
  ", shore, shoreline, riverbank, bank, coastline, beach, land, island, rocks, pebbles, stones, boulders, plants, lily pads, leaves, " +
  "grass, reeds, moss, aerial landscape, river shape, pool shape, pond shape, edge, rim, fish, boat, face, skull, eyes, figure, silhouette";

// A material from another setting is still just a material: the setting words
// belong on the fittings (doors, spans, low walls), not on a square of
// asphalt. On surfaces the genre key is dropped from the positive prompt and
// the setting's failure modes go into the negative instead. Cyberpunk taught
// this: "cyberpunk megacity" on a floor came back as neon circuitry and
// aerial skylines, and "road markings" as random yellow stripes.
const GENRE_SURFACE_NEGATIVE = {
  cyberpunk: ", neon, glowing lines, light strips, glow, circuit board, circuitry, wires, city, buildings, skyline, aerial view, rooftops, " +
    "road markings, painted lines, lane markings, stripes, arrows, signs, screens, holograms, machinery, " +
    "cobblestone, flagstones, paving stones, stone blocks, cracked stone, rocks, pebbles, medieval, ancient, rustic, castle, dungeon",
  steampunk: ", city, buildings, skyline, aerial view, rooftops, machinery, gears, signs, glow",
  post_apocalyptic: ", city, buildings, skyline, aerial view, rooftops, road markings, painted lines, signs, vehicles, cobblestone, flagstones, medieval, castle",
  horror: ", city, buildings, skyline, aerial view, rooftops, signs, glow, figures",
  mystery: ", city, buildings, skyline, aerial view, rooftops, signs, glow, lamp posts",
};
const KEYLESS_FRAMINGS = new Set(["surface", "water"]);

// Settings whose seamless materials carry their own style on BOTH stages of
// the pipeline (the SDXL wrapping base and the Flux repaint). Cyberpunk taught
// this on 2026-09-17 and 18: the fantasy look string returned cobblestones, a
// plain base returned grey slabs the repaint could not light, and painting
// with Flux alone looked right but does not wrap on both axes. What works is
// the normal seamless pipeline with this prompt on the base as well, scene
// nouns (street, alley, corridor) kept out of the material words, and "neon"
// taken out of the shared negative for these tiles.
const SETTING_STYLE = {
  cyberpunk:
    "cyberpunk, flat game floor texture swatch seen from directly above, orthographic top-down, the material fills the entire frame uniformly edge to edge, " +
    "no walls, no horizon, no perspective, hand painted digital illustration for a cyberpunk tabletop battle map, painterly, crisp readable shapes, " +
    "dark moody palette with neon accent lighting, seamless repeating texture, no text",
};

// The palette words a setting's materials share. On a genre surface these
// replace the fantasy style: "hand painted fantasy battle map art, earthy
// palette" made a photo model paint cobblestones for asphalt and for steel
// grating alike, so the base is asked for plainly (material first, no art
// words) and only the Flux repaint carries the painterly look.
const GENRE_PALETTE = {
  cyberpunk: "modern industrial materials, cool grey concrete, dark steel and wet tarmac tones, present day or near future, nothing medieval",
  steampunk: "Victorian industrial materials, brass, riveted iron, soot and oak tones",
  post_apocalyptic: "ruined modern materials, rust, bleached concrete and dust tones, present day, nothing medieval",
  horror: "cold desaturated materials, bone, rot and shadow tones",
  mystery: "Victorian city materials, sepia, soot and gaslight tones",
};
const GENRE_STYLE =
  "hand painted tabletop game art, painterly digital illustration, gouache and dry brush, stylised not photographic, " +
  "muted harmonised palette, low saturation, soft flat even lighting, no cast shadows, clean readable shapes";


const FRAMINGS = {
  surface: { look: SEAMLESS_LOOK, negative: "" },
  water: { look: WATER_LOOK, negative: WATER_NEGATIVE },
  door: { look: DOOR_LOOK, negative: FITTING_NEGATIVE + ROUND_NEGATIVE },
  span: { look: SPAN_LOOK, negative: SPAN_NEGATIVE },
  object: { look: OBJECT_LOOK, negative: FITTING_NEGATIVE },
};

// The inverse of the look, plus the two failure modes this kind of prompt
// invites: the model framing the texture as a photograph (border, vignette,
// watermark) and the model turning one material into a sample sheet of many.
const NEGATIVE =
  "perspective, three quarter view, isometric, angled view, tilted, horizon, sky, wall corner, " +
  "vignette, border, frame, matte, rounded corners, drop shadow, " +
  "text, letters, watermark, signature, logo, label, ruler, scale bar, " +
  "person, people, character, creature, face, hands, spider, arachnid, insect, animal, " +
  "blur, depth of field, bokeh, dramatic lighting, hard shadow, sunbeam, lens flare, " +
  "collage, contact sheet, grid of images, multiple panels, split frame, " +
  "low detail, flat vector, cartoon outline, oversaturated, garish, neon, " +
  "photograph, photorealistic, hdr, 3d render, " +
  "ink outline, line art, black outlines, comic book, cel shaded, sketch, engraving";

// ---- the terrain roles ----

// What the engine does with a tile. The editor groups the palette by these,
// and `terrain` is the character the map string actually stores, so the set
// can grow to any size without the rules learning a new symbol.
export const CATEGORIES = {
  floor: { framing: "surface", label: "Floor", terrain: "floor", seamless: true, blurb: "Clear ground. Costs one square to cross." },
  wall: { framing: "surface", label: "Wall", terrain: "wall", seamless: true, blurb: "Blocks movement and line of sight." },
  water: { framing: "water", label: "Water", terrain: "water", seamless: true, blurb: "Liquid. Wade, swim, or keep out." },
  rough: { framing: "surface", label: "Rough ground", terrain: "difficult", seamless: true, blurb: "Difficult terrain: half speed." },
  hazard: { framing: "surface", label: "Hazard", terrain: "difficult", seamless: true, blurb: "Difficult, and it hurts to stand in." },
  chasm: { framing: "surface", label: "Chasm", terrain: "wall", seamless: true, blurb: "A hole. Impassable without flight." },
  lowwall: { framing: "surface", label: "Low wall", terrain: "lowwall", seamless: true, blurb: "Half cover. Blocks movement, not sight." },
  door: { label: "Door", terrain: "door", seamless: false, framing: "door", blurb: "A portal that can open, close and lock." },
  stair: { label: "Stair and span", terrain: "floor", seamless: false, framing: "span", blurb: "Level changes and crossings." },
};

// ---- the materials ----
//
// [id, prompt detail, themes] where themes are the MapTheme keys in
// src/lib/battlemap/generate.ts this material belongs to, so the editor can
// offer a forest DM the twenty tiles that suit a forest first.

const MATERIALS = {
  floor: [
    ["flagstone-granite", "worn grey granite flagstone slabs, dark mortar joints, fine hairline cracks", "cave interior"],
    ["flagstone-sandstone", "pale sandstone flagstones, sandy grout, chipped edges", "interior riverside"],
    ["flagstone-cracked", "badly cracked stone flagstones, missing chips, dirt in the gaps", "cave interior"],
    ["cobblestone-street", "rounded cobblestones set in sand, irregular sizes, packed tight", "interior field"],
    ["cobblestone-wet", "wet rounded cobblestones, damp sheen, dark water in the joints", "interior riverside"],
    ["marble-polished", "polished white marble floor with grey veining, faint joint lines", "interior"],
    ["marble-black", "polished black marble floor with pale gold veining", "interior"],
    ["mosaic-temple", "ornate geometric mosaic floor of small coloured tesserae, faded", "interior"],
    ["mosaic-broken", "broken mosaic floor, missing tesserae, bare mortar patches", "interior"],
    ["wood-plank-worn", "worn pale oak floorboards, visible grain, gaps and old nail heads", "interior"],
    ["wood-plank-dark", "dark stained wooden floorboards, deep grain, tight seams", "interior"],
    ["wood-parquet", "herringbone parquet wood floor, warm brown, waxed", "interior"],
    ["ship-deck", "caulked ship deck planking, tar seams, salt bleached wood", "interior riverside"],
    ["dirt-packed", "hard packed brown earth, small embedded pebbles, faint footprint scuffs", "cave field forest"],
    ["dirt-cracked", "dry cracked clay earth, deep crazed fissures, dusty", "field"],
    ["gravel-grey", "loose grey gravel chippings, even scatter, angular stones", "cave field"],
    ["sand-desert", "fine wind rippled desert sand, pale gold", "field"],
    ["sand-beach", "damp coarse beach sand, shell fragments, faint tide ripples", "riverside"],
    ["mud-flat", "smooth wet brown mud, glossy, shallow puddles", "swamp riverside"],
    ["grass-meadow", "short green meadow grass, dense, a few tiny wildflowers", "field forest"],
    ["grass-dry", "dry straw coloured grass, sparse, bare soil showing through", "field"],
    ["grass-dark", "lush dark green forest grass, deep and uneven", "forest"],
    ["moss-stone", "flat stones almost buried under thick bright green moss", "forest cave swamp"],
    ["leaf-litter", "fallen autumn leaves in brown and rust over dark soil", "forest"],
    ["pine-needles", "dry brown pine needle forest floor, scattered cones", "forest"],
    ["peat-swamp", "black waterlogged peat, matted dead reeds pressed flat", "swamp"],
    ["snow-packed", "packed trodden snow, blue grey shadowed dimples", "field"],
    ["ice-sheet", "smooth clear ice over dark water, fine white stress fractures", "riverside field"],
    ["ice-glacier", "deep blue glacier ice, milky banding, frosted surface", "cave"],
    ["ash-grey", "fine grey volcanic ash, soft drifts, a few black cinders", "cave field"],
    ["basalt-columns", "hexagonal basalt column tops fitted together, dark charcoal", "cave"],
    ["obsidian-glass", "black volcanic glass floor, glossy conchoidal fracture facets", "cave"],
    ["cave-rock-smooth", "smooth water worn cave rock, pale mineral staining, damp", "cave"],
    ["cave-rock-rough", "rough broken cave bedrock, shallow ridges and rubble", "cave"],
    ["crystal-floor", "floor of pale violet crystal facets, faint internal glow", "cave"],
    ["bone-floor", "floor paved with old bones and skull fragments, ivory and grey", "cave interior"],
    ["fungal-mat", "spongy grey fungal mat, small pale toadstools, faint bioluminescence", "cave swamp"],
    ["carpet-red", "deep red woven carpet with a gold ornamental border pattern, worn nap", "interior"],
    ["carpet-blue", "faded indigo woven rug, threadbare patches, tasselled weave", "interior"],
    ["brick-red", "red clay paving bricks in a running bond, pale mortar", "interior field"],
    ["brick-pale", "pale yellow clay pavers, sandy joints, sun bleached", "interior field"],
    ["terracotta-tile", "square terracotta floor tiles, warm orange, chipped corners", "interior"],
    ["slate-tile", "dark blue grey slate floor tiles, riven surface, thin joints", "interior"],
    ["metal-grate", "heavy iron floor grating over darkness, rusted bars", "interior cave"],
    ["metal-plate", "riveted iron deck plates, oiled dark steel, diamond tread", "interior"],
    ["sewer-brick", "wet green stained sewer brickwork, slime in the joints", "interior cave"],
    ["blood-stained", "grey stone floor with dried dark blood spatter and drag smears", "interior cave"],
    ["rune-stone", "grey stone floor incised with faintly glowing arcane runes", "interior cave"],
    ["tomb-slab", "large engraved tomb slabs, worn relief carving, dust in the lines", "interior"],
    ["thatch-reed", "flattened woven reed matting floor, dry straw colour", "interior swamp"],
    ["coral-floor", "pale dead coral floor, porous branching texture, sand in the hollows", "riverside"],
    ["salt-flat", "cracked white salt crust in polygonal plates", "field"],
    ["tilled-soil", "freshly tilled dark farm soil in straight furrows", "field"],
  ],
  wall: [
    ["wall-castle-block", "large fitted granite castle blocks seen from above, deep mortar courses", "interior"],
    ["wall-dungeon-mossy", "old dungeon stone blockwork, green moss and damp in every joint", "interior cave"],
    ["wall-granite-hewn", "roughly hewn granite masonry, chisel marks, uneven courses", "interior cave"],
    ["wall-sandstone-carved", "carved sandstone blockwork with a shallow frieze pattern", "interior"],
    ["wall-marble-panel", "polished marble wall panels with fluted pilasters", "interior"],
    ["wall-brick-red", "red brick wall top, running bond, weathered pointing", "interior"],
    ["wall-stucco", "cracked white lime plaster over stone, patches fallen away", "interior"],
    ["wall-adobe", "sun dried adobe mud brick, straw flecks, rounded edges", "interior field"],
    ["wall-wood-log", "stacked horizontal log wall ends, bark and chinking", "interior forest"],
    ["wall-wood-plank", "vertical board and batten timber wall, weathered grey", "interior"],
    ["wall-bamboo", "tight lashed bamboo pole wall, pale green culms", "forest swamp"],
    ["wall-thatch", "thick thatched reed wall bundle, cut ends outward", "interior swamp"],
    ["wall-cave-rock", "solid cave rock face from above, lumpy stone, mineral streaks", "cave"],
    ["wall-earth-cut", "cut earth bank studded with roots and stones", "forest field"],
    ["wall-volcanic", "rough black volcanic rock, sharp vesicular texture", "cave"],
    ["wall-obsidian", "wall of black volcanic glass, glossy sharp facets", "cave"],
    ["wall-crystal", "wall of jagged pale blue crystal prisms", "cave"],
    ["wall-ice", "wall of thick cloudy blue ice, frosted, deep fractures", "cave field"],
    ["wall-iron-plate", "riveted iron wall plating, streaked rust, heavy bolts", "interior"],
    ["wall-bone-ossuary", "ossuary wall packed with stacked skulls and long bones", "interior cave"],
    ["wall-rubble-collapsed", "collapsed masonry rubble pile, broken blocks and dust", "interior cave"],
    ["wall-ruined-overgrown", "ruined stone wall top swallowed by ivy and creepers", "forest field"],
    ["wall-fungal", "stone wall smothered in shelf fungus and pale growths", "cave swamp"],
    ["wall-hedge-dense", "dense dark clipped hedge from above, tight small leaves", "field forest"],
    ["wall-tree-canopy", "dense forest canopy from directly above, layered dark green foliage", "forest swamp"],
    ["wall-mangrove", "tangled mangrove trunks and aerial roots from above", "swamp"],
    ["wall-mine-timber", "mine gallery wall shored with rough timber props, dark rock behind", "cave"],
    ["wall-sewer-stone", "curved sewer stonework, wet, dark algae staining", "interior cave"],
    ["wall-tomb-relief", "tomb wall of carved hieroglyph relief panels, sand dusted", "interior"],
    ["wall-runic-arcane", "dark stone wall cut with glowing violet arcane sigils", "interior cave"],
    ["wall-coral-reef", "living reef wall of branching coral, muted pink and ochre", "riverside"],
    ["wall-palisade", "sharpened timber palisade stake tops packed together", "field forest"],
  ],
  water: [
    ["water-shallow-clear", "uniform clear turquoise water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, bright caustic light patterns", "riverside forest"],
    ["water-deep-blue", "uniform deep blue lake water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, slightly darker patches", "riverside"],
    ["water-river-flowing", "uniform blue green river water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, streaming current lines and a few white riffles", "riverside"],
    ["water-sea-waves", "uniform deep sea blue water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, low choppy waves with a few white foam flecks", "riverside"],
    ["water-swamp-murky", "uniform murky green brown swamp water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, a few floating duckweed specks", "swamp"],
    ["water-lily-pads", "uniform dark green pond water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, green lily pads floating on it", "swamp"],
    ["water-reed-shallows", "uniform shallow olive water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, standing green reed stems rising through it", "swamp riverside"],
    ["water-cave-pool", "uniform dark blue green water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, dim and cold", "cave"],
    ["water-hot-spring", "uniform milky turquoise water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, wisps of white steam", "cave field"],
    ["water-icy-slush", "uniform dark grey slush water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, floating plates of pale ice", "riverside field"],
    ["water-frozen-cracked", "a frozen water surface filling the entire frame, seen from directly above, pale blue ice plates shifted apart with dark water in the cracks", "riverside"],
    ["water-sewer-sludge", "uniform olive green sewer water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, an oily rainbow film and floating froth", "interior cave"],
    ["water-tar-black", "uniform thick black tar water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, a few slow round bubbles", "swamp cave"],
    ["water-blood-pool", "uniform dark red blood water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, glossy", "interior cave"],
    ["water-flooded-floor", "uniform shallow pale blue green water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, soft caustic light patterns", "interior cave"],
  ],
  rough: [
    ["rough-rubble-scree", "loose broken stone rubble and scree, angular fragments", "cave field"],
    ["rough-bramble", "a dense thicket of dark thorny bramble stems and small leaves covering the whole ground, tangled barbed canes, no clearings", "forest field"],
    ["rough-tall-grass", "waist high tall grass from above, dense tussocks, seed heads", "field swamp"],
    ["rough-reed-bed", "thick reed bed from above, packed vertical stems and mud", "swamp riverside"],
    ["rough-mud-churned", "thick brown mud churned into deep overlapping ruts and hollows filled with muddy water, glossy and wet, empty ground", "swamp field"],
    ["rough-snow-deep", "deep unbroken powder snow with soft wind sculpted drifts", "field"],
    ["rough-roots-tangled", "mat of thick tangled tree roots over dark soil", "forest swamp"],
    ["rough-ash-drifts", "soft deep grey ash dunes and powder drifts, a very few dull dark cinder lumps, mostly pale grey ash", "cave"],
    ["rough-bone-scatter", "dark earth strewn with dull weathered bones, ribs and long bones, muted bone grey, no bright highlights", "cave field"],
    ["rough-debris-crates", "smashed crates, splintered boards and spilled straw", "interior"],
    ["rough-pottery-shards", "hundreds of broken curved terracotta pot fragments and jagged shards piled and scattered across the ground", "interior"],
    ["rough-cactus-scrub", "many small desert scrub bushes and several low barrel cacti scattered evenly over red grit", "field"],
    ["rough-fungal-cluster", "clustered pale cave mushrooms of many sizes, spongy ground", "cave swamp"],
    ["rough-spider-webs", "thick grey spider webbing sheeting the ground, dense tangled silk strands, dust laden, empty", "cave interior"],
    ["rough-ice-rubble", "broken ice rubble and refrozen shards underfoot", "field cave"],
    ["rough-driftwood", "tangled bleached driftwood and dry kelp over shingle", "riverside"],
    ["rough-boulder-field", "close packed low boulders with gaps of grit between", "cave field"],
    ["rough-vine-choked", "floor choked with thick creeping vines and dead leaves", "forest swamp"],
  ],
  hazard: [
    ["hazard-lava-molten", "molten lava, bright orange fissures through a black crust", "cave"],
    ["hazard-embers-coals", "bed of glowing orange coals under grey ash", "cave interior"],
    ["hazard-acid-pool", "bubbling acid green pool, etched pitted stone rim", "cave interior"],
    ["hazard-green-slime", "translucent green slime spread over stone, dripping strands", "cave interior"],
    ["hazard-spike-pit", "hundreds of long rusted iron spikes standing point upward packed close together, a bed of sharp metal spearpoints", "interior cave"],
    ["hazard-caltrops", "hundreds of small rusted iron caltrops, each a cluster of four sharp spikes, scattered thickly over flagstones", "interior"],
    ["hazard-thorn-vines", "writhing woody vines covered in long sharp thorns, dense tangle over dark ground", "forest swamp"],
    ["hazard-glyph-trap", "stone floor with a burning red circular warding glyph", "interior cave"],
    ["hazard-electrified", "iron floor plate crawling with arcing blue electricity", "interior"],
    ["hazard-quicksand", "wet pale quicksand, glossy saturated surface, a sunken swirling depression with standing water", "swamp riverside"],
    ["hazard-corrupted-flesh", "pulsing red corrupted flesh growth over stone", "cave interior"],
    ["hazard-frost-rime", "brittle blue rime frost spikes growing over the floor", "cave field"],
  ],
  chasm: [
    ["chasm-dark-pit", "a sheer sided pit of total blackness filling most of the frame, a narrow lip of broken stone around the edge", "cave interior"],
    ["chasm-rocky-crevasse", "deep rocky crevasse, layered strata walls falling into shadow", "cave field"],
    ["chasm-collapsed-floor", "floor collapsed into a ragged hole, broken slabs tipping in", "interior cave"],
    ["chasm-void-starry", "hole opening onto a starfield void, violet nebula haze", "interior cave"],
    ["chasm-ice-crevasse", "narrow glacier crevasse, blue walls narrowing into black", "field cave"],
    ["chasm-lava-fissure", "split in the floor showing molten lava far below", "cave"],
  ],
  lowwall: [
    ["lowwall-stone-parapet", "low stone parapet wall top, capped coping stones", "interior field"],
    ["lowwall-broken-stub", "knee high stub of a broken stone wall, rubble core exposed", "interior field"],
    ["lowwall-wood-fence", "low rough timber rail fence from above, weathered grey", "field forest"],
    ["lowwall-picket-fence", "low white picket fence from above, pointed pale slats", "field"],
    ["lowwall-iron-railing", "ornate low wrought iron railing from above, black spearheads", "interior"],
    ["lowwall-hedge-low", "low clipped box hedge from above, dense small leaves", "field interior"],
    ["lowwall-log-barricade", "barricade of stacked felled logs, cut ends and bark", "forest field"],
    ["lowwall-sandbag", "stacked burlap sandbag wall from above, sagging rows", "field interior"],
    ["lowwall-crate-stack", "stacked wooden crates seen from above, banded lids", "interior"],
    ["lowwall-barrel-row", "row of wooden barrels from above, iron hoops and lids", "interior"],
    ["lowwall-rubble-heap", "waist high heap of masonry rubble and broken blocks", "interior cave"],
    ["lowwall-pew-bench", "long carved wooden bench pew from above, dark polished oak", "interior"],
    ["lowwall-market-counter", "market stall counter from above, planks and spilled goods", "interior field"],
    ["lowwall-bookshelf", "top of a long bookshelf packed with old books", "interior"],
    ["lowwall-sarcophagus", "carved stone sarcophagus lid from above, relief effigy", "interior"],
    ["lowwall-altar-block", "low carved stone altar block, stained channel, worn relief", "interior cave"],
    ["lowwall-cart", "wooden hand cart from above, spoked wheels and load bed", "field interior"],
    ["lowwall-stalagmite-row", "row of squat broken stalagmite stumps", "cave"],
  ],
  door: [
    ["door-wood-iron-banded", "heavy oak door with black iron bands and a ring handle", "interior cave"],
    ["door-wood-plain", "plain planked wooden door with a simple latch", "interior"],
    ["door-double-ornate", "ornate carved double doors with gilded scrollwork", "interior"],
    ["door-stone-slab", "massive plain stone slab door, seams packed with dust", "interior cave"],
    ["door-iron-reinforced", "riveted iron door, rusted, heavy hinges and a slot", "interior"],
    ["door-cell-bars", "iron barred prison cell gate, thick vertical bars", "interior"],
    ["door-portcullis", "iron portcullis grid, spiked bottom points", "interior"],
    ["door-vault-round", "round metal vault door with a spoked locking wheel", "interior", "object"],
    ["door-secret-stone", "stone wall panel ajar revealing a hidden gap", "interior cave"],
    ["door-trapdoor-wood", "square wooden trapdoor in a floor, iron ring pull", "interior", "object"],
    ["door-curtain-beaded", "many long vertical strands of small round wooden beads hanging close together as a door curtain", "interior"],
    ["door-arcane-portal", "arched stone frame filled with rippling violet arcane light", "interior cave"],
    ["door-cave-mouth", "a dark jagged opening into a cave, black void in the centre filling most of the frame, rough rock rim around the edge", "cave forest"],
    ["door-gate-timber", "a tall studded timber gate of heavy vertical planks with iron strapwork and bolt heads, flat frontal view", "interior field"],
    ["door-rotted-broken", "a rotted wooden door with splintered broken planks, jagged holes punched through it, rusted hinges", "interior cave"],
    ["door-webbed-shut", "dense white cobweb silk completely covering an old wooden door, thick matted layers of spider silk, empty", "cave interior"],
  ],
  stair: [
    ["stair-stone-straight", "straight flight of worn stone steps seen from above", "interior cave"],
    ["stair-stone-spiral", "a single turn of a spiral stone stair, wedge shaped treads around one central newel post, floor visible at the outer corners", "interior", "object"],
    ["stair-wood-straight", "a wooden staircase, parallel plank treads with a deep dark shadow gap at the lip of every step", "interior"],
    ["stair-carved-rock", "steps roughly carved into cave bedrock, uneven", "cave"],
    ["stair-grand-landing", "broad grand stone stair with a balustrade, from above", "interior"],
    ["ramp-earth", "a smooth unbroken slope of packed brown earth, a continuous incline with no steps at all, timber kerb boards along each side", "field cave"],
    ["bridge-rope-planks", "rope and plank bridge, wide dark gaps between the boards showing the drop below, rope handrails along both long edges", "cave forest"],
    ["bridge-stone-arch", "narrow stone arch bridge span from above, parapet either side", "riverside field"],
    ["bridge-wood-timber", "heavy timber bridge decking, dark gaps between the beams showing water below", "riverside forest"],
    ["bridge-fallen-log", "a huge fallen tree trunk crossing as a bridge, thick mossy bark along its length, dark drop either side", "forest swamp"],
    ["ladder-wood", "wooden ladder lying against a floor opening, from above", "interior cave", "object"],
    ["well-shaft", "round stone well mouth from above, dark water far below", "interior field", "object"],
  ],
};

// ---- the other settings ----
//
// A campaign's genre (src/lib/genres.ts) picks a set of its own, so a
// cyberpunk table never fights in a stone dungeon. Same categories, same six
// terrain characters, a `genre` tag so the palette groups them and the
// default skins resolve by (genre, theme). Dark fantasy and custom use the
// fantasy set.
const GENRE_MATERIALS = {
  cyberpunk: {
    floor: [
      ["cp-asphalt-wet", "rain slick black asphalt tarmac, glossy wet surface covered in shallow puddles that reflect blurred pink and cyan neon light", "interior field riverside"],
      ["cp-concrete-plaza", "grimy dark concrete floor slabs stained with oil and rainwater, a faint magenta and teal neon sheen on the wet patches", "interior field"],
      ["cp-steel-grating", "industrial steel floor grating, a regular square mesh of dark metal bars, an even dim teal glow behind the whole mesh at the same brightness everywhere, no bright spot", "interior"],
      ["cp-deck-plating", "dark gunmetal sci-fi floor plating, large rectangular steel panels with bolted seams, a few thin recessed cyan light strips along panel edges, scuffed and oily", "interior"],
      ["cp-holo-tile", "glossy black hexagonal tech floor tiles with thin glowing magenta seams between them, nightclub floor", "interior"],
      ["cp-rubber-mat", "black diamond plate rubber floor matting with worn yellow edge trim panels, workshop floor", "interior"],
      ["cp-alley-trash", "wet dark alley ground littered with cables, flattened cans and wrappers, puddles reflecting cyan and magenta neon", "interior field"],
      ["cp-server-floor", "pale grey raised data centre floor tiles with perforated vent panels and thin blue LED guide strips between the tiles", "interior"],
      ["cp-rooftop-gravel", "dark rooftop gravel and tar paper with puddles reflecting pink neon, a few vent stubs", "field"],
    ],
    wall: [
      ["cp-wall-chrome", "the flat top of a wall of brushed chrome and dark steel panels with thin glowing blue seams", "interior"],
      ["cp-wall-neon", "the flat top of a wall crowded with neon tube signs and cable runs glowing pink, cyan and violet, abstract shapes only", "interior field"],
      ["cp-wall-concrete-barrier", "the flat top of thick dark concrete wall blocks with faded black and yellow hazard chevrons and a thin amber warning light strip", "interior field"],
      ["cp-wall-chainlink", "chain link fence mesh with coils of razor wire over dark ground, a faint red glow", "field"],
      ["cp-wall-container", "the corrugated steel roofs of stacked shipping containers, rusted teal and orange paint, lit by magenta neon", "field interior"],
      ["cp-wall-server-rack", "the tops of rows of black server racks with cable trays and small blinking blue and green status lights", "interior"],
      ["cp-wall-glass", "the top edge of dark tinted glass partitions in black steel frames with a thin cyan edge glow", "interior"],
      ["cp-wall-pipes", "a dense run of dark industrial pipes and ducting with yellow warning bands and small amber indicator lights", "interior"],
    ],
    water: [
      ["cp-coolant", "a pool of glowing cyan coolant liquid, smooth surface with gentle ripples and soft bright highlights, only liquid in the frame", "interior", "surface"],
      ["cp-oil-slick", "black rain water with an iridescent oil film swirling in purple, teal and pink, gentle ripples, only liquid in the frame", "interior field", "surface"],
      ["cp-toxic-runoff", "glowing acid green toxic runoff liquid with slow bubbles and gentle ripples, only liquid in the frame", "interior field", "surface"],
    ],
    rough: [
      ["cp-cable-tangle", "a dense tangle of black cables, wires and connectors covering a dark floor, a few tiny glowing blue and red LEDs", "interior"],
      ["cp-scrap-electronics", "a dark floor covered in broken green circuit boards, chips and shattered screens with faint flickering glow", "interior field"],
      ["cp-broken-glass", "shattered safety glass cubes and shards across dark concrete, glinting with pink and cyan neon reflections", "interior field"],
      ["cp-rubble-concrete", "broken dark concrete chunks with bent rebar and dust, a faint teal neon rim light", "field interior"],
    ],
    hazard: [
      ["cp-electrified-floor", "dark steel floor plates crawling with arcing bright blue electricity", "interior"],
      ["cp-acid-spill", "a bubbling glowing green chemical spill eating into dark concrete", "interior"],
      ["cp-fire-jet", "dark steel floor vents with jets of blue flame and heat glow", "interior"],
    ],
    chasm: [["cp-elevator-shaft", "a sheer drop straight down a dark square elevator shaft, cables and rings of small red and cyan lights receding into blackness below", "interior"]],
    lowwall: [
      ["cp-lowwall-crash-barrier", "a low concrete crash barrier with hazard stripes", "interior field"],
      ["cp-lowwall-console", "a low bank of computer consoles with glowing screens, seen from above", "interior"],
      ["cp-lowwall-crates", "stacked black plastic cargo crates with orange latches", "interior field"],
      ["cp-lowwall-vending", "a row of glowing vending machines, seen from above", "interior"],
    ],
    door: [
      ["cp-door-blast", "a heavy steel blast door leaf with a glowing red seam and warning stripes, flat front view of the door only, no floor, no corridor", "interior"],
      ["cp-door-sliding-glass", "a sliding frosted glass door leaf with a glowing cyan frame, flat front view of the door only, no floor, no corridor", "interior"],
      ["cp-door-cage", "a rolling steel security shutter door leaf with a small amber light, flat front view of the door only, no floor, no corridor", "interior field"],
    ],
    stair: [
      ["cp-stair-steel", "a flight of open steel grating stairs seen from above, yellow edge strips", "interior"],
      ["cp-catwalk", "a steel catwalk grating bridge with railings, seen from above", "interior"],
    ],
  },
  steampunk: {
    floor: [
      ["sp-brass-plate", "riveted brass floor plates, warm polished metal, scuffed", "interior"],
      ["sp-iron-plate", "riveted dark iron floor plates with oil stains", "interior"],
      ["sp-cobbles-gaslit", "Victorian cobblestones, dark and wet, gaslight reflections", "interior field"],
      ["sp-parquet", "polished herringbone parquet floor, warm oak", "interior"],
      ["sp-workshop-boards", "oil stained workshop floorboards with sawdust and metal filings", "interior"],
      ["sp-airship-deck", "varnished airship deck planking with brass fittings", "interior"],
      ["sp-tiles-victorian", "black and white Victorian encaustic floor tiles, worn", "interior"],
    ],
    wall: [
      ["sp-wall-boiler", "a wall of riveted boiler plate with brass pipes and pressure gauges", "interior"],
      ["sp-wall-brick-soot", "soot blackened Victorian brick wall top", "interior field"],
      ["sp-wall-gears", "a wall of interlocking brass and iron gears and cogs", "interior"],
      ["sp-wall-iron-lattice", "a wrought iron lattice wall with rivets, seen from above", "interior field"],
      ["sp-wall-pipes-copper", "a bundle of copper pipes and valves with steam leaks", "interior"],
      ["sp-wall-panelled", "dark mahogany panelled wall with brass sconces, seen from above", "interior"],
    ],
    water: [
      ["sp-water-canal", "uniform dark sooty canal water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, faint warm gaslight reflections", "riverside interior"],
      ["sp-steam-pool", "uniform pale turquoise hot water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, drifting wisps of white steam", "interior"],
      ["sp-oil-tank", "uniform dark machine oil water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, glossy", "interior"],
    ],
    rough: [
      ["sp-gear-scrap", "ground covered in loose brass gears, springs and bolts", "interior"],
      ["sp-coal-heap", "loose black coal lumps and dust", "interior field"],
      ["sp-pipe-debris", "broken copper pipes and valves scattered on iron plate", "interior"],
    ],
    hazard: [
      ["sp-steam-vent", "iron floor grates blasting clouds of hot white steam", "interior"],
      ["sp-furnace-coals", "a bed of glowing orange furnace coals under an iron grate", "interior"],
    ],
    chasm: [["sp-gear-pit", "a deep pit of turning gears and shafts vanishing into darkness", "interior"]],
    lowwall: [
      ["sp-lowwall-pipe-rail", "a low brass pipe railing with valve wheels, seen from above", "interior"],
      ["sp-lowwall-crate-row", "a row of iron banded shipping crates stencilled with numbers", "interior field"],
      ["sp-lowwall-workbench", "a long iron workbench covered in tools and gears, seen from above", "interior"],
    ],
    door: [
      ["sp-door-iron-hatch", "a round riveted iron hatch door with a spoked wheel, filling the frame", "interior", "object"],
      ["sp-door-brass", "an ornate brass door with rivets and a pressure gauge, filling the frame", "interior"],
      ["sp-door-cage-lift", "an iron cage lift gate, folding lattice, filling the frame", "interior"],
    ],
    stair: [
      ["sp-stair-iron-spiral", "a single turn of a wrought iron spiral stair with a central post, seen from above", "interior", "object"],
      ["sp-gangway", "a brass and timber gangway bridge with rope rails, seen from above", "interior field"],
    ],
  },
  post_apocalyptic: {
    floor: [
      ["pa-asphalt-cracked", "cracked grey asphalt with weeds in the cracks and faded lane paint", "field interior"],
      ["pa-rusted-plate", "rusted orange iron floor plates, flaking", "interior"],
      ["pa-ash-dust", "grey ash and dust ground with a few tyre track ruts and footprints pressed into it", "field cave"],
      ["pa-dead-earth", "cracked dead earth, bleached, a few dry weeds", "field"],
      ["pa-linoleum", "stained peeling linoleum floor of an abandoned building, dust", "interior"],
      ["pa-bunker-concrete", "stained grey bunker concrete floor with a small square drain grate and water stains", "interior cave"],
      ["pa-glass-litter", "ground covered in broken glass, grit and paper litter", "interior field"],
    ],
    wall: [
      ["pa-wall-car-wrecks", "a barricade of rusted wrecked cars stacked on each other, seen from above", "field interior"],
      ["pa-wall-rubble-barricade", "a barricade of concrete rubble, rebar and sandbags", "field interior"],
      ["pa-wall-corrugated", "a fence of rusted corrugated iron sheets, seen from above", "field"],
      ["pa-wall-container-rust", "rusted shipping containers with graffiti, seen from above", "field interior"],
      ["pa-wall-ruined-brick", "crumbling brick wall top with scorch marks and weeds", "interior field"],
      ["pa-wall-tyres", "a wall of stacked old tyres, seen from above", "field"],
    ],
    water: [
      ["pa-toxic-sludge", "uniform glowing green sludge water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, bubbles and a chemical film", "field interior"],
      ["pa-oil-pool", "uniform black crude oil water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, glossy, a little floating debris", "field"],
      ["pa-rust-water", "uniform rust brown stagnant water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, a rusty film", "riverside interior"],
    ],
    rough: [
      ["pa-scrap-field", "a field of rusted scrap metal, car parts and wire", "field"],
      ["pa-bone-dust", "grey dust with bleached bones and skulls", "field cave"],
      ["pa-debris-plaster", "fallen plaster, broken furniture and dust inside a ruin", "interior"],
      ["pa-tyre-heap", "a loose heap of old tyres and rubber", "field"],
    ],
    hazard: [
      ["pa-radiation-glow", "cracked ground glowing sickly green with radiation", "field cave"],
      ["pa-burning-debris", "burning rubble with orange flames and black smoke", "field interior"],
      ["pa-razor-wire", "coils of rusted razor wire covering the ground", "field"],
    ],
    chasm: [["pa-sinkhole", "a ragged sinkhole in asphalt dropping into darkness with hanging pipes", "field interior"]],
    lowwall: [
      ["pa-lowwall-sandbags", "a low wall of stacked sandbags, torn and leaking", "field interior"],
      ["pa-lowwall-tyre-row", "a low row of stacked tyres", "field"],
      ["pa-lowwall-car-body", "a burnt out car body, seen from above", "field"],
      ["pa-lowwall-junk-fence", "a low fence of scrap metal and pallets", "field interior"],
    ],
    door: [
      ["pa-door-welded", "a steel door welded from scrap plates with a chain and padlock, filling the frame", "interior field"],
      ["pa-door-chain-gate", "a chain link gate with a rusted lock, filling the frame", "field"],
      ["pa-door-bunker", "a heavy round bunker blast door with a wheel lock, filling the frame", "interior", "object"],
    ],
    stair: [
      ["pa-stair-concrete", "a cracked concrete stair with rusted rebar rails, seen from above", "interior"],
      ["pa-bridge-plank", "a bridge of scaffolding planks and steel beams over a drop, seen from above", "field interior"],
    ],
  },
  horror: {
    floor: [
      ["hr-boards-rotten", "rotting dark floorboards with gaps, mould and stains", "interior"],
      ["hr-tiles-blood", "cracked white bathroom tiles smeared with dried blood", "interior"],
      ["hr-flagstone-wet", "wet black flagstones with dark seepage in the joints", "interior cave"],
      ["hr-flesh-floor", "a floor of pulsing red flesh with veins and sinew", "interior cave"],
      ["hr-carpet-rotting", "a rotting red carpet, mildewed and threadbare", "interior"],
      ["hr-grave-earth", "freshly dug dark grave earth with bone fragments", "field"],
      ["hr-hospital-lino", "stained green hospital linoleum, dim and grimy", "interior"],
    ],
    wall: [
      ["hr-wall-flesh", "a wall of red flesh, teeth and veins, glistening", "interior cave"],
      ["hr-wall-mould-brick", "black mould covered brick wall top, dripping", "interior"],
      ["hr-wall-boarded", "a wall of nailed rotting planks, seen from above", "interior"],
      ["hr-wall-hedge-dead", "a dense dead thorny hedge, seen from above", "field"],
      ["hr-wall-bone", "a wall packed with bones and skulls, seen from above", "interior cave"],
      ["hr-wall-padded", "a stained padded asylum wall, seen from above", "interior"],
    ],
    water: [
      ["hr-blood-pool", "uniform dark red blood water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, glossy", "interior cave"],
      ["hr-black-water", "uniform still black water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, a faint dull sheen", "interior riverside swamp"],
      ["hr-bile-pool", "uniform yellow green bile water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, bubbles and floating scum", "interior cave"],
    ],
    rough: [
      ["hr-bone-heap", "a heap of human bones and skulls", "interior cave"],
      ["hr-rot-debris", "rotting refuse, rags and maggots", "interior"],
      ["hr-thorn-dead", "a mat of dead black thorns", "field"],
      ["hr-viscera", "glistening entrails and gore over stone", "interior cave"],
    ],
    hazard: [
      ["hr-hellfire", "black stone split by glowing crimson hellfire cracks", "interior cave"],
      ["hr-spike-pit-bloody", "rusted iron spikes stained with blood, packed close", "interior"],
      ["hr-tendrils", "writhing black tendrils rising from the ground", "interior cave"],
    ],
    chasm: [["hr-abyss-eyes", "a black abyss with faint glowing eyes far below", "interior cave"]],
    lowwall: [
      ["hr-lowwall-pews", "a row of rotting church pews, seen from above", "interior"],
      ["hr-lowwall-cages", "a row of rusted iron cages, seen from above", "interior"],
      ["hr-lowwall-coffins", "a row of open coffins, seen from above", "interior field"],
      ["hr-lowwall-gurneys", "a row of stained hospital gurneys, seen from above", "interior"],
    ],
    door: [
      ["hr-door-nailed", "a rotting door nailed shut with planks, filling the frame", "interior"],
      ["hr-door-iron-gate", "a rusted iron gate with spikes and chains, filling the frame", "interior field"],
      ["hr-door-flesh", "a doorway sealed by a membrane of flesh, filling the frame", "interior cave"],
    ],
    stair: [
      ["hr-stair-rotten", "a flight of rotting wooden stairs with broken treads, seen from above", "interior"],
      ["hr-stair-stone-bloody", "worn stone steps stained with blood, seen from above", "interior cave"],
    ],
  },
  mystery: {
    floor: [
      ["my-parquet-victorian", "polished dark Victorian parquet floor with an inlaid border", "interior"],
      ["my-cobbles-wet", "wet grey cobblestones under gaslight, reflections", "field interior"],
      ["my-pavement-flag", "grey York stone pavement flags, wet, a drain grate", "field interior"],
      ["my-tiles-hall", "black and white marble chequered hall floor", "interior"],
      ["my-carpet-persian", "a rich red and blue Persian carpet, worn", "interior"],
      ["my-boards-study", "warm waxed dark floorboards, straight planks with a fine wood grain", "interior"],
      ["my-gravel-drive", "raked pale gravel drive with leaves", "field"],
    ],
    wall: [
      ["my-wall-wallpaper", "the top of a wall with dark green damask wallpaper and a picture rail", "interior"],
      ["my-wall-brick-alley", "the top edge of a soot stained brick wall seen from directly above, a row of dark brick headers with a drainpipe running along it", "field interior"],
      ["my-wall-iron-fence", "the top of a black wrought iron railing seen from directly above, a thin dark line of spear finials over grey pavement", "field"],
      ["my-wall-bookcase", "the top of a tall mahogany bookcase seen from directly above, only the top edge of the shelves and the tops of the books", "interior"],
      ["my-wall-hedge-clipped", "a tall clipped yew hedge, seen from above", "field"],
      ["my-wall-panelling", "the top edge of a dark oak panelled wall seen from directly above, a thin band of oak with brass lamp tops along it", "interior"],
    ],
    water: [
      ["my-canal", "uniform dark cold canal water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, a thin fog on the water and faint gaslight reflections", "riverside field"],
      ["my-puddle-rain", "uniform dark rain water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, rain rings spreading across it", "field interior"],
      ["my-pond-lily", "uniform dark garden pond water filling the entire frame, seen from directly above, fine wind ripples across the whole surface, soft pale highlights, a few green lily pads floating on it", "field"],
    ],
    rough: [
      ["my-leaves-wet", "wet fallen leaves over cobbles", "field"],
      ["my-rubbish-alley", "wet alley ground strewn with crumpled newspapers, broken crates and rubbish, seen from directly above", "field interior"],
      ["my-papers-scattered", "floorboards covered in scattered loose papers, letters and open files, seen from directly above", "interior"],
    ],
    hazard: [
      ["my-broken-glass", "shattered window glass across a floor", "interior"],
      ["my-gas-leak", "a floor with a faint green gas haze and a broken pipe", "interior"],
    ],
    chasm: [["my-cellar-drop", "a dark open cellar hatch dropping into blackness", "interior"]],
    lowwall: [
      ["my-lowwall-railing", "a low black iron railing, seen from above", "field interior"],
      ["my-lowwall-hedge", "a low clipped box hedge", "field"],
      ["my-lowwall-counter", "a long polished shop counter with brass rail, seen from above", "interior"],
      ["my-lowwall-sofa", "a velvet chesterfield sofa, seen from above", "interior"],
    ],
    door: [
      ["my-door-panelled", "a glossy black panelled front door with a brass knocker, filling the frame", "interior"],
      ["my-door-shop", "a shop door with a frosted glass panel and a bell, filling the frame", "interior field"],
      ["my-door-servants", "a plain green painted servants door, filling the frame", "interior"],
    ],
    stair: [
      ["my-stair-grand", "a grand carpeted staircase with a mahogany banister, seen from above", "interior"],
      ["my-stair-area", "iron area steps down to a basement door, seen from above", "field interior"],
    ],
  },
};

export const GENRES = Object.keys(GENRE_MATERIALS);

// The words that keep a setting in its century. Flux paints "a wall of neon
// signs" as fantasy tavern signage unless told otherwise.
const GENRE_KEY = {
  cyberpunk: "cyberpunk science fiction setting, near future megacity, gritty and industrial, mostly dark and grey",
  steampunk: "steampunk Victorian setting, brass, iron and steam",
  post_apocalyptic: "post apocalyptic wasteland setting, rust, decay and dust",
  horror: "gothic horror setting, dread and decay",
  mystery: "Victorian era detective setting, gaslit city",
};

// ---- assembly ----

function entry(category, [id, detail, themes, framing], genre) {
  const fr = framing || CATEGORIES[category].framing;
  return {
    id,
    category,
    genre: genre || null,
    detail,
    themes: themes.split(" "),
    terrain: CATEGORIES[category].terrain,
    seamless: CATEGORIES[category].seamless,
    label: labelFor(category, id),
    framing: fr,
    prompt: promptFor(fr, detail, genre, CATEGORIES[category].seamless),
    // The shared negative forbids neon; a neon setting must not inherit that.
    negative:
      genre && CATEGORIES[category].seamless && SETTING_STYLE[genre]
        ? NEGATIVE.replace("oversaturated, garish, neon, ", "") + ", skyline, buildings, city aerial view, street scene, corridor, road markings, cobblestone, flagstones, medieval"
        : NEGATIVE + FRAMINGS[fr].negative + (genre && KEYLESS_FRAMINGS.has(fr) ? GENRE_SURFACE_NEGATIVE[genre] : ""),
    fluxPrompt: fluxPromptFor(fr, detail, genre, CATEGORIES[category].seamless),
  };
}

// One flat list. `seamless` is decided by the category, not the entry: the
// difference between a material and a fitting is what the engine does with
// it, and that is exactly what the category already says.
export const TILES = [
  ...Object.entries(MATERIALS).flatMap(([category, entries]) => entries.map((e) => entry(category, e, null))),
  ...Object.entries(GENRE_MATERIALS).flatMap(([genre, categories]) =>
    Object.entries(categories).flatMap(([category, entries]) => entries.map((e) => entry(category, e, genre))),
  ),
];
{
  const seen = new Set();
  for (const tile of TILES) {
    if (seen.has(tile.id)) throw new Error(`duplicate tile id ${tile.id}`);
    seen.add(tile.id);
  }
}


// Flux takes no negative prompt, so the two things the negative held off
// (a photographic frame, a sample sheet) are asked for in the positive, and
// the style line is the one every map asset shares (scripts/prop-set.mjs).
function fluxPromptFor(framing, detail, genre, seamless) {
  if (genre && seamless && SETTING_STYLE[genre]) {
    return `${detail}, ${SETTING_STYLE[genre]}`;
  }
  const tail = framing === "surface" ? ", one continuous material" : framing === "water" ? ", only water across the whole frame, one continuous liquid surface" : "";
  if (genre && KEYLESS_FRAMINGS.has(framing)) {
    return `${detail}, ${FRAMINGS[framing].look}, ${GENRE_PALETTE[genre]}, ${GENRE_STYLE}, view from directly above, top-down orthographic, no vignette, no border, no text${tail}`;
  }
  const key = genre ? `${GENRE_KEY[genre]}, ` : "";
  const style = genre ? MAP_STYLE.replace("hand painted fantasy tabletop art", `hand painted tabletop art, ${GENRE_PALETTE[genre]}`) : MAP_STYLE;
  return `${FRAMINGS[framing].look}, ${key}${detail}, ${style}, no vignette, no border, no text${tail}`;
}

// Ids carry their category so the filenames sort into groups on disk, but a
// palette that reads "Door door wood plain" is noise. Drop the prefix when it
// only repeats the group the tile is already filed under.
function labelFor(category, id) {
  const words = id.split("-");
  if (words[0] === category) {
    words.shift();
  }
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function promptFor(framing, detail, genre, seamless) {
  if (genre && seamless && SETTING_STYLE[genre]) {
    // The base must already carry the setting's light and colour: a repaint at
    // 0.55 cannot add neon to a grey base.
    return `${detail}, ${SETTING_STYLE[genre]}`;
  }
  if (genre && KEYLESS_FRAMINGS.has(framing)) {
    return `${detail}, ${FRAMINGS[framing].look}, ${GENRE_PALETTE[genre]}, top-down orthographic view straight down, soft flat even lighting, no cast shadows`;
  }
  const key = genre ? `${GENRE_KEY[genre]}, ` : "";
  const look = genre ? LOOK.replace("hand painted fantasy battle map art", `hand painted battle map art, ${GENRE_PALETTE[genre]}`) : LOOK;
  return `${FRAMINGS[framing].look}, ${key}${detail}, ${look}`;
}

export function tilesByCategory() {
  const grouped = new Map();
  for (const key of Object.keys(CATEGORIES)) {
    grouped.set(key, []);
  }
  for (const tile of TILES) {
    grouped.get(tile.category).push(tile);
  }
  return grouped;
}
