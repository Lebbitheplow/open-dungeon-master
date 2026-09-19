// The catalogue of map objects: the furniture, scatter and features the
// renderer dresses a map with and the editor offers as stamps.
//
// An object is one thing seen from straight above, cut out on transparency.
// The renderer draws its shadow and outline, so nothing here bakes one in.
// Every entry names what the top view actually shows, because "a bookshelf"
// on its own comes back in elevation with the spines facing the camera.
//
// Consumed by scripts/generate-props.mjs. Pure data plus prompt assembly and
// no I/O, so the whole set can be inspected with --dry-run.

// The one style line every map asset shares, so a barrel and a flagstone read
// as the same painting. Never "battle map", "Inkarnate" or "map": those words
// draw parchment with a compass rose on it.
export const MAP_STYLE =
  "hand painted fantasy tabletop art, painterly digital illustration, gouache and dry brush, " +
  "soft brush strokes, muted harmonised earthy palette, flat even lighting, " +
  "view from directly above, top-down orthographic";

// "Filling most of the frame" is load bearing: without it a lantern or a
// saddle comes back as a thumbnail in a sea of white and ships as a smudge.
const OBJECT_LOOK =
  "a single medieval fantasy RPG prop seen from directly above, isolated on a plain flat white background, " +
  "centred and filling most of the frame, a small empty margin around it, no cast shadow on the ground, no other objects";

