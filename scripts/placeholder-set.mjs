// The catalogue of default placeholder art: every thumbnail slot the app and
// the client shells can show before a real picture exists.
//
// One design language covers all of it, so a table that has generated nothing
// still looks like one product: a backlit amber sun disc behind a solid
// charcoal shape, gold ember haze, heavy vignette, no text anywhere. People
// and creatures are shadow-puppet silhouettes (no faces to get wrong, and no
// implied skin tone or body that a real character has to live up to); places
// and objects are the same light on a wider plate.
//
// Consumed by scripts/generate-placeholders.mjs. Pure data plus prompt
// assembly, no I/O, so the prompts can be inspected with --dry-run.

// ---- the shared look ----

// The composition is the constant, not the colour: a solid charcoal shape, one
// glowing disc of light behind it, heavy vignette, no text. Swapping only the
// light source keeps a cyberpunk tile and a high fantasy tile recognisably the
// same system while letting each genre look like itself.
//
// The three keys mirror what src/lib/genres.ts already declares for these
// settings, so a placeholder and a generated portrait agree: cyberpunk is
// "neon-lit ... rain-slick city glow", steampunk is "gaslight and copper
// tones". `bans` is the colour half of the negative prompt, and has to be the
// inverse of the key or the model is fighting itself.
const PALETTES = {
  default: {
    key: "large glowing amber sun disc directly behind the subject, warm gold mist",
    rim: "thin golden rim light along the edge",
    motes: "drifting embers",
    name: "monochrome amber and charcoal palette",
    sceneKey: "strong backlight from a low amber sun",
    sceneHaze: "warm gold and ember haze",
    bans: "purple, magenta, violet, neon blue, cyan, green",
  },
  cyberpunk: {
    key: "large glowing cyan and magenta disc directly behind the subject, rain-slick haze",
    rim: "thin cyan rim light along the edge with magenta bounce",
    motes: "falling rain and neon bloom",
    name: "teal and magenta neon palette on near-black",
    sceneKey: "strong backlight from a low cyan and magenta glow",
    sceneHaze: "wet neon glow and drifting steam",
    bans: "amber, gold, orange, warm sunlight, sepia, brass, (signage:1.4), (lettering:1.4), billboard, shop sign",
  },
  steampunk: {
    key: "large glowing copper gaslight disc directly behind the subject, brass and steam haze",
    rim: "thin copper rim light along the edge",
    motes: "drifting steam and coal smoke",
    name: "sepia, brass and copper palette on charcoal",
    sceneKey: "strong backlight from a low gaslight glow",
    sceneHaze: "brass and copper haze thick with steam",
    bans: "purple, magenta, violet, neon blue, cyan, green",
  },
};

function portraitStyle(palette) {
  const p = PALETTES[palette];
  return (
    `solid black cutout shape, ${p.key}, ${p.rim}, dark charcoal background, ` +
    `heavy vignette, ${p.motes}, painterly digital matte painting, high contrast, ` +
    `minimal, ${p.name}`
  );
}

function sceneStyle(palette) {
  const p = PALETTES[palette];
  return (
    `${p.sceneKey}, foreground shapes in deep charcoal silhouette, ${p.sceneHaze}, ` +
    `layered depth, heavy vignette, painterly digital matte painting, cinematic, ` +
    `minimal, ${p.name}`
  );
}

export function portraitNegative(palette = "default") {
  return (
    "face, facial features, eyes, nose, mouth, visible skin, front lighting, " +
    `${PALETTES[palette].bans}, ` +
    "text, letters, words, watermark, signature, logo, caption, border, frame, " +
    "low quality, blurry, deformed hands, extra fingers, extra limbs, anime, cartoon, " +
    "nsfw, nude, naked, shirtless, bare chest, bare torso, cleavage, bare midriff, " +
    "revealing clothing, sexualized, lingerie, " +
    // Framing, restated as a ban: half of the first run came back as a
    // full-length figure on a hilltop, which is a speck in a 44px avatar.
    "full body, full length, wide shot, small distant figure, legs, feet, boots, " +
    "standing on a hilltop, landscape, scenery"
  );
}

export function sceneNegative(palette = "default", { peopled = false } = {}) {
  // One plate is about the party, so it cannot ban the very thing it shows.
  const subjects = peopled
    ? "face, facial features, visible skin, front lighting, nude, "
    : "people, figures, crowd, face, portrait, ";
  return (
    subjects +
    `${PALETTES[palette].bans}, ` +
    "text, letters, words, watermark, signature, logo, caption, border, frame, " +
    "low quality, blurry, anime, cartoon, nsfw"
  );
}

