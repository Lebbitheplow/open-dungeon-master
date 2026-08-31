// The sound library: every ambience bed, music mood and one-shot sting the
// table can be asked to play, named by CUE rather than by file.
//
// A cue is a thing that happens in the fiction ("a tavern", "a fight", "a
// thunderclap"). What plays for it is a file under public/ambience, fetched
// by scripts/fetch-ambience.mjs from public-domain and CC0 sources. Naming
// the cue rather than the file is what makes the rest of the system
// possible: the AI DM picks a cue, a person picks a cue, the engine infers
// a cue from a place description, and none of the three has to know what is
// actually on disk, or care that a table swapped a track out.
//
// Pure by design: no imports, no I/O. scripts/test-ambience.mjs loads it
// directly, and so does the fetch script.

export type AmbienceLayer = "bed" | "music" | "sting";

export type AmbienceCue = {
  id: string;
  layer: AmbienceLayer;
  // What the DM console and the volume tooltip call it.
  label: string;
  // One line describing what a player hears. Written for a person choosing
  // from a list, and handed to the model as the tool argument's description.
  blurb: string;
  // Words that make this cue the right answer for a piece of narration or a
  // place description. Matched on word boundaries by inferBedCue, so "sea"
  // never fires on "season".
  keywords: string[];
  // What scripts/fetch-ambience.mjs searches the archives for. Ordered best
  // first; the script takes the first query that returns a usable file.
  search: string[];
  // Per-cue trim, 0..1, applied on top of the listener's own volume. Beds
  // sit under music, which sits under a sting, because a room tone that
  // competes with narration is a room tone nobody keeps switched on.
  gain: number;
};

// ---- beds: where the party is ----

