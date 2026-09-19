// Skins: a binding from each terrain character to a material, plus the
// renderer's dials for that place. The same terrain string paints a crypt, a
// ruin or a lava cave because the art and the rules are separate things.
//
// docs/visual-overhaul-plan.md section 3.8. `theme` names the MapTheme a skin
// is the default for; the named skins carry none. Plain data and erasable
// types only, so the asset scripts import this file directly under Node.
//
// Dials:
//   floorSpan, roughSpan, waterSpan, wallSpan  squares per texture repeat
//   wallTint, lowTint, roughTint               multiply tints
//   patch                                      a second ground material showing through
//   grade                                      the final soft-light tint
//   glow                                       the liquid is lava: additive glow, no wet margin
//   wallDecals, shoreDecals, roughDecals       decal families (scripts/decal-set.mjs)
//   lip, shore, fringe                         the decal ids within those families this place uses
//   wallEdge                                   { blur, amp } for the wall mask; masonry is crisp, a tree clump is a blob
//   waterAlpha                                 below 1 the floor shows through the water (a flooded room)
//   ground                                     which scatter decals suit the floor
//   sets, favour                               the object sets the dressing draws from
//   wallDensity, scatterDensity                how much dressing
//   scatterDecalDensity                        how many loose decals on open floor

export type Skin = {
  id: string;
  name: string;
  theme?: string;
  genre?: string;
  note: string;
  // Terrain character to material id (public/assets/tiles/manifest.json).
  bind: Record<string, string>;
  patch?: { id: string; span: number; t: number; alpha: number; soft?: number } | null;
  sets: string[];
  favour?: string[];
  [dial: string]: unknown;
};