// Portraits are shown square and usually masked into a circle 44 pixels
// across (CastList, the party panel), so the framing clause leads the prompt
// rather than trailing it: asked for a figure at the end of a sentence the
// model happily paints a full-length one standing on a hilltop, which is a
// speck once it is cropped to a circle.
//
// Three framings, one light. A person is a chest-up bust, because every cue
// that tells a drow from a dragonborn sits on the head. A monster gets its
// upper body, because an ooze cropped at the shoulders is nothing. A sigil is
// an object filling the frame.
const FRAMING = {
  bust:
    "Tight head and shoulders portrait, cropped at the chest, the figure filling the frame, " +
    "head large and centred, fully clothed in practical layered clothing",
  creature: "Head and upper body of the creature, filling the frame, centred",
  sigil: "A single centred shape filling the frame",
};

// Cues that only some subjects have. A silhouette is nothing but outline, so
// an elf that picks up a stray pair of horns is simply the wrong race; each
// portrait bans the outline features its own description never asked for.
const OPTIONAL_CUES = [
  { has: /horn|antler/i, ban: "horns, antlers" },
  { has: /tail/i, ban: "tail" },
  { has: /wing/i, ban: "wings" },
  // Companion animals count as asking for a muzzle: the packmaster's hound
  // and the ratcatcher's rats are the point of those two silhouettes.
  { has: /snout|beak|feline|reptilian|crow|turtle|draconic|hound|rat\b|rats|beast/i, ban: "animal head, snout, beak, muzzle" },
];

function banUnaskedCues(description) {
  return OPTIONAL_CUES.filter((cue) => !cue.has.test(description))
    .map((cue) => cue.ban)
    .join(", ");
}

function portraitPrompt(subject, framing = "bust", palette = "default") {
  const prompt = `${FRAMING[framing]}. Shadow puppet style silhouette of ${subject}. ${portraitStyle(palette)}`;
  // Monsters and sigils are meant to sprout horns and wings; only the people
  // are held to the race they were asked for.
  const banned = framing === "bust" ? banUnaskedCues(subject) : "";
  const negative = portraitNegative(palette);
  return { prompt, negative: banned ? `${negative}, ${banned}` : negative };
}

// "no people" lives in the negative rather than the style, so the one plate
// that is about the party does not have to strip it back out of a sentence.
function scenePrompt(subject, palette = "default", peopled = false) {
  return {
    prompt: `${subject}. ${sceneStyle(palette)}`,
    negative: sceneNegative(palette, { peopled }),
  };
}

// Ids in the genre lists are prefixed with the genre they belong to
// (cyberpunk-neon-alley, steampunk-factory), which is also how a lookup finds
// them, so the prefix is the single source of truth for which light to use.
function paletteForId(id) {
  if (id.startsWith("cyberpunk")) {
    return "cyberpunk";
  }
  if (id.startsWith("steampunk")) {
    return "steampunk";
  }
  return "default";
}

// ---- who is in a portrait ----

// Three variants per race and class rather than a full cross product: the
// caller knows a race or a class or neither, and 22 x 13 x 3 renders would
// buy nothing a silhouette can actually show.
const GENDERS = {
  masculine: { build: "a broad-shouldered masculine", hair: "short hair", beard: "a full beard" },
  feminine: { build: "a feminine", hair: "long braided hair", beard: "long braided hair" },
  neutral: { build: "an androgynous", hair: "shoulder-length hair", beard: "shoulder-length hair" },
};

export const GENDER_IDS = Object.keys(GENDERS);

// `traits` are the outline cues that survive being reduced to a black shape:
// ear points, horns, tails, snouts, build. Anything that only reads as colour
// or texture is left out on purpose. `facial` swaps on gender where a beard
// would otherwise be put on every dwarf alive.
const RACES = [
  { id: "human", name: "Human", traits: "an ordinary travelling cloak", facial: true },
  { id: "elf", name: "Elf", traits: "long pointed ears and flowing hair" },
  { id: "drow", name: "Drow", traits: "long pointed ears, straight hair and a deep hood" },
  { id: "half-elf", name: "Half-elf", traits: "slightly pointed ears and a travelling cloak" },
  { id: "dwarf", name: "Dwarf", traits: "a short stout heavy build and broad shoulders", facial: true },
  { id: "halfling", name: "Halfling", traits: "a small round-bodied build, curly hair and a hooded cloak" },
  { id: "gnome", name: "Gnome", traits: "a small slight build, a pointed cap and goggles" },
  { id: "half-orc", name: "Half-orc", traits: "a heavy muscular build, jutting tusks and a low brow" },
  { id: "dragonborn", name: "Dragonborn", traits: "a draconic snouted head, neck frill and a scaled tail" },
  { id: "tiefling", name: "Tiefling", traits: "long curling horns and a slender pointed tail" },
  { id: "aasimar", name: "Aasimar", traits: "a halo of light and faint feathered wings folded behind" },
  { id: "goliath", name: "Goliath", traits: "a towering hugely broad build and a bald head" },
  { id: "firbolg", name: "Firbolg", traits: "a very tall heavy build, a long nose and a moss-hung cloak" },
  { id: "tabaxi", name: "Tabaxi", traits: "a feline head with tufted ears, whiskers and a long tail" },
  { id: "kenku", name: "Kenku", traits: "a crow head with a heavy beak and ragged feathered shoulders" },
  { id: "tortle", name: "Tortle", traits: "a domed turtle shell on the back and a beaked head" },
  { id: "genasi", name: "Genasi", traits: "hair streaming upward like flame and a wisp of elemental smoke" },
  { id: "changeling", name: "Changeling", traits: "a smooth blank featureless head and a plain hooded robe" },
  { id: "warforged", name: "Warforged", traits: "an angular plated construct body with visible joints and a faceplate" },
  { id: "goblin", name: "Goblin", traits: "a small wiry build, huge pointed ears and scavenged armour" },
  { id: "bugbear", name: "Bugbear", traits: "a hulking shaggy build, long arms and tall pointed ears" },
  { id: "lizardfolk", name: "Lizardfolk", traits: "a reptilian snouted head, a back crest and a thick tail" },
];