const BEDS: AmbienceCue[] = [
  {
    id: "dungeon",
    layer: "bed",
    label: "Dungeon",
    blurb: "Cold stone corridors, a far-off drip, the room breathing.",
    keywords: ["dungeon", "corridor", "vault", "oubliette", "catacomb", "undercroft", "cell block"],
    search: ["dungeon ambience loop", "stone corridor drip ambience"],
    gain: 0.5,
  },
  {
    id: "cave",
    layer: "bed",
    label: "Cave",
    blurb: "Dripping water in a wide dark space, air moving through rock.",
    keywords: ["cave", "cavern", "grotto", "hollow", "chasm", "fissure"],
    search: ["cave ambience water drips", "cavern ambience loop"],
    gain: 0.5,
  },
  {
    id: "crypt",
    layer: "bed",
    label: "Crypt",
    blurb: "Tomb silence with something shifting in it.",
    keywords: ["crypt", "tomb", "mausoleum", "ossuary", "sepulchre", "barrow"],
    search: ["crypt ambience", "tomb ambience dark"],
    gain: 0.45,
  },
  {
    id: "sewer",
    layer: "bed",
    label: "Sewer",
    blurb: "Running filth, echoing brick, rats where you cannot see them.",
    keywords: ["sewer", "drain", "culvert", "cistern", "aqueduct"],
    search: ["sewer ambience water echo", "underground drain ambience"],
    gain: 0.45,
  },
  {
    id: "mine",
    layer: "bed",
    label: "Mine",
    blurb: "Timbers under strain, a pick working somewhere below.",
    keywords: ["mine", "mineshaft", "shaft", "quarry", "excavation", "seam"],
    search: ["mine ambience pickaxe", "underground mine ambience"],
    gain: 0.45,
  },
  {
    id: "ruins",
    layer: "bed",
    label: "Ruins",
    blurb: "Wind through broken walls and whatever nests in them.",
    keywords: ["ruin", "ruins", "ruined", "rubble", "derelict", "abandoned", "overgrown"],
    search: ["ruins ambience wind", "abandoned stone ruins ambience"],
    gain: 0.45,
  },
  {
    id: "temple",
    layer: "bed",
    label: "Temple",
    blurb: "A high vaulted hush, distant voices at prayer.",
    keywords: ["temple", "shrine", "cathedral", "chapel", "sanctum", "monastery", "altar"],
    search: ["cathedral ambience chant", "temple ambience reverb"],
    gain: 0.4,
  },
  {
    id: "forest",
    layer: "bed",
    label: "Forest",
    blurb: "Birdsong, leaves moving, a wood going about its day.",
    keywords: ["forest", "wood", "woods", "woodland", "grove", "thicket", "copse", "glade"],
    search: ["forest ambience birds", "woodland ambience daytime"],
    gain: 0.5,
  },
  {
    id: "deep_forest",
    layer: "bed",
    label: "Night forest",
    blurb: "Owls, insects, and branches that are probably the wind.",
    keywords: ["dark forest", "deep wood", "old forest", "night forest", "blackwood"],
    search: ["night forest ambience owls", "forest at night ambience insects"],
    gain: 0.5,
  },
  {
    id: "jungle",
    layer: "bed",
    label: "Jungle",
    blurb: "Wet heat, insects in layers, birds that sound like screams.",
    keywords: ["jungle", "rainforest", "canopy", "tropical"],
    search: ["jungle ambience birds insects", "rainforest ambience loop"],
    gain: 0.5,
  },
  {
    id: "swamp",
    layer: "bed",
    label: "Swamp",
    blurb: "Frogs, flies, and water that will not hold your weight.",
    keywords: ["swamp", "marsh", "bog", "fen", "mire", "moor", "wetland"],
    search: ["swamp ambience frogs", "marsh ambience night"],
    gain: 0.5,
  },
  {
    id: "desert",
    layer: "bed",
    label: "Desert",
    blurb: "Dry wind over sand and nothing else at all.",
    keywords: ["desert", "dune", "dunes", "sand", "wasteland", "badlands", "oasis", "arid"],
    search: ["desert wind ambience", "sand dunes wind ambience"],
    gain: 0.5,
  },
  {
    id: "mountain",
    layer: "bed",
    label: "Mountains",
    blurb: "Thin high wind over bare rock.",
    keywords: ["mountain", "peak", "summit", "ridge", "cliff", "crag", "pass", "highland"],
    search: ["mountain wind ambience", "high altitude wind ambience"],
    gain: 0.5,
  },
  {
    id: "tundra",
    layer: "bed",
    label: "Frozen waste",
    blurb: "Driving snow and cold that has weight to it.",
    keywords: ["tundra", "glacier", "frozen", "ice", "snow", "arctic", "blizzard", "frostbite"],
    search: ["blizzard ambience wind snow", "arctic wind ambience"],
    gain: 0.5,
  },
  {
    id: "plains",
    layer: "bed",
    label: "Open country",
    blurb: "Grass moving, larks overhead, a long way to anywhere.",
    keywords: ["plain", "plains", "meadow", "field", "fields", "steppe", "grassland", "moorland", "heath"],
    search: ["meadow ambience wind grass birds", "open field ambience"],
    gain: 0.5,
  },
  {
    id: "river",
    layer: "bed",
    label: "River",
    blurb: "Water moving steadily past a bank.",
    keywords: ["river", "stream", "brook", "creek", "ford", "riverbank", "rapids"],
    search: ["river ambience flowing water", "stream ambience loop"],
    gain: 0.5,
  },
  {
    id: "waterfall",
    layer: "bed",
    label: "Waterfall",
    blurb: "Falling water loud enough to talk under.",
    keywords: ["waterfall", "cascade", "falls", "cataract"],
    search: ["waterfall ambience", "cascade water ambience"],
    gain: 0.45,
  },
  {
    id: "coast",
    layer: "bed",
    label: "Coast",
    blurb: "Surf on shingle and gulls arguing about it.",
    keywords: ["coast", "shore", "beach", "sea", "ocean", "cliffs", "harbour", "harbor", "cove", "tide"],
    search: ["ocean waves ambience gulls", "sea shore ambience loop"],
    gain: 0.5,
  },
  {
    id: "ship",
    layer: "bed",
    label: "Aboard ship",
    blurb: "Timbers working, rigging, and the sea under everything.",
    keywords: ["ship", "deck", "galleon", "schooner", "sail", "vessel", "boat", "caravel"],
    search: ["sailing ship ambience creaking", "wooden ship deck ambience sea"],
    gain: 0.5,
  },
  {
    id: "underwater",
    layer: "bed",
    label: "Underwater",
    blurb: "Everything muffled, everything slow, bubbles going up.",
    keywords: ["underwater", "submerged", "flooded", "sunken", "depths", "drowned"],
    search: ["underwater ambience bubbles", "submerged ambience loop"],
    gain: 0.45,
  },
  {
    id: "town",
    layer: "bed",
    label: "Village",
    blurb: "Carts, chickens, hammering, a dog making its case.",
    keywords: ["village", "hamlet", "town", "settlement", "outpost", "farmstead", "commons"],
    search: ["medieval village ambience", "small town ambience carts"],
    gain: 0.45,
  },
  {
    id: "city",
    layer: "bed",
    label: "City street",
    blurb: "A street with too many people on it and traffic of some kind.",
    keywords: ["city", "street", "district", "quarter", "boulevard", "metropolis", "slum", "alley"],
    search: ["medieval city street ambience", "busy street ambience crowd"],
    gain: 0.45,
  },
  {
    id: "market",
    layer: "bed",
    label: "Market",
    blurb: "Hawkers, haggling, livestock, someone dropping something.",
    keywords: ["market", "bazaar", "fair", "souk", "stalls", "marketplace", "trading post"],
    search: ["medieval market ambience crowd", "bazaar ambience vendors"],
    gain: 0.45,
  },
  {
    id: "crowd",
    layer: "bed",
    label: "Crowd",
    blurb: "A press of people close enough to touch you.",
    keywords: ["crowd", "mob", "throng", "gathering", "audience", "assembly", "riot", "procession"],
    search: ["large crowd murmur ambience", "crowd walla ambience"],
    gain: 0.45,
  },
  {
    id: "tavern",
    layer: "bed",
    label: "Tavern",
    blurb: "Fire, mugs, low talk, and someone murdering a lute.",
    keywords: ["tavern", "inn", "alehouse", "pub", "bar", "common room", "taproom", "hearth"],
    search: ["medieval tavern ambience", "inn ambience fire crowd"],
    gain: 0.45,
  },
  {
    id: "camp",
    layer: "bed",
    label: "Camp",
    blurb: "A fire going, night around it, watch being kept.",
    keywords: ["camp", "campfire", "bivouac", "encampment", "bedroll", "watch fire"],
    search: ["campfire ambience night crickets", "camp fire crackling ambience"],
    gain: 0.5,
  },
  {
    id: "keep",
    layer: "bed",
    label: "Great hall",
    blurb: "A big fire in a bigger room, banners moving in the draught.",
    keywords: ["keep", "castle", "hall", "fortress", "citadel", "throne", "manor", "stronghold", "palace"],
    search: ["great hall ambience fire", "castle hall ambience"],
    gain: 0.4,
  },
  {
    id: "library",
    layer: "bed",
    label: "Library",
    blurb: "Pages, a distant cough, and the sound of being told to be quiet.",
    keywords: ["library", "archive", "scriptorium", "study", "records", "athenaeum"],
    search: ["library ambience quiet pages", "old library ambience"],
    gain: 0.35,
  },
  {
    id: "forge",
    layer: "bed",
    label: "Forge",
    blurb: "Bellows, hammer on anvil, metal complaining.",
    keywords: ["forge", "smithy", "smith", "anvil", "foundry", "furnace", "bellows"],
    search: ["blacksmith forge ambience hammer", "smithy ambience anvil"],
    gain: 0.4,
  },
  {
    id: "graveyard",
    layer: "bed",
    label: "Graveyard",
    blurb: "Wind, crows, and wet grass between the stones.",
    keywords: ["graveyard", "cemetery", "boneyard", "necropolis", "burial ground", "headstones"],
    search: ["graveyard ambience wind crows", "cemetery night ambience"],
    gain: 0.45,
  },
  {
    id: "arcane",
    layer: "bed",
    label: "Arcane",
    blurb: "A hum with no source, and air that feels used.",
    keywords: ["arcane", "magical", "portal", "rift", "ley", "laboratory", "planar", "eldritch"],
    search: ["magic hum ambience drone", "arcane drone ambience"],
    gain: 0.4,
  },
  {
    id: "wind",
    layer: "bed",
    label: "Bare wind",
    blurb: "Wind with nothing to say about where you are.",
    keywords: ["wind", "windswept", "gale", "gusts", "howling wind", "exposed"],
    search: ["wind ambience loop", "howling wind ambience"],
    gain: 0.45,
  },
  {
    id: "rain",
    layer: "bed",
    label: "Rain",
    blurb: "Steady rain on whatever is over your head.",
    keywords: ["rain", "raining", "drizzle", "downpour", "rainfall", "rainstorm"],
    search: ["rain ambience loop", "steady rain ambience"],
    gain: 0.5,
  },
  {
    id: "storm",
    layer: "bed",
    label: "Storm",
    blurb: "Wind, rain and thunder taking turns.",
    keywords: ["storm", "tempest", "thunderstorm", "squall", "hurricane", "lightning"],
    search: ["thunderstorm ambience rain thunder", "storm ambience loop"],
    gain: 0.5,
  },
  {
    id: "night",
    layer: "bed",
    label: "Night",
    blurb: "Crickets, an owl, the world with the lights off.",
    keywords: ["night", "midnight", "nightfall", "dusk", "after dark", "moonlit"],
    search: ["night ambience crickets", "summer night ambience loop"],
    gain: 0.5,
  },
];