// Where an object likes to sit. `wall` objects are pushed against the nearest
// wall by the renderer and, when `align` is set, rotated to lie along it;
// `scatter` objects land in open floor; `feature` objects are never placed
// automatically, only by the DM as a stamp.
//
// `span` is the object's longest side in squares (one square is five feet),
// so a stool is small and a long table is not.
//
// [id, what the top view shows, sets, span, kind, align]
const OBJECTS = [
  // furniture and containers
  ["barrel", "the round lid of a wooden barrel with two iron hoops", "dungeon tavern ship market camp", 0.5, "wall", false],
  ["barrel-open", "an open wooden barrel seen from above, dark liquid inside, iron hoops", "tavern sewer lab", 0.5, "wall", false],
  ["crate", "the lid of a square wooden shipping crate, planks and iron corner straps", "dungeon ship market barracks", 0.55, "wall", false],
  ["crate-stack", "two square wooden crates side by side, one slightly askew, planks and corner straps", "ship market barracks", 0.9, "wall", true],
  ["sacks", "three lumpy burlap grain sacks leaning together, tied necks", "market tavern kitchen mine", 0.6, "wall", false],
  ["chest", "the closed lid of an iron banded wooden treasure chest, a hasp and lock", "dungeon crypt ship throne", 0.62, "wall", true],
  ["chest-open", "an open treasure chest seen from above, gold coins inside, lid thrown back", "dungeon crypt", 0.62, "feature", true],
  ["bookshelf", "the top edge of a long narrow wooden bookshelf with the tops of many old leather books visible in a row", "library lab tavern throne", 1.0, "wall", true],
  ["table-long", "a long rectangular wooden plank table with a candle, two tankards and a plate of bread on it", "tavern barracks kitchen", 1.6, "wall", true],
  ["table-round", "a round wooden tavern table with a candle and two mugs on it", "tavern kitchen", 0.9, "scatter", false],
  ["desk", "a wooden writing desk with an open book, an inkwell and a quill on it", "library lab throne", 1.1, "wall", true],
  ["stool", "a small round three legged wooden stool", "tavern kitchen barracks camp", 0.35, "scatter", false],
  ["chair", "a plain wooden chair with a straight back, seen from above", "tavern library throne", 0.4, "scatter", false],
  ["bench", "a long plain wooden bench", "tavern temple barracks", 1.1, "wall", true],
  ["bed", "a wooden bed with a rumpled straw mattress and a woollen blanket", "tavern barracks prison", 1.3, "wall", true],
  ["bedroll", "an unrolled bedroll and blanket on the ground", "camp cave barracks", 0.85, "wall", true],
  ["rug", "a rectangular woven rug with a faded red and gold border pattern, worn nap", "tavern library throne temple", 1.6, "feature", true],
  ["rug-round", "a round woven rug with a faded geometric pattern", "throne library", 1.1, "feature", false],
  ["wardrobe", "the top of a tall wooden wardrobe, carved lid panel", "tavern throne", 0.9, "wall", true],
  ["cabinet", "the top of a low wooden cabinet with a few clay jars on it", "kitchen lab", 0.8, "wall", true],
  ["shelf-jars", "the top edge of a narrow shelf lined with glass bottles and clay jars", "lab kitchen", 0.9, "wall", true],
  ["weapon-rack", "a wooden weapon rack holding spears and swords, seen from above", "barracks dungeon throne", 0.9, "wall", true],
  ["armour-stand", "a wooden stand holding a steel breastplate and helm, seen from above", "barracks throne", 0.5, "wall", false],
  ["urn", "a clay urn with a round open mouth, terracotta", "crypt temple market", 0.42, "wall", false],
  ["amphora", "two tall clay amphorae leaning against each other", "market ship temple", 0.6, "wall", false],
  ["pot-cooking", "an iron cooking pot with a wooden spoon in it", "kitchen camp", 0.4, "scatter", false],
  ["basket", "a round woven wicker basket full of apples", "market kitchen garden", 0.4, "scatter", false],
  ["bucket", "a wooden bucket with a rope handle, water inside", "mine tavern kitchen", 0.3, "scatter", false],
  ["cart", "a wooden hand cart with two spoked wheels and a load of sacks", "market field mine", 1.4, "feature", true],
  ["wagon", "a covered wooden wagon with four spoked wheels, canvas roof", "field camp market", 2.0, "feature", true],
  ["boat", "a small wooden rowing boat with two oars laid inside", "river swamp ship", 1.8, "feature", true],

  // light and fire
  ["brazier", "a round iron brazier bowl on three legs filled with glowing orange coals", "dungeon temple throne volcanic", 0.55, "wall", false],
  ["campfire", "a campfire in a ring of grey stones with burning logs and orange flames", "camp forest field cave frozen", 0.7, "scatter", false],
  ["candles", "a cluster of lit white candles of different heights with pooled wax", "crypt temple arcane", 0.3, "scatter", false],
  ["candelabra", "a standing iron candelabra with five lit candles, seen from above", "temple throne crypt", 0.35, "wall", false],
  ["lantern", "a brass lantern with a glowing flame sitting on the ground", "mine camp ship", 0.25, "scatter", false],
  ["torch-stand", "an iron torch stand with a burning torch, seen from above", "dungeon barracks", 0.3, "wall", false],
  ["fire-pit", "a round stone lined fire pit with glowing embers", "camp tavern barracks", 0.8, "feature", false],
  ["hearth", "a stone fireplace hearth with burning logs, seen from above", "tavern kitchen", 1.0, "wall", true],

  // crypt and ossuary
  ["coffin", "a closed wooden coffin lid, tapered shape, iron handles", "crypt", 0.95, "wall", true],
  ["sarcophagus", "a stone sarcophagus lid with a carved effigy of a knight", "crypt temple", 1.1, "feature", true],
  ["skulls", "a small heap of a few old human skulls", "crypt cave dungeon", 0.45, "wall", false],
  ["bones", "a loose scatter of old human bones, ribs, long bones and one skull, lying on the ground, no weapons", "crypt cave dungeon", 0.6, "scatter", false],
  ["skeleton", "a complete human skeleton lying on its back on the ground", "crypt cave dungeon", 1.0, "scatter", true],
  ["gravestone", "a weathered stone grave marker, rounded top, seen from above", "graveyard", 0.35, "scatter", false],
  ["grave-mound", "a low mound of fresh dark earth with a small wooden cross at one end", "graveyard field", 0.9, "scatter", true],
  ["tomb-altar", "a low carved stone tomb altar with a dark stain down its side", "crypt temple", 1.0, "feature", true],
  ["bier", "a wooden bier with a shrouded body laid on it", "crypt temple", 1.1, "feature", true],

  // temple and arcane
  ["altar", "a carved stone altar with a gold chalice and a candle on it", "temple arcane", 1.0, "feature", true],
  ["statue-knight", "a stone statue of an armoured knight on a square plinth, seen from above", "temple throne crypt ruin", 0.7, "wall", false],
  ["statue-broken", "a broken stone statue on a plinth, only the legs remain", "ruin crypt", 0.6, "wall", false],
  ["pillar", "the top of a round stone column with a carved capital", "temple ruin throne dungeon", 0.6, "feature", false],
  ["pillar-broken", "the top of a broken round stone column with a jagged cracked top", "ruin crypt cave", 0.6, "feature", false],
  ["summoning-circle", "a glowing violet arcane circle of runes drawn on a stone floor", "arcane", 1.8, "feature", false],
  ["crystal-ball", "a crystal ball on a small carved stand", "arcane lab", 0.3, "scatter", false],
  ["cauldron", "a black iron cauldron with bubbling green liquid inside", "arcane lab swamp", 0.55, "wall", false],
  ["lectern", "a wooden lectern with an open heavy book on it, seen from above", "temple library arcane", 0.45, "wall", false],
  ["font", "a round stone baptismal font full of still water", "temple", 0.6, "feature", false],
  ["idol", "a squat carved stone idol of a horned beast on a plinth", "cave temple swamp", 0.6, "feature", false],
  ["shrine", "a small roadside shrine of stacked stones with offerings of flowers and a candle", "forest field graveyard", 0.6, "scatter", false],
  ["obelisk", "the top of a tall black stone obelisk carved with runes", "ruin arcane desert", 0.45, "feature", false],
  ["scroll-pile", "a heap of rolled parchment scrolls tied with ribbon", "library arcane", 0.4, "scatter", false],
  ["book-pile", "a stack of old leather bound books", "library arcane lab", 0.35, "scatter", false],

  // laboratory and workshop
  ["alchemy-bench", "a wooden workbench crowded with glass alembics, flasks and a burner", "lab arcane", 1.3, "wall", true],
  ["anvil", "a blacksmith anvil on a wooden stump, seen from above", "forge", 0.5, "wall", false],
  ["forge-hearth", "a stone forge hearth with glowing coals and a pair of tongs", "forge", 1.1, "wall", true],
  ["quench-tub", "a wooden tub of dark water with a hammer resting on the rim", "forge", 0.5, "wall", false],
  ["grindstone", "a large round grindstone on a wooden frame", "forge barracks", 0.6, "wall", false],
  ["loom", "a wooden weaving loom with half finished cloth", "market tavern", 1.1, "wall", true],
  ["spinning-wheel", "a wooden spinning wheel", "tavern", 0.5, "wall", false],
  ["tool-bench", "a wooden bench with a saw, a mallet and wood shavings on it", "forge mine", 1.1, "wall", true],
  ["ore-cart", "a small iron mine cart on rails full of rock ore", "mine", 0.9, "feature", true],
  ["pickaxe-pile", "a pickaxe and a shovel leaning together against a small rock", "mine", 0.5, "wall", false],
  ["lumber-pile", "a neat stack of cut timber planks", "forge mine field", 1.0, "wall", true],
  ["rope-coil", "a coil of thick hemp rope", "ship mine camp", 0.35, "scatter", false],

  // tavern, kitchen, market
  ["keg-rack", "three wooden kegs on their sides in a wooden rack, seen from above", "tavern", 1.0, "wall", true],
  ["bar-counter", "a long wooden bar counter with tankards and a tapped keg at one end", "tavern", 1.8, "wall", true],
  ["market-stall", "a market stall counter piled with vegetables and cloth under a striped awning", "market", 1.6, "feature", true],
  ["fruit-crates", "wooden crates of apples and pumpkins", "market kitchen garden", 0.8, "wall", true],
  ["fish-baskets", "woven baskets of silver fish and a coil of net", "market river ship", 0.7, "wall", false],
  ["cheese-wheels", "three wheels of cheese stacked on a board", "kitchen market", 0.4, "scatter", false],
  ["butcher-block", "a thick wooden butcher block with a cleaver and a joint of meat", "kitchen market", 0.6, "wall", false],
  ["hay-bale", "a rectangular bale of golden hay tied with twine", "field camp", 0.6, "wall", true],
  ["hay-pile", "a loose heap of golden straw", "field camp tavern", 0.8, "scatter", false],
  ["well", "a round stone well with a wooden roof frame and a bucket, seen from above", "field market", 0.9, "feature", false],
  ["trough", "a long wooden water trough", "field market", 1.0, "wall", true],
  ["signpost", "a wooden signpost with two pointing boards, seen from above", "field forest", 0.4, "scatter", false],

  // prison and dungeon
  ["cage", "a small iron cage of bars, empty, seen from above", "dungeon prison", 0.6, "wall", false],
  ["shackles", "iron shackles and a length of chain lying on stone", "prison dungeon", 0.45, "scatter", false],
  ["rack", "a wooden torture rack with rollers and ropes, seen from above", "prison dungeon", 1.5, "feature", true],
  ["stocks", "wooden stocks with holes for hands and head, seen from above", "prison market", 0.9, "feature", true],
  ["straw-pallet", "a thin pallet of dirty straw with a ragged blanket", "prison dungeon", 0.9, "wall", true],
  ["iron-maiden", "a closed iron maiden seen from above, spiked lid", "prison dungeon", 0.6, "wall", false],
  ["lever", "an iron floor lever on a stone base", "dungeon mine", 0.3, "scatter", false],
  ["pressure-plate", "a square stone pressure plate slightly sunken into the floor with a worn edge", "dungeon", 0.5, "feature", false],
  ["trapdoor-open", "an open wooden trapdoor in a floor showing a dark hole with the top of a ladder", "dungeon tavern", 0.6, "feature", false],
  ["portcullis-lever", "a heavy iron winch with a chain, seen from above", "dungeon prison", 0.6, "wall", false],

  // cave and underground
  ["boulder", "a large rounded grey boulder with a little moss", "cave forest field river frozen", 0.8, "wall", false],
  ["boulder-large", "a huge angular grey boulder with cracks", "cave field", 1.3, "feature", false],
  ["rocks", "three small rounded grey rocks with a little lichen, lying close together", "cave field river mine frozen desert", 0.45, "scatter", false],
  ["rubble", "a compact heap of broken grey stone rubble", "ruin dungeon cave", 0.7, "scatter", false],
  ["stalagmites", "a cluster of five pointed grey cave stalagmites of different heights rising from rock, seen from above so their tips point at the viewer", "cave", 0.6, "wall", false],
  ["stalagmite-tall", "a single tall pale stalagmite, seen from above", "cave", 0.4, "scatter", false],
  ["crystals", "a cluster of pale violet crystal shards growing from rock", "cave arcane", 0.5, "wall", false],
  ["mushrooms", "a cluster of pale cave mushrooms with wide caps", "cave swamp forest", 0.4, "scatter", false],
  ["mushroom-giant", "a single giant cave mushroom with a wide spotted cap, seen from above", "cave swamp", 1.0, "feature", false],
  ["cave-pool", "a small round pool of still dark water in a rock hollow", "cave", 0.8, "feature", false],
  ["glowworm-moss", "a patch of glowing blue green moss on rock", "cave", 0.6, "scatter", false],
  ["egg-cluster", "a cluster of large pale leathery eggs in a nest of rock and slime", "cave swamp", 0.7, "feature", false],
  ["web-cocoon", "a bundle of grey spider silk cocooning a shape, on stone", "cave dungeon", 0.7, "scatter", true],
  ["obsidian-shards", "a cluster of black obsidian glass shards", "volcanic cave", 0.5, "wall", false],
  ["lava-rock", "a black volcanic rock with glowing orange cracks", "volcanic", 0.5, "scatter", false],
  ["sulphur-vent", "a small rock vent with yellow sulphur crust and a wisp of steam", "volcanic cave", 0.5, "scatter", false],

  // forest, field, garden
  ["tree-oak", "the round leafy green crown of an oak tree with a few gaps showing branches", "forest field", 1.6, "feature", false],
  ["tree-pine", "the pointed dark green crown of a pine tree seen from above, radial branches", "forest frozen", 1.2, "feature", false],
  ["tree-dead", "the bare twisted branches of a dead tree seen from above", "swamp graveyard ruin", 1.2, "feature", false],
  ["tree-autumn", "the round crown of a tree in orange and red autumn leaves", "forest field", 1.5, "feature", false],
  ["tree-willow", "the drooping pale green crown of a willow tree seen from above", "river swamp", 1.7, "feature", false],
  ["bush", "a round leafy green shrub", "forest field garden ruin", 0.7, "wall", false],
  ["bush-berry", "a round green bush with red berries", "forest field garden", 0.6, "scatter", false],
  ["fern", "a green fern plant with radiating fronds", "forest swamp cave", 0.6, "wall", false],
  ["flowers", "a round clump of wildflowers in white, yellow and purple with green leaves", "field forest garden", 0.5, "scatter", false],
  ["log", "a fallen tree log with rough bark and a broken end", "forest swamp camp", 1.2, "scatter", true],
  ["stump", "a tree stump with visible growth rings", "forest field camp", 0.5, "scatter", false],
  ["reeds", "a clump of tall green reeds seen from above", "swamp river", 0.6, "scatter", false],
  ["lily-pads", "a few green lily pads with one white flower on dark water", "swamp river", 0.7, "scatter", false],
  ["hedge-round", "one round dense clipped box hedge bush, dark green", "garden field", 0.6, "scatter", false],
  ["planter", "a square stone planter full of herbs", "garden temple", 0.5, "wall", false],
  ["fountain", "a round stone fountain with a central spout and rippling water, seen from above", "garden market temple", 1.4, "feature", false],
  ["haystack", "a large round haystack", "field", 1.2, "feature", false],
  ["scarecrow", "a scarecrow on a cross pole seen from directly above, straw hat and ragged coat", "field", 0.6, "scatter", false],
  ["beehive", "a domed woven straw beehive", "garden field", 0.35, "scatter", false],
  ["fence-post", "a single wooden fence post with a coil of wire", "field", 0.25, "scatter", false],
  ["anthill", "a low mound of red earth with a hole in the top", "field desert", 0.5, "scatter", false],

  // camp and travel
  ["tent", "a canvas ridge tent seen from directly above, guy ropes and pegs", "camp field", 1.4, "feature", true],
  ["tent-round", "a round canvas yurt tent seen from directly above, a smoke hole in the centre", "camp field desert", 1.6, "feature", false],
  ["pack", "a leather travel pack with a bedroll strapped to it", "camp cave forest", 0.4, "scatter", false],
  ["cookfire", "a small cookfire with a pot hanging from a tripod of sticks", "camp", 0.6, "scatter", false],
  ["saddle", "a leather horse saddle on the ground", "camp field", 0.5, "scatter", false],
  ["supply-pile", "a pile of barrels, sacks and crates under a rope net", "camp ship market frozen", 1.2, "feature", true],
  ["banner-pole", "a fallen banner pole with a torn red banner", "camp barracks ruin", 1.1, "scatter", true],

  // ship and river
  ["ship-wheel", "a wooden ship steering wheel on its post, seen from above", "ship", 0.5, "feature", false],
  ["cannon", "a black iron cannon on a wooden carriage, seen from above", "ship barracks", 1.0, "wall", true],
  ["cannonballs", "a pyramid of black iron cannonballs", "ship barracks", 0.4, "scatter", false],
  ["anchor", "a rusted iron ship anchor lying on planks", "ship river", 0.8, "scatter", true],
  ["fishing-net", "a heap of brown fishing net with cork floats", "ship river", 0.7, "scatter", false],
  ["mooring-post", "a thick wooden mooring post with a rope tied round it", "river ship", 0.3, "scatter", false],
  ["dock-crate", "a wet wooden crate with a rope handle and barnacles", "river ship", 0.55, "wall", false],
  ["driftwood", "a bleached tangled piece of driftwood", "river field", 0.8, "scatter", true],

  // ruin and battlefield
  ["fallen-column", "a fallen broken stone column lying in pieces", "ruin temple", 1.5, "scatter", true],
  ["broken-wall", "a short stub of broken masonry wall with rubble", "ruin", 1.0, "feature", true],
  ["overgrown-statue", "a mossy stone statue of a robed figure on a plinth, seen from above", "ruin forest graveyard", 0.7, "wall", false],
  ["cart-wreck", "the wreck of a wooden cart, broken wheel and scattered planks", "ruin field", 1.4, "feature", true],
  ["shield-sword", "a dented round shield and a sword lying crossed on the ground", "ruin barracks field", 0.6, "scatter", false],
  ["broken-cart-wheel", "a broken wooden cart wheel lying on the ground", "ruin field market", 0.5, "scatter", false],
  ["siege-ladder", "a long wooden siege ladder lying on the ground", "ruin field barracks", 2.0, "feature", true],
  ["spike-barricade", "a barricade of sharpened wooden stakes lashed together", "barracks field ruin", 1.2, "feature", true],
  ["burnt-timber", "a heap of charred black timbers", "ruin field", 0.9, "scatter", false],

  // frozen and desert
  ["ice-boulder", "a rounded boulder of cloudy blue ice", "frozen", 0.8, "wall", false],
  ["snow-pile", "a low drift of white snow", "frozen", 0.9, "scatter", false],
  ["frozen-corpse", "a body frozen in the ice under a dusting of snow", "frozen", 1.0, "scatter", true],
  ["sled", "a wooden sled with a bundle of furs", "frozen", 1.0, "feature", true],
  ["cactus", "a tall green saguaro cactus seen from directly above, radial arms", "desert", 0.6, "scatter", false],
  ["desert-skull", "a bleached animal skull with horns on sand", "desert field", 0.5, "scatter", false],
  ["clay-jars", "a group of three large clay water jars", "desert market", 0.6, "wall", false],
  ["palm", "the radiating fronds of a palm tree crown seen from directly above", "desert river", 1.4, "feature", false],
  ["sand-dune-rock", "a dark rock half buried in golden sand", "desert", 0.7, "scatter", false],

  // sewer
  ["sewer-grate", "a round iron sewer grate set in stone", "sewer dungeon", 0.5, "feature", false],
  ["sludge-pile", "a heap of dark refuse and rags", "sewer prison", 0.7, "scatter", false],
  ["rat-nest", "a nest of straw and rags with small dark shapes in it", "sewer dungeon", 0.5, "scatter", false],
  ["broken-pipe", "a broken iron pipe end leaking green water", "sewer lab", 0.5, "wall", true],

  // cyberpunk
  ["cp-terminal", "a computer terminal on a desk with a glowing cyan screen and a keyboard, seen from above", "cyberpunk", 0.8, "wall", true],
  ["cp-vending-machine", "a glowing vending machine with neon panels, seen from above", "cyberpunk", 0.6, "wall", false],
  ["cp-holo-table", "a round table projecting a blue holographic city map, seen from above", "cyberpunk", 1.0, "feature", false],
  ["cp-drone-wreck", "a crashed quadcopter drone with sparking wires", "cyberpunk", 0.7, "scatter", false],
  ["cp-neon-sign", "a broken neon sign lying on the ground, glowing pink kanji shapes", "cyberpunk", 0.9, "scatter", true],
  ["cp-dumpster", "a steel dumpster with graffiti, lid open, seen from above", "cyberpunk", 1.0, "wall", true],
  ["cp-motorcycle", "a sleek black motorcycle with neon trim, seen from above", "cyberpunk", 1.2, "feature", true],
  ["cp-cable-spool", "a large industrial cable spool, seen from above", "cyberpunk", 0.7, "wall", false],
  ["cp-server-rack", "a black server rack with blinking lights, seen from above", "cyberpunk", 0.5, "wall", true],
  ["cp-barrel-chem", "a yellow chemical drum with a biohazard label, seen from above", "cyberpunk", 0.5, "wall", false],
  ["cp-crate-plastic", "a black plastic cargo crate with orange latches", "cyberpunk", 0.55, "wall", false],
  ["cp-street-light", "a tall street lamp with a cyan LED head, seen from directly above", "cyberpunk", 0.4, "scatter", false],
  ["cp-car", "a low sleek hover car with glowing underlights, seen from above", "cyberpunk", 2.0, "feature", true],
  ["cp-turret", "a mounted automated gun turret on a tripod, seen from above", "cyberpunk", 0.7, "feature", false],
  ["cp-med-pod", "a white medical pod with a glass lid and glowing readouts, seen from above", "cyberpunk", 1.3, "feature", true],
  ["cp-trash-pile", "a pile of rubbish bags and broken electronics", "cyberpunk", 0.7, "scatter", false],
  ["cp-noodle-cart", "a street food cart with a steaming pot and paper lanterns, seen from above", "cyberpunk", 1.2, "feature", true],
  ["cp-body-bag", "a black body bag on the ground", "cyberpunk", 1.0, "scatter", true],

  // steampunk
  ["sp-boiler", "a riveted brass boiler with pipes and a pressure gauge, seen from above", "steampunk", 1.1, "wall", true],
  ["sp-gear-cluster", "a cluster of brass and iron gears and cogs", "steampunk", 0.7, "scatter", false],
  ["sp-pressure-gauge", "a large brass pressure gauge on a pipe stand, seen from above", "steampunk", 0.4, "wall", false],
  ["sp-airship-crate", "a wooden airship cargo crate with brass corners and a rope net", "steampunk", 0.7, "wall", false],
  ["sp-automaton-wreck", "a broken brass clockwork automaton lying on the ground", "steampunk", 1.0, "scatter", true],
  ["sp-coal-cart", "an iron coal cart on rails full of coal, seen from above", "steampunk", 0.9, "feature", true],
  ["sp-workbench", "an iron workbench with wrenches, gears and a vice, seen from above", "steampunk", 1.2, "wall", true],
  ["sp-telescope", "a brass telescope on a tripod, seen from above", "steampunk", 0.5, "scatter", false],
  ["sp-steam-engine", "a small brass steam engine with a flywheel, seen from above", "steampunk", 1.0, "feature", true],
  ["sp-oil-can", "a brass oil can and a rag on the floor", "steampunk", 0.3, "scatter", false],
  ["sp-pipe-stack", "a stack of copper pipes", "steampunk", 0.9, "wall", true],
  ["sp-gaslamp", "a cast iron gas lamp post with a warm glowing lantern, seen from directly above", "steampunk", 0.4, "scatter", false],
  ["sp-armchair", "a leather wingback armchair, seen from above", "steampunk", 0.6, "wall", false],
  ["sp-globe", "a large brass world globe on a stand, seen from above", "steampunk", 0.5, "scatter", false],
  ["sp-crate-explosives", "a wooden crate stencilled with a skull, dynamite sticks visible", "steampunk", 0.55, "wall", false],
  ["sp-toolbox", "an open iron toolbox spilling wrenches", "steampunk", 0.4, "scatter", false],

  // post-apocalyptic
  ["pa-car-wreck", "a rusted burnt out car wreck, seen from above", "wasteland", 2.0, "feature", true],
  ["pa-fuel-barrel", "a dented rusty red fuel barrel, seen from above", "wasteland", 0.5, "wall", false],
  ["pa-scrap-pile", "a heap of rusted scrap metal sheets, pipes and gears", "wasteland", 0.8, "scatter", false],
  ["pa-tent-tarp", "a makeshift tent of blue tarpaulin and poles, seen from above", "wasteland", 1.4, "feature", true],
  ["pa-radio", "an old field radio with a bent antenna", "wasteland", 0.4, "wall", false],
  ["pa-generator", "a rusty portable generator with a jerry can, seen from above", "wasteland", 0.7, "wall", true],
  ["pa-signpost", "a bullet riddled road sign on a bent post, seen from above", "wasteland", 0.4, "scatter", false],
  ["pa-skeleton", "a bleached human skeleton in rags lying on the ground", "wasteland", 1.0, "scatter", true],
  ["pa-tyre", "an old car tyre lying flat", "wasteland", 0.4, "scatter", false],
  ["pa-shopping-cart", "a rusted shopping cart full of junk, seen from above", "wasteland", 0.7, "scatter", true],
  ["pa-campfire-barrel", "a burning oil drum with flames and smoke, seen from above", "wasteland", 0.5, "wall", false],
  ["pa-mattress", "a stained torn mattress on the ground", "wasteland", 1.2, "scatter", true],
  ["pa-crate-supplies", "a wooden crate of tinned food and bottles", "wasteland", 0.55, "wall", false],
  ["pa-water-tank", "a rusted water tank on a stand, dripping", "wasteland", 0.8, "wall", false],
  ["pa-sandbag-nest", "a ring of sandbags with a machine gun, seen from above", "wasteland", 1.1, "feature", false],
  ["pa-gas-mask", "a discarded gas mask on the ground", "wasteland", 0.3, "scatter", false],

  // horror
  ["hr-coffin-open", "an open coffin with a rotting shroud inside, seen from above", "horror", 1.0, "feature", true],
  ["hr-ritual-circle", "one large circle of dark red painted symbols with black candles at its rim, drawn flat on the ground", "horror", 1.8, "feature", false],
  ["hr-cage-hanging", "a rusted hanging gibbet cage with bones, seen from above", "horror", 0.6, "wall", false],
  ["hr-operating-table", "a stained steel operating table with leather straps and a tray of tools, seen from above", "horror", 1.3, "feature", true],
  ["hr-candles-black", "a cluster of black candles with dripping wax", "horror", 0.3, "scatter", false],
  ["hr-mirror", "a cracked full length mirror in a dark frame lying on the floor", "horror", 0.9, "scatter", true],
  ["hr-doll", "a cracked porcelain doll lying on the ground", "horror", 0.3, "scatter", false],
  ["hr-chains", "a heap of rusted chains with a meat hook", "horror", 0.5, "scatter", false],
  ["hr-altar-bloody", "a stone altar stained with blood, a dagger on it, seen from above", "horror", 1.0, "feature", true],
  ["hr-wheelchair", "a rusted old wheelchair, seen from above", "horror", 0.5, "scatter", false],
  ["hr-bathtub", "a stained clawfoot bathtub full of dark liquid, seen from above", "horror", 1.2, "wall", true],
  ["hr-scarecrow-fallen", "a fallen scarecrow with a sack head, on the ground", "horror", 1.0, "scatter", true],
  ["hr-bones-pile", "a heap of human bones and skulls", "horror", 0.6, "wall", false],
  ["hr-cocoon", "a large pale spider silk cocoon wrapped tight, no face visible", "horror", 0.8, "scatter", true],
  ["hr-pew", "a rotting church pew, seen from above", "horror", 1.1, "wall", true],
  ["hr-gramophone", "an old gramophone with a brass horn, seen from above", "horror", 0.4, "wall", false],

  // mystery
  ["my-writing-desk", "a mahogany writing desk with papers, an inkwell and a lamp, seen from above", "mystery", 1.1, "wall", true],
  ["my-gramophone", "a gramophone with a brass horn on a side table, seen from above", "mystery", 0.4, "wall", false],
  ["my-tea-set", "a silver tea set on a round tray", "mystery", 0.4, "scatter", false],
  ["my-armchair", "a green velvet armchair, seen from above", "mystery", 0.6, "wall", false],
  ["my-street-lamp", "a black cast iron gas street lamp, seen from directly above", "mystery", 0.4, "scatter", false],
  ["my-carriage", "a black Victorian hansom cab carriage with two large spoked wheels and a folded hood, seen from directly above, no horse", "mystery", 2.0, "feature", true],
  ["my-crates-dock", "stacked wooden crates stencilled with shipping marks", "mystery", 0.8, "wall", true],
  ["my-umbrella-stand", "a brass umbrella stand with umbrellas and a cane", "mystery", 0.3, "wall", false],
  ["my-bookcase-low", "a low mahogany bookcase with books and a bust, seen from above", "mystery", 0.9, "wall", true],
  ["my-piano", "a black grand piano with the lid up, seen from above", "mystery", 1.6, "feature", true],
  ["my-fireplace", "a marble fireplace with a lit fire and a clock on the mantel, seen from above", "mystery", 1.0, "wall", true],
  ["my-corpse-sheet", "a body under a white sheet on the floor with a chalk outline", "mystery", 1.0, "scatter", true],
  ["my-trunk", "a leather steamer trunk with brass straps", "mystery", 0.8, "wall", true],
  ["my-hat-stand", "a wooden hat stand seen from directly above, a black top hat on the top hook and a dark coat hanging below", "mystery", 0.3, "wall", false],
  ["my-dining-table", "a long dining table set with silver and candles, seen from above", "mystery", 1.8, "feature", true],
  ["my-newspaper-stack", "a bundle of newspapers tied with string", "mystery", 0.4, "scatter", false],
];