// Silhouette shorthand for a class: the gear is the whole tell.
const CLASSES = [
  { id: "artificer", name: "Artificer", traits: "a clockwork gauntlet, a tool bandolier and a mechanical familiar on the shoulder" },
  { id: "barbarian", name: "Barbarian", traits: "a great axe over the shoulder, fur mantle and bare heavy arms" },
  { id: "bard", name: "Bard", traits: "a lute held across the chest and a feathered travelling hat" },
  { id: "cleric", name: "Cleric", traits: "a heavy mace and a round shield bearing a radiant symbol, plate and vestments" },
  { id: "druid", name: "Druid", traits: "an antlered headdress, a leaf-wrapped staff and a cloak of hanging moss" },
  { id: "fighter", name: "Fighter", traits: "full plate armour, a longsword raised and a kite shield" },
  { id: "monk", name: "Monk", traits: "a wrapped sash robe, bound forearms and a quarterstaff held level" },
  { id: "paladin", name: "Paladin", traits: "heavy plate armour, a high tower shield and a greatsword held upright before the chest" },
  { id: "ranger", name: "Ranger", traits: "a hood, a longbow and a quiver of arrows at the shoulder" },
  { id: "rogue", name: "Rogue", traits: "a deep hood, a short cloak and two daggers held low" },
  { id: "sorcerer", name: "Sorcerer", traits: "arcane sparks curling around a raised open hand and a flowing coat" },
  { id: "warlock", name: "Warlock", traits: "a tattered cloak, a floating occult grimoire and drifting eldritch motes" },
  { id: "wizard", name: "Wizard", traits: "a pointed hat, long robes and a gnarled staff topped with a glowing orb" },
];

// The stand-ins for a named NPC before anyone paints one.
const NPC_ROLES = [
  { id: "merchant", subject: "a merchant in a heavy travelling coat with a strongbox under one arm and a laden pack" },
  { id: "guard", subject: "a town guard in a helm and mail with a spear held upright and a lantern" },
  { id: "innkeeper", subject: "an innkeeper in a long apron carrying a tray of tankards" },
  { id: "noble", subject: "a noble in a high-collared fur-trimmed cloak and a slender circlet" },
  { id: "priest", subject: "a priest in heavy vestments holding a censer on a chain" },
  { id: "scholar", subject: "a scholar in a hooded robe carrying a stack of books and a rolled chart" },
  { id: "thief", subject: "a cutpurse in a low hood with a coiled rope and a knife at the belt" },
  { id: "soldier", subject: "a soldier in a tabard and mail with a sheathed sword and a marching pack" },
  { id: "commoner", subject: "a villager in a patched smock and headscarf carrying a bundle of firewood" },
  { id: "mercenary", subject: "a sellsword in mismatched armour with a greatsword across the back" },
  { id: "ruler", subject: "a crowned ruler in a long mantle holding a sceptre" },
  { id: "outcast", subject: "a ragged wanderer in a tattered cloak leaning on a crooked walking stick" },
];

// Bestiary tiles keyed by the SRD creature type, so an unpainted stat block
// still gets something that matches what it is.
const MONSTER_TYPES = [
  { id: "aberration", subject: "an aberration, a bulbous eye-stalked horror with writhing tentacles" },
  { id: "beast", subject: "a great wolf standing alert, head lowered" },
  { id: "celestial", subject: "a celestial, a tall winged figure with a halo and a raised sword" },
  { id: "construct", subject: "a stone golem construct with blocky shoulders and heavy fists" },
  { id: "dragon", subject: "a dragon with spread wings and a long horned head, rearing" },
  { id: "elemental", subject: "an elemental, a churning column of flame and rubble with rough arms" },
  { id: "fey", subject: "a fey creature, a slender antlered figure with dragonfly wings" },
  { id: "fiend", subject: "a fiend with curled ram horns, bat wings and a barbed tail" },
  { id: "giant", subject: "a giant, an enormous hunched figure gripping an uprooted tree as a club" },
  { id: "humanoid", subject: "a hunched armoured raider with a crooked blade" },
  { id: "monstrosity", subject: "a monstrosity, a many-legged chimeric beast with a spined back" },
  { id: "ooze", subject: "an ooze, a sagging dripping amorphous blob creeping forward" },
  { id: "plant", subject: "a plant creature, a shambling mound of vines, roots and hanging moss" },
  { id: "undead", subject: "an undead skeletal figure in a rotted shroud with a rusted blade" },
];