// ---- music: what the scene is doing to them ----

const MUSIC: AmbienceCue[] = [
  {
    id: "calm",
    layer: "music",
    label: "Calm",
    blurb: "Nothing is wrong yet. Rest, shopping, talking it over.",
    keywords: ["rest", "peaceful", "quiet", "safe", "respite", "recover"],
    search: ["calm medieval music public domain", "peaceful fantasy music instrumental"],
    gain: 0.35,
  },
  {
    id: "wonder",
    layer: "music",
    label: "Wonder",
    blurb: "They have just seen something worth the trip.",
    keywords: ["wonder", "awe", "vista", "majestic", "beautiful", "revealed", "breathtaking"],
    search: ["orchestral wonder public domain", "majestic classical music public domain"],
    gain: 0.35,
  },
  {
    id: "mystery",
    layer: "music",
    label: "Mystery",
    blurb: "Something does not add up and they have noticed.",
    keywords: ["mystery", "puzzle", "riddle", "strange", "unexplained", "clue", "investigate"],
    search: ["mysterious ambient music public domain", "eerie classical music public domain"],
    gain: 0.35,
  },
  {
    id: "tension",
    layer: "music",
    label: "Tension",
    blurb: "It has not gone wrong yet, and it is going to.",
    keywords: ["tense", "tension", "stalking", "cornered", "standoff", "creeping", "sneaking"],
    search: ["tense suspense music public domain", "suspense strings public domain"],
    gain: 0.35,
  },
  {
    id: "dread",
    layer: "music",
    label: "Dread",
    blurb: "The scene where they should have run.",
    keywords: ["dread", "horror", "terror", "nightmare", "wrong", "unholy", "abomination"],
    search: ["dark ambient drone public domain", "horror ambient music public domain"],
    gain: 0.35,
  },
  {
    id: "battle",
    layer: "music",
    label: "Battle",
    blurb: "A fight worth rolling initiative for.",
    keywords: ["battle", "fight", "combat", "ambush", "attack", "skirmish", "melee"],
    search: ["battle music public domain orchestral", "epic march public domain"],
    gain: 0.35,
  },
  {
    id: "boss",
    layer: "music",
    label: "The big one",
    blurb: "The fight the campaign has been walking towards.",
    keywords: ["boss", "dragon", "archdemon", "final", "champion", "warlord", "lich", "titan"],
    search: ["dramatic orchestral finale public domain", "epic orchestral music public domain"],
    gain: 0.35,
  },
  {
    id: "chase",
    layer: "music",
    label: "Chase",
    blurb: "Someone is running and someone else is closing.",
    keywords: ["chase", "pursuit", "flee", "escape", "running", "hunted", "pursued"],
    search: ["fast orchestral chase public domain", "galop orchestral public domain"],
    gain: 0.35,
  },
  {
    id: "triumph",
    layer: "music",
    label: "Triumph",
    blurb: "They won and everyone should hear about it.",
    keywords: ["victory", "triumph", "won", "celebration", "hailed", "crowned", "feast"],
    search: ["triumphal march public domain", "victory fanfare public domain"],
    gain: 0.35,
  },
  {
    id: "sorrow",
    layer: "music",
    label: "Sorrow",
    blurb: "A death, a betrayal, or the cost coming due.",
    keywords: ["grief", "mourning", "funeral", "loss", "died", "farewell", "buried", "lament"],
    search: ["funeral march public domain", "adagio strings public domain"],
    gain: 0.35,
  },
  {
    id: "travel",
    layer: "music",
    label: "On the road",
    blurb: "Miles passing under them without incident.",
    keywords: ["travel", "journey", "road", "march", "trek", "voyage", "caravan", "riding"],
    search: ["folk travel music public domain", "medieval folk instrumental public domain"],
    gain: 0.35,
  },
  {
    id: "festive",
    layer: "music",
    label: "Festival",
    blurb: "A feast, a fair, a wedding, a coronation.",
    keywords: ["festival", "feast", "fair", "wedding", "revel", "dance", "holiday", "carnival"],
    search: ["medieval dance music public domain", "renaissance festive music public domain"],
    gain: 0.35,
  },
];