// Objects that are also hazards the rules know: the Prop tool offers them
// under "A thing" as today; the Hand can offer a terrain card for them when
// the engine has a hazard in reach (docs/visual-overhaul-plan.md 5.2).
export const HAZARD_OBJECTS = new Set(["brazier", "campfire", "fire-pit", "cauldron", "cannon", "spike-barricade", "sulphur-vent"]);

export const SETS = [
  "dungeon", "cave", "crypt", "forest", "swamp", "river", "field", "ruin", "camp", "forge", "temple",
  "market", "ship", "lab", "tavern", "library", "throne", "prison", "sewer", "volcanic", "frozen",
  "desert", "arcane", "kitchen", "barracks", "garden", "mine", "graveyard",
  // the other settings (docs/visual-overhaul-plan.md 8b.1)
  "cyberpunk", "steampunk", "wasteland", "horror", "mystery",
];

// The words that keep a setting in its century, and the genre a set belongs
// to so the stamp picker groups by the campaign's genre.
const SET_GENRE = { cyberpunk: "cyberpunk", steampunk: "steampunk", wasteland: "post_apocalyptic", horror: "horror", mystery: "mystery" };
const GENRE_KEY = {
  cyberpunk: "cyberpunk science fiction prop, neon lit near future",
  steampunk: "steampunk Victorian prop, brass, iron and steam",
  post_apocalyptic: "post apocalyptic wasteland prop, rusted and improvised",
  horror: "gothic horror prop, dread and decay",
  mystery: "Victorian era prop, a detective's world",
};

export const OBJECT_LIST = OBJECTS.map(([id, detail, sets, span, kind, align]) => {
  const setList = sets.split(" ");
  const genre = SET_GENRE[setList[0]] || null;
  const look = genre ? OBJECT_LOOK.replace("a single medieval fantasy RPG prop", `a single ${GENRE_KEY[genre]}`) : OBJECT_LOOK;
  const labelWords = id.replace(/^(cp|sp|pa|hr|my)-/, "").split("-");
  return {
    id,
    detail,
    sets: setList,
    genre,
    span,
    kind,
    align,
    hazard: HAZARD_OBJECTS.has(id),
    label: labelWords.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" "),
    prompt: `${look}, ${detail}, ${MAP_STYLE}`,
  };
});
{
  const seen = new Set();
  for (const o of OBJECT_LIST) {
    if (seen.has(o.id)) throw new Error(`duplicate object id ${o.id}`);
    seen.add(o.id);
  }
}

for (const object of OBJECT_LIST) {
  for (const set of object.sets) {
    if (!SETS.includes(set)) {
      throw new Error(`object ${object.id} names an unknown set "${set}"`);
    }
  }
}