// Sigils a player can take as an avatar: the same backlit shape language, one
// clear object each, so they read at 44 pixels in a circle.
const AVATAR_SIGILS = [
  { id: "wolf", subject: "a wolf's head in profile, howling" },
  { id: "raven", subject: "a raven with folded wings perched on a bare branch" },
  { id: "stag", subject: "a stag's head with tall spreading antlers" },
  { id: "dragon", subject: "a dragon's head in profile with swept horns" },
  { id: "tower", subject: "a lone watchtower on a crag" },
  { id: "oak", subject: "a broad ancient oak tree" },
  { id: "ship", subject: "a single-masted ship under sail" },
  { id: "flame", subject: "a burning brazier on a tall stand" },
];

// Genres come from src/lib/genres.ts; three plates each so a shelf of new
// campaigns in the same genre is not three copies of one picture.
const GENRE_COVERS = {
  high_fantasy: [
    "A white spired castle on a green hill above a river valley at dawn",
    "A wide stone bridge crossing a gorge toward a distant mountain gate",
    "A sunlit forest clearing with a ring of standing stones",
  ],
  dark_fantasy: [
    "A blighted keep on a bare ridge under a heavy smoke-choked sky",
    "A field of leaning grave markers before a ruined cathedral",
    "A drowned village of broken roofs in a black marsh",
  ],
  mystery: [
    "A narrow rain-slick city street of shuttered townhouses at dusk, one window lit",
    "A cluttered study with an open ledger, a spilled cup and a single burning lamp",
    "A fog-bound harbour of moored boats and empty wharves",
  ],
  horror: [
    "A crooked manor house at the end of a dead avenue of leafless trees",
    "A cellar stair descending into darkness beneath a bare hanging bulb of candlelight",
    "A bone-strewn chapel with a toppled altar and torn banners",
  ],
  cyberpunk: [
    "A dense skyline of towers and antenna masts above a canyon of streets",
    "A rain-wet alley of stacked signage, cables and vents",
    "An overpass of stalled traffic under a vast corporate arcology",
  ],
  steampunk: [
    "A city of brass chimneys and pipework under a sky of tethered airships",
    "A vast factory floor of flywheels, pistons and catwalks",
    "An iron railway viaduct striding across a smoking valley",
  ],
  post_apocalyptic: [
    "A drowned skyline of gutted towers above a dust plain",
    "A convoy road of wrecked vehicles running to the horizon",
    "A scrap settlement of sheet-metal shelters around a water tower",
  ],
  custom: [
    "A lone traveller's road running over open hills to an unknown horizon",
    "An open gateway of weathered stone standing alone in a wide plain",
    "A vast unrolled map spread on a table beside a compass and a lamp",
  ],
};

// Scene and battle-map tiles by setting, for the map drawer and the scene
// strip. Deliberately wider than the genre list: a dungeon corridor turns up
// in every genre the app ships.
const MAP_SETTINGS = [
  { id: "dungeon", subject: "A vaulted stone dungeon corridor lined with iron sconces" },
  { id: "cavern", subject: "A vast natural cavern of stalactites above an underground pool" },
  { id: "crypt", subject: "A pillared crypt of stacked stone sarcophagi" },
  { id: "sewer", subject: "A brick sewer tunnel with a channel of still water and a grated opening" },
  { id: "castle-hall", subject: "A great castle hall with a long table, high windows and hanging banners" },
  { id: "throne-room", subject: "A throne room with a raised dais, a tall empty throne and colonnades" },
  { id: "temple", subject: "A temple interior of tall columns, a stepped altar and shafts of light" },
  { id: "library", subject: "A library of towering shelves, ladders and reading tables" },
  { id: "tavern", subject: "A tavern common room of heavy tables, a bar and a wide hearth" },
  { id: "market", subject: "A market street of awnings, stalls and hanging wares" },
  { id: "village", subject: "A village of thatched cottages around a well and a green" },
  { id: "city-gate", subject: "A fortified city gate with flanking towers and a raised portcullis" },
  { id: "forest", subject: "A forest track winding between tall trunks under a closed canopy" },
  { id: "deep-forest", subject: "A dense dark old-growth forest of vast gnarled trees and hanging moss" },
  { id: "swamp", subject: "A swamp of dead trees, reeds and still black water" },
  { id: "desert", subject: "A desert of long dune ridges and a bare rock outcrop" },
  { id: "tundra", subject: "A frozen tundra of wind-scoured snow and standing ice slabs" },
  { id: "mountain-pass", subject: "A narrow mountain pass between sheer cliffs above a drop" },
  { id: "coast", subject: "A rocky coast of sea stacks, breaking surf and a cliff path" },
  { id: "ship-deck", subject: "The deck of a sailing ship, masts, rigging and a ship's wheel" },
  { id: "ruins", subject: "Toppled columns and broken walls of an overgrown ruined city" },
  { id: "arena", subject: "A sand-floored arena ringed by tiered stone seating" },
  { id: "laboratory", subject: "A laboratory of glass apparatus, shelved jars and a workbench" },
  { id: "wasteland", subject: "A cracked wasteland of dry riverbeds and skeletal dead trees" },
];