export const SKINS: Skin[] = [
  {
    id: "stone-dungeon", name: "Stone dungeon", theme: "interior",
    note: "Mossy masonry, granite flagstones, stores against the walls.",
    bind: { ".": "flagstone-granite", "#": "wall-dungeon-mossy", "~": "water-flooded-floor", ",": "rough-debris-crates", "+": "door-wood-iron-banded", "|": "lowwall-stone-parapet" },
    floorSpan: 1.6, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.2, wallTint: "#7a756e", grade: "rgba(255,214,160,.14)", glow: false,
    patch: { id: "ash-grey", span: 3, t: 0.58, alpha: 0.5 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    waterAlpha: 0.78,
    shore: ["shore-wet-sand","shore-scum"], lip: ["edge-mortar-lip","edge-moss-lip","edge-rubble-crumbs","edge-cobweb-lip","edge-damp-stain"], fringe: ["rough-gravel-spill","rough-mud-edge"],
    sets: ["dungeon", "barracks", "prison"], favour: ["barrel", "crate", "sacks", "brazier", "weapon-rack"],
    wallDensity: 0.26, scatterDensity: 0.05, scatterDecalDensity: 0.07,
  },
  {
    id: "cavern", name: "Cavern", theme: "cave",
    note: "Water worn rock, a black pool, stalagmites along the walls.",
    bind: { ".": "cave-rock-smooth", "#": "wall-cave-rock", "~": "water-cave-pool", ",": "rough-rubble-scree", "+": "door-stone-slab", "|": "lowwall-stalagmite-row" },
    floorSpan: 2.2, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.6, wallTint: "#6f6a64", grade: "rgba(150,170,200,.12)", glow: false,
    patch: { id: "gravel-grey", span: 3, t: 0.6, alpha: 0.5 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    wallEdge: { blur: 7, amp: 0.26 },
    shore: ["shore-wet-sand","shore-scum"], lip: ["edge-mortar-lip","edge-rubble-crumbs","edge-damp-stain"], fringe: ["rough-gravel-spill"],
    sets: ["cave"], favour: ["stalagmites", "rocks", "mushrooms", "boulder"],
    wallDensity: 0.3, scatterDensity: 0.08, scatterDecalDensity: 0.08,
  },
  {
    id: "forest-floor", name: "Forest floor", theme: "forest",
    note: "Dark grass under a canopy, a clear stream, bramble underfoot.",
    bind: { ".": "grass-dark", "#": "wall-tree-canopy", "~": "water-shallow-clear", ",": "rough-bramble", "+": "door-wood-plain", "|": "lowwall-log-barricade" },
    floorSpan: 3, roughSpan: 2.4, waterSpan: 3, wallSpan: 2.2, wallTint: "#8c867c", grade: "rgba(255,238,190,.12)", glow: false,
    patch: { id: "leaf-litter", span: 3, t: 0.56, alpha: 0.7, soft: 0.1 },
    wallDecals: "wall-green", shoreDecals: "water", roughDecals: "rough", ground: "grass",
    wallEdge: { blur: 11, amp: 0.34 },
    shore: ["shore-foam","shore-reeds","shore-wet-sand"], lip: ["edge-ivy-lip","edge-leaf-fringe"], fringe: ["rough-bramble-fringe","rough-grass-fringe"],
    sets: ["forest"], favour: ["bush", "fern", "log", "stump", "rocks", "flowers"],
    wallDensity: 0.3, scatterDensity: 0.1, scatterDecalDensity: 0.1,
  },
  {
    id: "mire", name: "Mire", theme: "swamp",
    note: "Peat and reeds, murky water, mangrove tangles for walls.",
    bind: { ".": "peat-swamp", "#": "wall-mangrove", "~": "water-swamp-murky", ",": "rough-reed-bed", "+": "door-wood-plain", "|": "lowwall-wood-fence" },
    floorSpan: 2.6, roughSpan: 2.4, waterSpan: 3, wallSpan: 2, wallTint: "#8a887a", grade: "rgba(190,210,150,.14)", glow: false,
    patch: { id: "mud-flat", span: 3, t: 0.55, alpha: 0.6, soft: 0.1 },
    wallDecals: "wall-earth", shoreDecals: "water", roughDecals: "rough", ground: "earth",
    wallEdge: { blur: 11, amp: 0.34 },
    shore: ["shore-reeds","shore-lily-fringe","shore-scum"], lip: ["edge-root-lip","edge-grass-fringe"], fringe: ["rough-mud-edge","rough-grass-fringe"],
    sets: ["swamp"], favour: ["reeds", "lily-pads", "log", "mushrooms", "fern"],
    wallDensity: 0.28, scatterDensity: 0.1, scatterDecalDensity: 0.08,
  },
  {
    id: "river-bank", name: "River bank", theme: "riverside",
    note: "Damp sand, a running river, cut earth banks.",
    bind: { ".": "sand-beach", "#": "wall-earth-cut", "~": "water-river-flowing", ",": "rough-driftwood", "+": "door-wood-plain", "|": "lowwall-stone-parapet" },
    floorSpan: 2.6, roughSpan: 2.4, waterSpan: 3, wallSpan: 2, wallTint: "#8f8878", grade: "rgba(255,230,190,.12)", glow: false,
    patch: { id: "grass-meadow", span: 3, t: 0.58, alpha: 0.6, soft: 0.1 },
    wallDecals: "wall-earth", shoreDecals: "water", roughDecals: "rough", ground: "sand",
    wallEdge: { blur: 9, amp: 0.3 },
    shore: ["shore-foam","shore-wet-sand","shore-reeds"], lip: ["edge-root-lip","edge-grass-fringe"], fringe: ["rough-gravel-spill","rough-grass-fringe"],
    sets: ["river"], favour: ["rocks", "driftwood", "reeds", "boat"],
    wallDensity: 0.24, scatterDensity: 0.08, scatterDecalDensity: 0.08,
  },
  {
    id: "open-ground", name: "Open ground", theme: "field",
    note: "Meadow grass, hedges, a still pond, a fence with a gap.",
    bind: { ".": "grass-meadow", "#": "wall-hedge-dense", "~": "water-deep-blue", ",": "rough-tall-grass", "+": "door-gate-timber", "|": "lowwall-wood-fence" },
    floorSpan: 3, roughSpan: 2.4, waterSpan: 3, wallSpan: 2, wallTint: "#8f8c80", grade: "rgba(255,238,190,.12)", glow: false,
    patch: { id: "grass-dry", span: 3, t: 0.55, alpha: 0.7, soft: 0.1 },
    wallDecals: "wall-green", shoreDecals: "water", roughDecals: "rough", ground: "grass",
    wallEdge: { blur: 10, amp: 0.32 },
    shore: ["shore-reeds","shore-wet-sand","shore-lily-fringe"], lip: ["edge-ivy-lip","edge-leaf-fringe"], fringe: ["rough-grass-fringe","rough-bramble-fringe"],
    sets: ["field", "garden"], favour: ["bush", "hay-bale", "rocks", "flowers", "stump"],
    wallDensity: 0.22, scatterDensity: 0.09, scatterDecalDensity: 0.08,
  },
  // Named skins, offered in the picker.
  {
    id: "sunken-crypt", name: "Sunken crypt",
    note: "Cracked slabs, collapsed masonry, coffins and candles.",
    bind: { ".": "flagstone-cracked", "#": "wall-rubble-collapsed", "~": "water-blood-pool", ",": "rough-bone-scatter", "+": "door-wood-iron-banded", "|": "lowwall-sarcophagus" },
    floorSpan: 1.6, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.3, wallTint: "#6b6661", grade: "rgba(150,185,220,.16)", glow: false,
    patch: { id: "mud-flat", span: 3, t: 0.58, alpha: 0.45 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    waterAlpha: 0.78,
    shore: ["shore-wet-sand"], lip: ["edge-mortar-lip","edge-rubble-crumbs","edge-cobweb-lip","edge-damp-stain"], fringe: ["rough-bone-fringe","rough-gravel-spill"],
    sets: ["crypt"], favour: ["coffin", "skulls", "candles", "urn", "bones"],
    wallDensity: 0.28, scatterDensity: 0.06, scatterDecalDensity: 0.09,
  },
  {
    id: "overgrown-ruin", name: "Overgrown ruin",
    note: "A dungeon layout read as a ruin in the open: ivy, ferns, fallen timber.",
    bind: { ".": "grass-dark", "#": "wall-ruined-overgrown", "~": "water-shallow-clear", ",": "rough-bramble", "+": "door-rotted-broken", "|": "lowwall-broken-stub" },
    floorSpan: 3, roughSpan: 2.4, waterSpan: 3, wallSpan: 2, wallTint: "#8c867c", grade: "rgba(255,238,190,.12)", glow: false,
    patch: { id: "moss-stone", span: 3, t: 0.55, alpha: 0.6, soft: 0.1 },
    wallDecals: "wall-green", shoreDecals: "water", roughDecals: "rough", ground: "grass",
    wallEdge: { blur: 7, amp: 0.24 },
    shore: ["shore-foam","shore-reeds","shore-wet-sand"], lip: ["edge-ivy-lip","edge-leaf-fringe"], fringe: ["rough-bramble-fringe","rough-grass-fringe"],
    sets: ["ruin", "forest"], favour: ["bush", "fern", "fallen-column", "rubble", "boulder"],
    wallDensity: 0.3, scatterDensity: 0.1, scatterDecalDensity: 0.1,
  },
  {
    id: "volcanic-deep", name: "Volcanic deep",
    note: "Basalt columns, lava in the water's place, and it glows.",
    bind: { ".": "basalt-columns", "#": "wall-volcanic", "~": "hazard-lava-molten", ",": "rough-ash-drifts", "+": "door-stone-slab", "|": "lowwall-stalagmite-row" },
    floorSpan: 1.8, roughSpan: 2.4, waterSpan: 3, wallSpan: 1.2, wallTint: "#57514c", grade: "rgba(255,120,50,.12)", glow: true,
    patch: { id: "ash-grey", span: 3, t: 0.57, alpha: 0.75 },
    wallDecals: "wall-volcanic", shoreDecals: "lava", roughDecals: "rough", ground: "volcanic",
    wallEdge: { blur: 7, amp: 0.26 },
    shore: ["lava-crust","lava-scorch","lava-embers"], lip: ["edge-ash-lip","edge-scorch-lip"], fringe: ["rough-gravel-spill"],
    sets: ["volcanic", "cave"], favour: ["obsidian-shards", "lava-rock", "stalagmites", "boulder"],
    wallDensity: 0.26, scatterDensity: 0.06, scatterDecalDensity: 0.08,
  },
  {
    id: "ship-deck", name: "Ship deck",
    note: "Caulked planking, plank walls, the sea alongside.",
    bind: { ".": "ship-deck", "#": "wall-wood-plank", "~": "water-sea-waves", ",": "rough-debris-crates", "+": "door-wood-plain", "|": "lowwall-barrel-row" },
    floorSpan: 2.4, roughSpan: 2.2, waterSpan: 3.5, wallSpan: 1.6, wallTint: "#7d7466", grade: "rgba(200,215,240,.12)", glow: false,
    patch: null,
    wallDecals: "wall-wood", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-foam"], lip: ["edge-timber-shavings"], fringe: ["rough-gravel-spill"],
    sets: ["ship"], favour: ["barrel", "rope-coil", "cannon", "crate", "fishing-net"],
    wallDensity: 0.3, scatterDensity: 0.06, scatterDecalDensity: 0.05,
  },
  {
    id: "temple", name: "Temple",
    note: "Polished marble, carved panels, a still pool.",
    bind: { ".": "marble-polished", "#": "wall-marble-panel", "~": "water-deep-blue", ",": "rough-pottery-shards", "+": "door-double-ornate", "|": "lowwall-pew-bench" },
    floorSpan: 2, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.4, wallTint: "#8a857c", grade: "rgba(255,230,180,.14)", glow: false,
    patch: { id: "mosaic-temple", span: 3, t: 0.62, alpha: 0.5 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    waterAlpha: 0.78,
    shore: ["shore-wet-sand"], lip: ["edge-mortar-lip","edge-damp-stain"], fringe: ["rough-gravel-spill"],
    sets: ["temple", "library"], favour: ["candelabra", "urn", "lectern", "statue-knight", "bench"],
    wallDensity: 0.24, scatterDensity: 0.04, scatterDecalDensity: 0.04,
  },
  {
    id: "sewer", name: "Sewer",
    note: "Slimed brick, a sludge channel, refuse in the corners.",
    bind: { ".": "sewer-brick", "#": "wall-sewer-stone", "~": "water-sewer-sludge", ",": "rough-mud-churned", "+": "door-cell-bars", "|": "lowwall-rubble-heap" },
    floorSpan: 1.6, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.3, wallTint: "#6c7068", grade: "rgba(150,200,150,.14)", glow: false,
    patch: { id: "mud-flat", span: 3, t: 0.58, alpha: 0.5 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    waterAlpha: 0.78,
    shore: ["shore-scum","shore-wet-sand"], lip: ["edge-damp-stain","edge-cobweb-lip","edge-mortar-lip"], fringe: ["rough-mud-edge","rough-gravel-spill"],
    sets: ["sewer", "prison"], favour: ["sludge-pile", "rat-nest", "barrel-open", "broken-pipe", "bones"],
    wallDensity: 0.26, scatterDensity: 0.06, scatterDecalDensity: 0.09,
  },
  {
    id: "frozen", name: "Frozen",
    note: "Packed snow, ice walls, slush in the low ground.",
    bind: { ".": "snow-packed", "#": "wall-ice", "~": "water-icy-slush", ",": "rough-snow-deep", "+": "door-stone-slab", "|": "lowwall-rubble-heap" },
    floorSpan: 2.6, roughSpan: 2.4, waterSpan: 3, wallSpan: 1.6, wallTint: "#9aa4b0", grade: "rgba(180,210,255,.16)", glow: false,
    patch: { id: "ice-sheet", span: 3, t: 0.6, alpha: 0.5 },
    wallDecals: "wall-ice", shoreDecals: "water", roughDecals: "rough", ground: "ice",
    wallEdge: { blur: 7, amp: 0.24 },
    shore: ["shore-ice-edge","shore-wet-sand"], lip: ["edge-ice-rime","edge-snow-lip"], fringe: ["rough-snow-edge"],
    sets: ["frozen"], favour: ["ice-boulder", "snow-pile", "sled", "rocks"],
    wallDensity: 0.22, scatterDensity: 0.07, scatterDecalDensity: 0.07,
  },
  {
    id: "desert", name: "Desert",
    note: "Rippled sand, adobe walls, a hot spring.",
    bind: { ".": "sand-desert", "#": "wall-adobe", "~": "water-hot-spring", ",": "rough-cactus-scrub", "+": "door-curtain-beaded", "|": "lowwall-sandbag" },
    floorSpan: 3, roughSpan: 2.4, waterSpan: 3, wallSpan: 1.8, wallTint: "#a0937c", grade: "rgba(255,220,150,.16)", glow: false,
    patch: { id: "dirt-cracked", span: 3, t: 0.6, alpha: 0.5 },
    wallDecals: "wall-earth", shoreDecals: "water", roughDecals: "rough", ground: "sand",
    wallEdge: { blur: 6, amp: 0.2 },
    shore: ["shore-wet-sand","shore-reeds"], lip: ["edge-root-lip","edge-grass-fringe"], fringe: ["rough-gravel-spill"],
    sets: ["desert", "market"], favour: ["clay-jars", "cactus", "desert-skull", "sand-dune-rock"],
    wallDensity: 0.22, scatterDensity: 0.07, scatterDecalDensity: 0.07,
  },
  {
    id: "laboratory", name: "Laboratory",
    note: "Slate tiles, iron plate walls, an acid spill.",
    bind: { ".": "slate-tile", "#": "wall-iron-plate", "~": "hazard-acid-pool", ",": "rough-pottery-shards", "+": "door-iron-reinforced", "|": "lowwall-bookshelf" },
    floorSpan: 1.6, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.2, wallTint: "#6f6d6e", grade: "rgba(170,200,190,.14)", glow: false,
    patch: { id: "metal-plate", span: 3, t: 0.62, alpha: 0.4 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    waterAlpha: 0.78,
    shore: ["shore-wet-sand"], lip: ["edge-mortar-lip","edge-damp-stain"], fringe: ["rough-gravel-spill"],
    sets: ["lab", "arcane"], favour: ["alchemy-bench", "cauldron", "shelf-jars", "book-pile", "crystal-ball"],
    wallDensity: 0.28, scatterDensity: 0.04, scatterDecalDensity: 0.06,
  },
  {
    id: "tavern", name: "Tavern",
    note: "Worn boards, log walls, the hearth and the kegs.",
    bind: { ".": "wood-plank-worn", "#": "wall-wood-log", "~": "water-flooded-floor", ",": "rough-debris-crates", "+": "door-wood-plain", "|": "lowwall-market-counter" },
    floorSpan: 2, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.6, wallTint: "#867a68", grade: "rgba(255,210,150,.16)", glow: false,
    patch: { id: "carpet-red", span: 3, t: 0.64, alpha: 0.6, soft: 0.06 },
    wallDecals: "wall-wood", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    waterAlpha: 0.78,
    shore: ["shore-wet-sand"], lip: ["edge-timber-shavings"], fringe: ["rough-gravel-spill"],
    sets: ["tavern", "kitchen"], favour: ["table-round", "stool", "keg-rack", "barrel", "chair"],
    wallDensity: 0.3, scatterDensity: 0.08, scatterDecalDensity: 0.05,
  },
  // ---- the other settings (docs/visual-overhaul-plan.md 8b.1) ----
  {
    id: "cp-street", name: "Neon street", genre: "cyberpunk", theme: "interior",
    note: "Wet asphalt, neon walls, an oil slick, cables underfoot.",
    bind: { ".": "cp-asphalt-wet", "#": "cp-wall-neon", "~": "cp-oil-slick", ",": "cp-cable-tangle", "+": "cp-door-cage", "|": "cp-lowwall-crash-barrier" },
    floorSpan: 2.4, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.6, wallTint: "#8a8494", grade: "rgba(120,90,220,.14)", glow: false,
    patch: { id: "cp-concrete-plaza", span: 3, t: 0.6, alpha: 0.5 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-wet-sand"], lip: ["edge-damp-stain", "edge-rubble-crumbs"], fringe: ["rough-gravel-spill"],
    sets: ["cyberpunk"], favour: ["cp-dumpster", "cp-vending-machine", "cp-trash-pile", "cp-crate-plastic"],
    wallDensity: 0.28, scatterDensity: 0.06, scatterDecalDensity: 0.08,
  },
  {
    id: "cp-corp", name: "Corporate floor", genre: "cyberpunk", theme: "interior",
    note: "Holo tile, chrome partitions, coolant, server racks.",
    bind: { ".": "cp-holo-tile", "#": "cp-wall-chrome", "~": "cp-coolant", ",": "cp-scrap-electronics", "+": "cp-door-sliding-glass", "|": "cp-lowwall-console" },
    floorSpan: 1.8, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.2, wallTint: "#8f96a3", grade: "rgba(80,170,255,.12)", glow: false,
    patch: { id: "cp-server-floor", span: 3, t: 0.62, alpha: 0.4 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-wet-sand"], lip: ["edge-damp-stain"], fringe: ["rough-gravel-spill"],
    sets: ["cyberpunk"], favour: ["cp-terminal", "cp-server-rack", "cp-med-pod", "cp-holo-table"],
    wallDensity: 0.26, scatterDensity: 0.03, scatterDecalDensity: 0.03,
  },
  {
    id: "cp-yard", name: "Container yard", genre: "cyberpunk", theme: "field",
    note: "Concrete, containers, chain link, a toxic puddle.",
    bind: { ".": "cp-concrete-plaza", "#": "cp-wall-container", "~": "cp-toxic-runoff", ",": "cp-rubble-concrete", "+": "cp-door-cage", "|": "cp-lowwall-crates" },
    floorSpan: 2.6, roughSpan: 2.4, waterSpan: 3, wallSpan: 2, wallTint: "#8c8580", grade: "rgba(255,200,120,.1)", glow: false,
    patch: { id: "cp-rooftop-gravel", span: 3, t: 0.58, alpha: 0.5 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-scum"], lip: ["edge-rubble-crumbs", "edge-damp-stain"], fringe: ["rough-gravel-spill"],
    sets: ["cyberpunk"], favour: ["cp-cable-spool", "cp-barrel-chem", "cp-crate-plastic", "cp-drone-wreck"],
    wallDensity: 0.26, scatterDensity: 0.07, scatterDecalDensity: 0.07,
  },
  {
    id: "sp-foundry", name: "Foundry", genre: "steampunk", theme: "interior",
    note: "Iron plate, boiler walls, a steam pool, gears underfoot.",
    bind: { ".": "sp-iron-plate", "#": "sp-wall-boiler", "~": "sp-steam-pool", ",": "sp-gear-scrap", "+": "sp-door-brass", "|": "sp-lowwall-pipe-rail" },
    floorSpan: 1.8, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.3, wallTint: "#8a7f70", grade: "rgba(255,190,120,.16)", glow: false,
    patch: { id: "sp-brass-plate", span: 3, t: 0.62, alpha: 0.4 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-wet-sand"], lip: ["edge-damp-stain", "edge-rubble-crumbs"], fringe: ["rough-gravel-spill"],
    sets: ["steampunk"], favour: ["sp-boiler", "sp-workbench", "sp-pipe-stack", "sp-oil-can"],
    wallDensity: 0.28, scatterDensity: 0.05, scatterDecalDensity: 0.06,
  },
  {
    id: "sp-street", name: "Gaslit street", genre: "steampunk", theme: "field",
    note: "Wet cobbles, sooty brick, the canal, coal spills.",
    bind: { ".": "sp-cobbles-gaslit", "#": "sp-wall-brick-soot", "~": "sp-water-canal", ",": "sp-coal-heap", "+": "sp-door-cage-lift", "|": "sp-lowwall-crate-row" },
    floorSpan: 2.4, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.6, wallTint: "#7e766c", grade: "rgba(255,200,130,.14)", glow: false,
    patch: { id: "sp-tiles-victorian", span: 3, t: 0.64, alpha: 0.35 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-wet-sand", "shore-scum"], lip: ["edge-damp-stain", "edge-mortar-lip"], fringe: ["rough-gravel-spill"],
    sets: ["steampunk"], favour: ["sp-gaslamp", "sp-airship-crate", "sp-coal-cart", "sp-toolbox"],
    wallDensity: 0.26, scatterDensity: 0.06, scatterDecalDensity: 0.07,
  },
  {
    id: "pa-highway", name: "Dead highway", genre: "post_apocalyptic", theme: "field",
    note: "Cracked asphalt, car wrecks, toxic sludge, scrap.",
    bind: { ".": "pa-asphalt-cracked", "#": "pa-wall-car-wrecks", "~": "pa-toxic-sludge", ",": "pa-scrap-field", "+": "pa-door-chain-gate", "|": "pa-lowwall-tyre-row" },
    floorSpan: 2.6, roughSpan: 2.4, waterSpan: 3, wallSpan: 2.2, wallTint: "#8a8078", grade: "rgba(255,210,150,.14)", glow: false,
    patch: { id: "pa-ash-dust", span: 3, t: 0.58, alpha: 0.55 },
    wallEdge: { blur: 7, amp: 0.24 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-scum", "shore-wet-sand"], lip: ["edge-rubble-crumbs", "edge-damp-stain"], fringe: ["rough-gravel-spill"],
    sets: ["wasteland"], favour: ["pa-fuel-barrel", "pa-tyre", "pa-scrap-pile", "pa-shopping-cart"],
    wallDensity: 0.26, scatterDensity: 0.08, scatterDecalDensity: 0.08,
  },
  {
    id: "pa-bunker", name: "Bunker", genre: "post_apocalyptic", theme: "interior",
    note: "Stained concrete, rubble barricades, rust water.",
    bind: { ".": "pa-bunker-concrete", "#": "pa-wall-rubble-barricade", "~": "pa-rust-water", ",": "pa-debris-plaster", "+": "pa-door-welded", "|": "pa-lowwall-sandbags" },
    floorSpan: 2, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.6, wallTint: "#7f7a74", grade: "rgba(200,220,180,.12)", glow: false,
    patch: { id: "pa-rusted-plate", span: 3, t: 0.62, alpha: 0.4 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-wet-sand"], lip: ["edge-rubble-crumbs", "edge-damp-stain", "edge-cobweb-lip"], fringe: ["rough-gravel-spill"],
    sets: ["wasteland"], favour: ["pa-crate-supplies", "pa-generator", "pa-radio", "pa-mattress"],
    wallDensity: 0.28, scatterDensity: 0.05, scatterDecalDensity: 0.08,
  },
  {
    id: "hr-manor", name: "Rotting manor", genre: "horror", theme: "interior",
    note: "Rotten boards, mould brick, black water, bones.",
    bind: { ".": "hr-boards-rotten", "#": "hr-wall-mould-brick", "~": "hr-black-water", ",": "hr-rot-debris", "+": "hr-door-nailed", "|": "hr-lowwall-pews" },
    floorSpan: 2, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.4, wallTint: "#6f6a66", grade: "rgba(120,140,170,.16)", glow: false,
    patch: { id: "hr-carpet-rotting", span: 3, t: 0.63, alpha: 0.5 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-scum"], lip: ["edge-cobweb-lip", "edge-damp-stain"], fringe: ["rough-bone-fringe"],
    sets: ["horror"], favour: ["hr-candles-black", "hr-doll", "hr-chains", "hr-mirror"],
    wallDensity: 0.26, scatterDensity: 0.06, scatterDecalDensity: 0.1,
  },
  {
    id: "hr-flesh", name: "Flesh pit", genre: "horror", theme: "cave",
    note: "Pulsing flesh floor, walls of teeth, bile pools, viscera.",
    bind: { ".": "hr-flesh-floor", "#": "hr-wall-flesh", "~": "hr-bile-pool", ",": "hr-viscera", "+": "hr-door-flesh", "|": "hr-lowwall-cages" },
    floorSpan: 2.2, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.6, wallTint: "#8a6a68", grade: "rgba(200,60,60,.14)", glow: false,
    patch: { id: "hr-grave-earth", span: 3, t: 0.62, alpha: 0.4 },
    wallEdge: { blur: 9, amp: 0.3 },
    wallDecals: "wall-earth", shoreDecals: "water", roughDecals: "rough", ground: "earth",
    shore: ["shore-scum"], lip: ["edge-root-lip"], fringe: ["rough-mud-edge", "rough-bone-fringe"],
    sets: ["horror"], favour: ["hr-cocoon", "hr-bones-pile", "hr-chains"],
    wallDensity: 0.24, scatterDensity: 0.07, scatterDecalDensity: 0.09,
  },
  {
    id: "my-townhouse", name: "Townhouse", genre: "mystery", theme: "interior",
    note: "Parquet, damask walls, the chequered hall.",
    bind: { ".": "my-parquet-victorian", "#": "my-wall-wallpaper", "~": "my-puddle-rain", ",": "my-papers-scattered", "+": "my-door-panelled", "|": "my-lowwall-sofa" },
    floorSpan: 2, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.4, wallTint: "#8c8478", grade: "rgba(255,215,160,.16)", glow: false,
    patch: { id: "my-carpet-persian", span: 3, t: 0.64, alpha: 0.6, soft: 0.06 },
    wallDecals: "wall-wood", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-wet-sand"], lip: ["edge-timber-shavings"], fringe: ["rough-gravel-spill"],
    sets: ["mystery"], favour: ["my-armchair", "my-writing-desk", "my-tea-set", "my-fireplace"],
    wallDensity: 0.3, scatterDensity: 0.04, scatterDecalDensity: 0.04,
  },
  {
    id: "my-alley", name: "Gaslit alley", genre: "mystery", theme: "field",
    note: "Wet cobbles, brick alleys, a canal, leaves and rubbish.",
    bind: { ".": "my-cobbles-wet", "#": "my-wall-brick-alley", "~": "my-canal", ",": "my-rubbish-alley", "+": "my-door-shop", "|": "my-lowwall-railing" },
    floorSpan: 2.4, roughSpan: 2.2, waterSpan: 3, wallSpan: 1.6, wallTint: "#7a746e", grade: "rgba(180,200,230,.14)", glow: false,
    patch: { id: "my-pavement-flag", span: 3, t: 0.6, alpha: 0.45 },
    wallDecals: "wall-stone", shoreDecals: "water", roughDecals: "rough", ground: "stone",
    shore: ["shore-wet-sand", "shore-scum"], lip: ["edge-damp-stain", "edge-mortar-lip"], fringe: ["rough-gravel-spill"],
    sets: ["mystery"], favour: ["my-street-lamp", "my-crates-dock", "my-newspaper-stack"],
    wallDensity: 0.26, scatterDensity: 0.06, scatterDecalDensity: 0.08,
  },
];

// Fantasy defaults by theme; the other settings by (genre, theme), falling
// back to the genre's first skin, then to fantasy.
export const DEFAULT_SKIN_BY_THEME: Record<string, string> = Object.fromEntries(
  SKINS.filter((s) => s.theme && !s.genre).map((s) => [s.theme as string, s.id]),
);

export const GENRES: string[] = [...new Set(SKINS.map((s) => s.genre).filter((g): g is string => Boolean(g)))];

export function skinById(id: string): Skin | undefined {
  return SKINS.find((s) => s.id === id);
}

// The id of the skin a map wears when nobody chose one: the setting's skin for
// that theme, then any skin of the setting, then the fantasy skin for the
// theme. Fantasy settings and unknown ones have no skins of their own.
export function defaultSkinFor(genre: string | null | undefined, theme: string | null | undefined): string {
  const setting = (genre || "").toLowerCase().replace(/-/g, "_");
  const own = GENRES.includes(setting) ? setting : null;
  if (own) {
    const exact = SKINS.find((s) => s.genre === own && s.theme === theme);
    if (exact) return exact.id;
    const any = SKINS.find((s) => s.genre === own);
    if (any) return any.id;
  }
  return DEFAULT_SKIN_BY_THEME[theme || ""] ?? SKINS[0].id;
}

export function skinFor(genre: string | null | undefined, theme: string | null | undefined): Skin {
  return skinById(defaultSkinFor(genre, theme)) ?? SKINS[0];
}

// ---- A map's own skin (docs/visual-overhaul-plan.md 3.8, 4.4) ----
//
// A map may name one of the skins above and may override any of the six
// terrain characters with another material. Stored as `skin_json` beside the
// scene columns and normalised on every read and write, so a map can never
// hold a key that is not a terrain character or an id that is not shaped like
// one. Whether an id is a material that SHIPPED is decided where the catalogue
// is known (the painter, below): an unknown one falls back to the skin's own,
// so a map drawn against a newer tile set still paints on an older host.

export const SKIN_CHARS = [".", "#", "~", ",", "+", "|"] as const;
export type SkinChar = (typeof SKIN_CHARS)[number];

// What each character is called in the picker and which catalogue categories
// may paint it (public/assets/tiles/manifest.json `category`). Lava is a
// hazard that paints as the liquid, which is why water takes two.
export const SKIN_ROLES: Record<SkinChar, { label: string; categories: readonly string[] }> = {
  ".": { label: "Floor", categories: ["floor"] },
  "#": { label: "Wall", categories: ["wall"] },
  "~": { label: "Water", categories: ["water", "hazard"] },
  ",": { label: "Rough ground", categories: ["rough", "hazard"] },
  "+": { label: "Door", categories: ["door"] },
  "|": { label: "Low wall", categories: ["lowwall"] },
};

export type MapSkin = {
  // A skin id from SKINS, or "" for the default the setting and theme give.
  id: string;
  // Terrain character to material id, only for the characters overridden.
  bind: Partial<Record<SkinChar, string>>;
};

export const EMPTY_MAP_SKIN: MapSkin = { id: "", bind: {} };

const MATERIAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MATERIAL_ID_MAX = 64;

export function isMaterialId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MATERIAL_ID_MAX && MATERIAL_ID.test(value);
}

export function normalizeMapSkin(raw: unknown): MapSkin {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { id: "", bind: {} };
  }
  const source = raw as { id?: unknown; bind?: unknown };
  const id = typeof source.id === "string" && skinById(source.id) ? source.id : "";
  const bind: MapSkin["bind"] = {};
  if (source.bind && typeof source.bind === "object" && !Array.isArray(source.bind)) {
    for (const char of SKIN_CHARS) {
      const material = (source.bind as Record<string, unknown>)[char];
      if (isMaterialId(material)) {
        bind[char] = material;
      }
    }
  }
  return { id, bind };
}

export function isEmptyMapSkin(skin: MapSkin | null | undefined): boolean {
  return !skin || (!skin.id && Object.keys(skin.bind).length === 0);
}

// Stable text for cache keys and change checks.
export function mapSkinKey(skin: MapSkin | null | undefined): string {
  if (isEmptyMapSkin(skin)) {
    return "";
  }
  const own = skin as MapSkin;
  return `${own.id}:${SKIN_CHARS.map((char) => own.bind[char] ?? "").join(",")}`;
}

// The skin a map is painted with: the one it names (else the default for its
// setting and theme) with its overrides laid over. `catalogue` maps a
// material id to its category; when given, an override that is not in it, or
// is the wrong kind of thing for its character, is dropped. An override that
// matches the skin's own material is a no-op and the very same Skin object
// comes back, so callers can compare by identity.
export function resolveSkin(
  genre: string | null | undefined,
  theme: string | null | undefined,
  mapSkin?: MapSkin | null,
  catalogue?: ReadonlyMap<string, string> | null,
): Skin {
  const base = (mapSkin?.id ? skinById(mapSkin.id) : undefined) ?? skinFor(genre, theme);
  if (!mapSkin) {
    return base;
  }
  let bind: Record<string, string> | null = null;
  for (const char of SKIN_CHARS) {
    const material = mapSkin.bind[char];
    if (!material || material === base.bind[char] || !isMaterialId(material)) {
      continue;
    }
    if (catalogue) {
      const category = catalogue.get(material);
      if (!category || !SKIN_ROLES[char].categories.includes(category)) {
        continue;
      }
    }
    bind ??= { ...base.bind };
    bind[char] = material;
  }
  return bind ? { ...base, bind } : base;
}

// The picker's list: the setting's own skins first, then the fantasy ones
// (every setting can wear them), then the other settings'.
export function skinChoices(genre: string | null | undefined): Array<{ group: string; skins: Skin[] }> {
  const setting = (genre || "").toLowerCase().replace(/-/g, "_");
  const own = GENRES.includes(setting) ? setting : null;
  const groups: Array<{ group: string; skins: Skin[] }> = [];
  if (own) {
    groups.push({ group: "This setting", skins: SKINS.filter((s) => s.genre === own) });
  }
  groups.push({ group: own ? "Fantasy" : "This setting", skins: SKINS.filter((s) => !s.genre) });
  const rest = SKINS.filter((s) => s.genre && s.genre !== own);
  if (rest.length) {
    groups.push({ group: "Other settings", skins: rest });
  }
  return groups;
}
