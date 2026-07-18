import type { Genre } from "@/lib/schemas/game-settings";

export type GenrePreset = {
  id: Genre;
  name: string;
  blurb: string;
  // Appended to the DM system prompt.
  dmFlavor: string;
  // Art-style fragment for location map generation.
  mapStyle: string;
  // Hints the story-setup pass can lean on.
  nameHints: string;
  defaultTheme: string;
};

export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: "high_fantasy",
    name: "High fantasy",
    blurb: "Classic swords, sorcery, and shining kingdoms.",
    dmFlavor:
      "Tone: classic high fantasy. Wonder, heroism, and clear stakes. Magic is known and woven into daily life. Kingdoms, guilds, ancient ruins, and old gods.",
    mapStyle: "hand-drawn parchment fantasy cartography, ink and watercolor, warm tones",
    nameHints: "Evocative medieval-fantasy names (Thornhollow, the Gilded Reach).",
    defaultTheme: "A storied realm of kingdoms, wild frontiers, and buried ruins",
  },
  {
    id: "dark_fantasy",
    name: "Dark fantasy",
    blurb: "Grim lands where hope is scarce and victories cost.",
    dmFlavor:
      "Tone: dark fantasy. Grim, morally gray, low on mercy. Corruption creeps through institutions and flesh alike. Victories are real but always cost something. Keep horror grounded, not gratuitous.",
    mapStyle: "dark inked gothic map, heavy shadows, muted desaturated palette, weathered parchment",
    nameHints: "Bleak, heavy names (Mourngate, the Ashen Fen).",
    defaultTheme: "A blighted land under a dying sun where old powers stir",
  },
  {
    id: "mystery",
    name: "Mystery",
    blurb: "Clues, suspects, and secrets behind every door.",
    dmFlavor:
      "Tone: investigative mystery. Structure scenes around clues, motives, and unreliable witnesses. Track what the party knows versus suspects. Let deduction, not luck, crack the case; reward Investigation and Insight.",
    mapStyle: "vintage detective case map, sepia town plan with labeled buildings and streets",
    nameHints: "Grounded town-and-manor names (Harlowe House, Wickfield).",
    defaultTheme: "A tangled web of secrets in a town where everyone has something to hide",
  },
  {
    id: "horror",
    name: "Horror",
    blurb: "Dread, isolation, and things best left unseen.",
    dmFlavor:
      "Tone: horror. Build dread through pacing, sound, and what is NOT shown. Isolation, dwindling resources, and the unknown. Use fear and sanity beats narratively; give players agency even while terrified.",
    mapStyle: "unsettling hand-sketched map, charcoal and ash tones, fog-obscured edges",
    nameHints: "Wrong-feeling names (Hollow Vale, the Chapel of Quiet).",
    defaultTheme: "An isolated place where something ancient and hungry has woken",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    blurb: "Neon streets, chrome bodies, corporate gods. 5e reskinned.",
    dmFlavor:
      "Tone: cyberpunk. Reskin 5e fiction: spells are cyberware, nanotech, or psionics; gold is credits; deities are megacorps and rogue AIs; dungeons are arcologies, server farms, and undercity warrens. Keep all 5e mechanics unchanged, only the skin differs.",
    mapStyle: "neon blueprint schematic, top-down cyberpunk city block, dark background with glowing cyan and magenta lines",
    nameHints: "Corporate and street names (Kiroshi Spire, the Sump, NCPD grid 7).",
    defaultTheme: "A rain-slick megacity where corporations own everything but the shadows",
  },
  {
    id: "steampunk",
    name: "Steampunk",
    blurb: "Brass, steam, airships, and impossible machines.",
    dmFlavor:
      "Tone: steampunk. Reskin 5e fiction: magic is aether-tech, clockwork, and alchemy; airships and difference engines abound; guilds and inventors drive intrigue. Keep all 5e mechanics unchanged, only the skin differs.",
    mapStyle: "brass-and-blueprint Victorian schematic map, engraved linework, sepia and copper tones",
    nameHints: "Victorian-industrial names (Cogsworth Yards, the Aetherium Exchange).",
    defaultTheme: "A smoke-wreathed empire of invention on the brink of a power struggle",
  },
  {
    id: "post_apocalyptic",
    name: "Post-apocalyptic",
    blurb: "Scavenge, survive, and rebuild among the ruins.",
    dmFlavor:
      "Tone: post-apocalyptic. Reskin 5e fiction: magic is mutation, salvaged tech, or old-world science; gold is barter scrip; monsters are mutants and machines. Scarcity matters: track water, ammo-like resources, and shelter narratively. Keep all 5e mechanics unchanged.",
    mapStyle: "scavenger's hand-drawn survival map on scrap paper, rust and dust tones, marked ruins and hazards",
    nameHints: "Salvaged names (the Glasslands, Depot 9, New Haven).",
    defaultTheme: "A shattered world generations after the Fall, where ruins hold both treasure and death",
  },
  {
    id: "custom",
    name: "Custom",
    blurb: "Describe your own world and tone.",
    dmFlavor: "",
    mapStyle: "hand-drawn game map, clean linework, warm tones",
    nameHints: "",
    defaultTheme: "",
  },
];

export function genrePreset(id: string): GenrePreset {
  return GENRE_PRESETS.find((preset) => preset.id === id) ?? GENRE_PRESETS[0];
}