// The workshop shelf and each of its rooms (src/app/workshop/*), plus a
// generic tile for a workshop with nothing in it yet.
const WORKSHOP_TILES = [
  { id: "workshop", subject: "A craftsman's workbench of tools, clamps and half-finished work under a hanging lamp" },
  { id: "maps", subject: "A drafting table with a large map weighted at the corners, dividers and a lantern" },
  { id: "cast", subject: "A row of empty carved masks hung on a workshop wall" },
  { id: "bestiary", subject: "An open bestiary volume beside a mounted horned skull and specimen jars" },
  { id: "encounters", subject: "A war table of carved figures arranged on a gridded battle map" },
  { id: "lore", subject: "A cabinet of pigeonholes stuffed with rolled scrolls and tied bundles of letters" },
  { id: "storyboard", subject: "A wall of pinned index cards joined by lengths of thread" },
  { id: "tables", subject: "A scatter of polygonal dice beside a printed column of numbered entries" },
  { id: "rulesets", subject: "A stack of thick leather-bound rule tomes with ribbon markers" },
];

// The remaining thumbnail slots that are not a person, a place or a room of
// the workshop.
const MISC_TILES = [
  { id: "party", subject: "Four travellers in cloaks walking away in single file along a ridge road, seen as small black silhouettes", peopled: true },
  { id: "quest", subject: "A weathered signpost at a fork in an empty road" },
  { id: "faction", subject: "A row of tall hanging banners on poles above an empty courtyard" },
  { id: "treasure", subject: "An open ironbound chest spilling coins and a spilled goblet" },
  { id: "chapter", subject: "A large open book on a lectern beside a guttering candle" },
  { id: "session", subject: "A round table set with dice, tankards and a folded map" },
  { id: "journey", subject: "A caravan track crossing open country toward a distant range" },
  { id: "empty", subject: "An empty stone plinth in a bare hall" },
];

// ---- the genres that are not swords and sorcery ----

// Every genre ships six original classes of its own (src/lib/classes/*.json),
// and none of them are anything like the SRD twelve: a Netrunner in a picker
// that falls back to a wizard silhouette looks broken. Keyed by the class id
// the app already uses, so a lookup needs no translation table.
//
// Two variants each rather than the SRD twelve's three. Race portraits carry
// the gender variety, and a Netrunner reads by its gear, not its build.
export const CLASS_GENDER_IDS = ["masculine", "feminine"];