// ---- stings: one thing, once ----

const STINGS: AmbienceCue[] = [
  {
    id: "thunder",
    layer: "sting",
    label: "Thunderclap",
    blurb: "Close enough to feel.",
    keywords: ["thunder", "thunderclap", "lightning strike"],
    search: ["thunder clap sound effect", "thunder crack sound"],
    gain: 0.7,
  },
  {
    id: "door_slam",
    layer: "sting",
    label: "Door slams",
    blurb: "The way out just stopped being one.",
    keywords: ["slam", "slammed shut", "sealed"],
    search: ["heavy door slam sound effect", "dungeon door slam sound"],
    gain: 0.7,
  },
  {
    id: "door_creak",
    layer: "sting",
    label: "Door creaks open",
    blurb: "Slowly, and not by anyone's hand.",
    keywords: ["creak", "creaking door", "swings open"],
    search: ["creaking door sound effect", "old wooden door creak"],
    gain: 0.7,
  },
  {
    id: "roar",
    layer: "sting",
    label: "Monster roar",
    blurb: "Something large announcing itself.",
    keywords: ["roar", "bellow", "shriek", "screech"],
    search: ["monster roar sound effect", "beast roar sound"],
    gain: 0.7,
  },
  {
    id: "wolf_howl",
    layer: "sting",
    label: "Wolves",
    blurb: "A howl, then answers from three directions.",
    keywords: ["howl", "wolves", "wolf", "pack"],
    search: ["wolf howl sound effect", "wolves howling night"],
    gain: 0.7,
  },
  {
    id: "horn",
    layer: "sting",
    label: "War horn",
    blurb: "Someone has called for help, or for blood.",
    keywords: ["horn", "warhorn", "signal", "call to arms", "rally"],
    search: ["war horn sound effect", "battle horn blast"],
    gain: 0.7,
  },
  {
    id: "bell",
    layer: "sting",
    label: "Bell",
    blurb: "A single toll, and everyone stops talking.",
    keywords: ["bell", "toll", "chime", "alarm bell"],
    search: ["church bell toll sound effect", "single bell toll"],
    gain: 0.7,
  },
  {
    id: "gong",
    layer: "sting",
    label: "Gong",
    blurb: "For arrivals nobody wanted.",
    keywords: ["gong", "struck", "resounds"],
    search: ["gong sound effect", "large gong strike"],
    gain: 0.7,
  },
  {
    id: "scream",
    layer: "sting",
    label: "Scream",
    blurb: "From somewhere they have not been yet.",
    keywords: ["scream", "screamed", "cry out", "shriek"],
    search: ["distant scream sound effect", "human scream sound"],
    gain: 0.6,
  },
  {
    id: "sword_clash",
    layer: "sting",
    label: "Steel on steel",
    blurb: "The moment a talk became a fight.",
    keywords: ["clash", "parry", "drawn steel", "blades meet"],
    search: ["sword clash sound effect", "metal sword hit sound"],
    gain: 0.7,
  },
  {
    id: "magic_cast",
    layer: "sting",
    label: "A spell lands",
    blurb: "Whatever that was, it worked.",
    keywords: ["incantation", "spell fires", "arcane blast", "detonates"],
    search: ["magic spell sound effect", "magical whoosh sound"],
    gain: 0.7,
  },
  {
    id: "coin",
    layer: "sting",
    label: "Coin",
    blurb: "Payment, bribe, or a purse hitting a table.",
    keywords: ["coins", "purse", "gold spills", "paid"],
    search: ["coins drop sound effect", "coin purse sound"],
    gain: 0.7,
  },
  {
    id: "crow",
    layer: "sting",
    label: "Crows",
    blurb: "They lift off all at once, which is never nothing.",
    keywords: ["crows", "ravens", "carrion birds"],
    search: ["crows cawing sound effect", "ravens flock sound"],
    gain: 0.7,
  },
  {
    id: "heartbeat",
    layer: "sting",
    label: "Heartbeat",
    blurb: "For the pause before a death save.",
    keywords: ["heartbeat", "pulse", "dying"],
    search: ["heartbeat sound effect", "slow heartbeat sound"],
    gain: 0.7,
  },
  {
    id: "chain",
    layer: "sting",
    label: "Chains",
    blurb: "Something is being let off a chain, or put back on one.",
    keywords: ["chains", "shackles", "manacles", "dragged chain"],
    search: ["chains rattling sound effect", "heavy chain drag sound"],
    gain: 0.7,
  },
  {
    id: "splash",
    layer: "sting",
    label: "Splash",
    blurb: "Someone or something went in.",
    keywords: ["splash", "fell in", "plunged", "overboard"],
    search: ["water splash sound effect", "body falls in water sound"],
    gain: 0.7,
  },
];

export const AMBIENCE_CUES: AmbienceCue[] = [...BEDS, ...MUSIC, ...STINGS];

export const BED_CUES = BEDS;
export const MUSIC_CUES = MUSIC;
export const STING_CUES = STINGS;

const BY_ID = new Map(AMBIENCE_CUES.map((cue) => [cue.id, cue]));

export function cueById(id: string): AmbienceCue | null {
  return BY_ID.get((id ?? "").trim()) ?? null;
}

export function cuesForLayer(layer: AmbienceLayer): AmbienceCue[] {
  return AMBIENCE_CUES.filter((cue) => cue.layer === layer);
}

// Ids only, for a zod enum or a tool's `enum` list.
export function cueIds(layer: AmbienceLayer): string[] {
  return cuesForLayer(layer).map((cue) => cue.id);
}

// `{ value, label }` options for a console select. The empty option is the
// caller's business: silence means different things per layer.
export function cueOptions(layer: AmbienceLayer): Array<{ value: string; label: string }> {
  return cuesForLayer(layer).map((cue) => ({ value: cue.id, label: cue.label }));
}