const GENRE_CLASSES = [
  { palette: "cyberpunk", id: "netrunner", name: "netrunner", traits: "a visor over the eyes, a bundle of jacked-in cables trailing from the skull and a deck held at the hip" },
  { palette: "cyberpunk", id: "street_samurai", name: "street samurai", traits: "chromed segmented arms, a swept-back armoured collar and a long thin blade held low" },
  { palette: "cyberpunk", id: "rigger", name: "rigger", traits: "a control headset with stub antennae and a small quadcopter drone hovering at the shoulder" },
  { palette: "cyberpunk", id: "fixer", name: "fixer", traits: "a long coat, an earpiece and a fanned hand of chip-cards" },
  { palette: "cyberpunk", id: "esper", name: "esper", traits: "one hand raised to the temple with jagged psionic arcs radiating from the skull" },
  { palette: "cyberpunk", id: "trauma_doc", name: "trauma doc", traits: "a hard-shell trauma pack, a shoulder-slung medical rig and a raised stim gun" },

  { palette: "steampunk", id: "machinist", name: "machinist", traits: "a brass mechanical arm, a bandolier of tools and a rolled schematic under one arm" },
  { palette: "steampunk", id: "aeronaut", name: "aeronaut", traits: "a high-collared flight coat, a leather flight cap with goggles and a spooled grapple line" },
  { palette: "steampunk", id: "alchemist", name: "alchemist", traits: "a rack of stoppered flasks across the chest and one raised bubbling vial" },
  { palette: "steampunk", id: "gadgeteer", name: "gadgeteer", traits: "a spring-loaded grapnel launcher strapped to the forearm and bulging gear pouches" },
  { palette: "steampunk", id: "aether_channeler", name: "aether channeler", traits: "a coil harness on the back with arcs of lightning crawling between two raised hands" },
  { palette: "steampunk", id: "steam_knight", name: "steam knight", traits: "a heavy riveted boilerplate shell with a smokestack over the shoulder venting steam" },

  { id: "exorcist", name: "exorcist", traits: "a stole over a heavy coat, a raised crucifix and a censer trailing smoke" },
  { id: "occultist", name: "occultist", traits: "an open grimoire held one-handed and a ring of floating sigils around the head" },
  { id: "survivor", name: "survivor", traits: "a battered coat, a shotgun braced across the chest and a lantern strapped to the pack" },
  { id: "slayer", name: "slayer", traits: "a wide-brimmed hat, a bandolier of stakes and a silvered blade drawn across the body" },
  { id: "parapsychologist", name: "parapsychologist", traits: "headphones, a satchel and a boxy field instrument with a wire antenna held up" },
  { id: "apostate", name: "apostate", traits: "a torn ritual robe with a broken cult sigil and dark tendrils curling from one shoulder" },

  { id: "detective", name: "detective", traits: "a belted overcoat, a fedora and a raised magnifying glass" },
  { id: "alienist", name: "alienist", traits: "a high-collared physician's coat, round spectacles and an open notebook" },
  { id: "grifter", name: "grifter", traits: "a sharp three-piece suit, a tilted hat and a fanned hand of playing cards" },
  { id: "enforcer", name: "enforcer", traits: "a heavy-shouldered build in a flat cap, wrapped knuckles and a club at the belt" },
  { id: "muckraker", name: "muckraker", traits: "a press hat, a folded newspaper under one arm and a boxy plate camera raised" },
  { id: "spirit_medium", name: "spirit medium", traits: "a veiled headdress, a raised planchette and drifting ribbons of ectoplasm" },

  { id: "scavenger", name: "scavenger", traits: "a patched hood, welding goggles and an overstuffed pack bristling with scrap" },
  { id: "road_warrior", name: "road warrior", traits: "a spiked shoulder pauldron, a riveted helm and a length of chain over the shoulder" },
  { id: "aberrant", name: "aberrant", traits: "an asymmetric mutated build with one oversized clawed arm and blooming growths on the back" },
  { id: "salvage_tech", name: "salvage tech", traits: "a heavy tool harness, a welding mask pushed up and a jury-rigged power cell on the back" },
  { id: "waste_preacher", name: "waste preacher", traits: "a ragged robe hung with prayer strips and a raised staff topped with a hubcap sigil" },
  { id: "packmaster", name: "packmaster", traits: "a fur-collared coat, a coiled leash and a lean hound at the hip" },

  { id: "witch_hunter", name: "witch hunter", traits: "a wide-brimmed hat, a long buckled coat and a raised flintlock pistol" },
  { id: "plague_doctor", name: "plague doctor", traits: "a long beaked plague mask with round eye lenses, a broad hat and a waxed robe" },
  { id: "grave_knight", name: "grave knight", traits: "battered plate under a tattered surcoat, a heavy blade and grave dirt trailing from the shoulders" },
  { id: "penitent", name: "penitent", traits: "a hooded sackcloth robe, bound wrists and a trailing length of scourge chain" },
  { id: "dirgesinger", name: "dirgesinger", traits: "a mourning veil and a bowed string instrument held at the shoulder" },
  { id: "vermin_lord", name: "ratcatcher", traits: "a hooded coat hung with cages and traps, with rats perched on the shoulders" },
];

// The stand-in when the genre is known but the class is not. Only the four
// genres whose raceHint says everyone is human need one: high fantasy, dark
// fantasy and steampunk take any SRD race, so they already have 66 portraits.
// Post-apocalyptic gets a second entry because its raceHint maps half_orc to
// "mutant", and a fantasy half-orc is the wrong picture for that.
const GENRE_LEADS = [
  { id: "mystery", subject: "period investigator in a belted overcoat and a hat" },
  { id: "horror", subject: "haunted survivor in a heavy coat carrying a storm lantern" },
  { id: "cyberpunk", subject: "street operative in a high-collared jacket with chrome augments at the jaw and neck" },
  { id: "post-apocalyptic", subject: "wasteland survivor in a dust hood, goggles and a wrapped scarf" },
  { id: "post-apocalyptic-mutant", subject: "wasteland mutant with an asymmetric heavy build and irregular growths across the shoulders" },
];

// Map plates for the settings the fantasy list cannot stand in for. Ids carry
// the genre so one flat map group serves every table.
const GENRE_MAPS = [
  { id: "cyberpunk-neon-alley", subject: "A narrow city alley walled in blank glowing panels, cables and vent housings" },
  { id: "cyberpunk-arcology", subject: "The atrium of a vast corporate arcology, tiered balconies and a glass ceiling" },
  { id: "cyberpunk-server-farm", subject: "An aisle between towering server racks under a low cable-strung ceiling" },
  { id: "cyberpunk-undercity", subject: "An undercity warren of stacked shanty modules and gantry walkways" },

  { id: "steampunk-factory", subject: "A factory floor of flywheels, pistons and riveted catwalks" },
  { id: "steampunk-airship-dock", subject: "An airship mooring dock of gantries and mast towers, a hull overhead" },
  { id: "steampunk-clockwork-vault", subject: "A vault of vast interlocking clockwork gears and escapements" },
  { id: "steampunk-gaslit-street", subject: "A gaslit cobbled street of iron lamp posts and shuttered brick frontages" },

  { id: "post-apocalyptic-overpass", subject: "A collapsed motorway overpass with rebar teeth above a dust plain" },
  { id: "post-apocalyptic-scrap-market", subject: "A scrap market of sheet-metal stalls under strung tarpaulins" },
  { id: "post-apocalyptic-shelter", subject: "A concrete fallout shelter corridor with a heavy blast door and bunk frames" },
  { id: "post-apocalyptic-dead-highway", subject: "A dead highway of stalled rusted vehicles running to the horizon" },

  { id: "horror-manor", subject: "A decaying manor hall with a sweeping staircase and shrouded furniture" },
  { id: "horror-asylum", subject: "An asylum ward of iron bedsteads under barred windows" },
  { id: "horror-crypt-chapel", subject: "A chapel crypt of stone niches, guttering candles and a toppled bier" },
  { id: "horror-graveyard", subject: "A fog-drowned graveyard of leaning headstones and bare trees" },

  { id: "mystery-precinct", subject: "A police precinct office of paired desks, filing cabinets and a corkboard of blank pinned cards" },
  { id: "mystery-parlour", subject: "A drawing room parlour of wing chairs, a mantel clock and heavy drapes" },
  { id: "mystery-back-alley", subject: "A wet cobbled back alley of fire escapes, crates and a single lamp" },
  { id: "mystery-morgue", subject: "A morgue of steel drawers and a sheeted examination table under a hanging lamp" },
];

// Antagonists for the reskinned genres. Mystery is left out on purpose: its
// villains are people, and the NPC roles below already cover them.
const GENRE_MONSTERS = [
  { id: "cyberpunk-security-drone", subject: "a hovering security drone, a lens turret ringed by rotor housings" },
  { id: "cyberpunk-combat-mech", subject: "a bipedal combat mech with a hunched armoured torso and shoulder-mounted guns" },
  { id: "cyberpunk-cyberpsycho", subject: "a cyberpsycho, a hulking figure of grafted chrome limbs and exposed cabling" },

  { id: "steampunk-automaton", subject: "a clockwork automaton with a riveted brass torso and exposed gearwork" },
  { id: "steampunk-boiler-golem", subject: "a boiler golem, a squat furnace body venting steam from shoulder pipes" },
  { id: "steampunk-aether-wraith", subject: "an aether wraith, a coiling figure of arcing electricity and smoke" },

  { id: "post-apocalyptic-feral-mutant", subject: "a feral mutant with an overlong clawed arm and a lopsided hunched frame" },
  { id: "post-apocalyptic-scrap-hound", subject: "a scrap hound, a lean quadruped of welded plate and exposed servos" },
  { id: "post-apocalyptic-rad-swarm", subject: "a swarm of insects boiling upward into a churning column" },

  { id: "horror-revenant", subject: "a revenant, a gaunt shrouded figure with lank hanging hair" },
  { id: "horror-wraith", subject: "a wraith, a hooded shape dissolving into ragged trailing smoke" },
  { id: "horror-flesh-thing", subject: "a flesh horror, a lumpen mass of fused limbs reaching outward" },
];

// Threat, which a creature type cannot express. Once the bestiary carries a
// type, the fourteen plates above answer "what is it" for all 576 roster
// entries; they still cannot say "this one is the centrepiece", so a CR 18
// humanoid warlord would draw the same generic raider tile as a CR 1 bandit.
//
// Only the top tier is worth its own art. A wyrmling and an ancient dragon
// sharing a plate is fine for a placeholder, so mook and elite would just be
// the type plate again. CR 11+ is 52 of the 576.
//
// These also serve the story-level boss and finaleBoss that arc-logic.ts plans
// per act, which StoryPanel.tsx already names but has no picture for.
export const BOSS_CR_FLOOR = 11;

const GENRE_BOSSES = {
  "high-fantasy": "an ancient horned dragon rearing with wings spread",
  "dark-fantasy": "a crowned charnel lord wreathed in torn banners and smoke",
  horror: "a vast eldritch mass of fused limbs and reaching tendrils",
  mystery: "a masked mastermind in an opera cloak and high collar",
  cyberpunk: "a colossal war mech with shoulder cannons and searchlight optics",
  steampunk: "a colossal boiler engine given limbs, venting steam from a hundred pipes",
  "post-apocalyptic": "a warlord's armoured rig bristling with spikes and scavenged guns",
};

// The faces a table meets in each genre, for NPC tiles the fantasy roles
// cannot stand in for.
const GENRE_NPCS = [
  { id: "cyberpunk-fixer", subject: "a fixer in a long coat with an earpiece and a slung satchel" },
  { id: "cyberpunk-corp-exec", subject: "a corporate executive in a sharp suit with a high collar and a slim case" },
  { id: "cyberpunk-street-doc", subject: "a street doctor in a stained surgical apron with a headlamp rig" },

  { id: "steampunk-foreman", subject: "a works foreman in a leather apron with a wrench over the shoulder" },
  { id: "steampunk-airship-captain", subject: "an airship captain in a braided greatcoat and a peaked cap" },
  { id: "steampunk-inventor", subject: "a guild inventor in a waistcoat with goggles pushed up and calipers in hand" },

  { id: "post-apocalyptic-elder", subject: "a settlement elder in layered rags leaning on a pipe staff" },
  { id: "post-apocalyptic-water-baron", subject: "a water baron in a patched fur coat with a canteen bandolier" },
  { id: "post-apocalyptic-caravan-guard", subject: "a caravan guard in plated scrap armour with a slung rifle" },

  { id: "horror-cult-elder", subject: "a cult elder in a deep hooded robe holding a ritual knife" },
  { id: "horror-priest", subject: "a village priest in a worn cassock clutching a prayer book" },
  { id: "horror-warden", subject: "an asylum warden in a buttoned uniform with a ring of keys" },

  { id: "mystery-inspector", subject: "a police inspector in a belted raincoat with a notebook" },
  { id: "mystery-socialite", subject: "a socialite in an evening coat with a feathered headpiece and a long cigarette holder" },
  { id: "mystery-informant", subject: "a street informant in a flat cap with a turned-up collar" },
];

// ---- assembly ----

function raceSubject(race, genderId) {
  const gender = GENDERS[genderId];
  const traits = race.facial ? `${race.traits} and ${gender.beard}` : `${race.traits} and ${gender.hair}`;
  return `${gender.build} ${race.name.toLowerCase()} adventurer with ${traits}`;
}

function classSubject(klass, genderId) {
  return `${GENDERS[genderId].build} ${klass.name.toLowerCase()} carrying ${klass.traits}`;
}

// One flat list of jobs. `group` is the directory, `id` the file stem, and
// `aspect` picks the render size in the generator.
export function placeholderJobs() {
  const jobs = [];
  const portrait = (group, id, subject, framing = "bust", palette = paletteForId(id)) => {
    jobs.push({ group, id, aspect: "square", palette, ...portraitPrompt(subject, framing, palette) });
  };
  const scene = (group, id, subject, peopled = false) => {
    const palette = paletteForId(id);
    jobs.push({ group, id, aspect: "landscape", palette, ...scenePrompt(subject, palette, peopled) });
  };

  for (const race of RACES) {
    for (const genderId of GENDER_IDS) {
      portrait("character-race", `${race.id}-${genderId}`, raceSubject(race, genderId));
    }
  }

  for (const klass of CLASSES) {
    for (const genderId of GENDER_IDS) {
      portrait("character-class", `${klass.id}-${genderId}`, classSubject(klass, genderId));
    }
  }

  // The fallback when neither race nor class is known.
  for (const genderId of GENDER_IDS) {
    portrait(
      "character",
      genderId,
      `${GENDERS[genderId].build} adventurer in a hooded travelling cloak with a pack and a sheathed sword`,
    );
  }

  // Genre classes share the character-class group: the ids never collide with
  // the SRD twelve, so one lookup by class id serves both.
  for (const klass of GENRE_CLASSES) {
    for (const genderId of CLASS_GENDER_IDS) {
      portrait(
        "character-class",
        `${klass.id}-${genderId}`,
        classSubject(klass, genderId),
        "bust",
        klass.palette ?? "default",
      );
    }
  }

  // Genre known, class not. Three genders here rather than the classes' two,
  // because this is the tile a blank gender field falls back to.
  for (const lead of GENRE_LEADS) {
    for (const genderId of GENDER_IDS) {
      portrait(
        "character-genre",
        `${lead.id}-${genderId}`,
        `${GENDERS[genderId].build} ${lead.subject}`,
      );
    }
  }

  for (const role of [...NPC_ROLES, ...GENRE_NPCS]) {
    portrait("npc", role.id, role.subject);
  }

  for (const type of [...MONSTER_TYPES, ...GENRE_MONSTERS]) {
    portrait("monster", type.id, type.subject, "creature");
  }

  // Threat, not kind: id is <genre>-boss so paletteForId still picks up the
  // cyberpunk and steampunk light.
  for (const [genre, subject] of Object.entries(GENRE_BOSSES)) {
    portrait(
      "monster",
      `${genre}-boss`,
      `${subject}, seen from a low angle, looming and imposing, the centrepiece of a fight`,
      "creature",
    );
  }

  for (const sigil of AVATAR_SIGILS) {
    portrait("avatar", sigil.id, sigil.subject, "sigil");
  }

  for (const [genre, subjects] of Object.entries(GENRE_COVERS)) {
    subjects.forEach((subject, index) => {
      scene("campaign", `${genre.replace(/_/g, "-")}-${index + 1}`, subject);
    });
  }

  for (const setting of [...MAP_SETTINGS, ...GENRE_MAPS]) {
    scene("map", setting.id, setting.subject);
  }

  for (const tile of WORKSHOP_TILES) {
    scene("workshop", tile.id, tile.subject);
  }

  for (const tile of MISC_TILES) {
    scene("misc", tile.id, tile.subject, tile.peopled ?? false);
  }

  return jobs;
}
