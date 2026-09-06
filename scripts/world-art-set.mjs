// The render list for a world pack's art: one job per art slot the pack can
// carry (src/lib/worlds/art.ts), with the prompt assembled from the pack's own
// words. Pure data plus prompt assembly, no I/O, so a run can be inspected
// with --dry-run and the ordering is tested without a GPU.
//
// Everything a prompt says comes from the pack: the reskin name and blurb the
// author wrote, the canonical SRD thing behind it (a "Midlander" is a human,
// so the picture gets round ears), and the pack's own portraitStyle. No
// franchise names, no character names: the pictures are of the pack's
// entries, which are the author's words, not of anybody's property.

const FRAMING = {
  bust:
    "Head and shoulders portrait, cropped at the chest, one figure filling the frame, " +
    "head centred and large, fully clothed in practical layered clothing, looking past the viewer",
  creature: "Head and upper body of one creature filling the frame, centred, dramatic lighting",
  boss:
    "One towering, menacing creature filling the frame from a low angle, immense scale, " +
    "dramatic backlight",
  scene: "Wide establishing shot with no people in the foreground, cinematic composition, layered depth",
  faction:
    "A faction emblem scene: a large banner or sigil hung above two or three figures of its members, " +
    "centred, symmetrical",
};

const NEGATIVE_COMMON =
  "text, letters, words, watermark, signature, logo, caption, border, frame, split image, collage, " +
  "low quality, blurry, deformed, extra limbs, extra fingers, bad anatomy, " +
  "nsfw, nude, naked, cleavage, bare midriff, revealing clothing, sexualized";

const NEGATIVE = {
  bust: `${NEGATIVE_COMMON}, full body, full length, wide shot, small distant figure, multiple people, crowd`,
  creature: `${NEGATIVE_COMMON}, tiny distant creature, multiple creatures, human face`,
  boss: `${NEGATIVE_COMMON}, tiny distant creature, human face`,
  scene: `${NEGATIVE_COMMON}, close-up face, portrait, crowd in the foreground`,
  faction: `${NEGATIVE_COMMON}, close-up face, single portrait`,
};

// A monster of this rating is the centrepiece of a fight and gets the boss
// framing, the same line src/lib/placeholders.ts draws for its boss plate.
export const BOSS_CR_FLOOR = 11;

// The scene style a pack's places and cover are painted in. A portraitStyle
// says "dented plate and scarred skin", which is the wrong instruction for a
// landscape, so scenes have their own line: a hand-written one for the packs
// this repository's author maintains, and a genre fallback for everyone else.
const SCENE_STYLES = {
  berserk: "grim painterly medieval landscape, harsh chiaroscuro, desaturated bronze and grey, heavy ink texture",
  digimon: "anime digital-world landscape, saturated colour with glitching data artifacts at the edges, glowing grid horizon",
  final_fantasy_ix: "storybook fantasy landscape, mist-filled lowlands and airships, warm lantern light, soft painterly rendering",
  final_fantasy_vii: "late-nineties JRPG industrial cityscape, mako-green glow, moody industrial palette, painterly",
  final_fantasy_x: "sunlit tropical JRPG landscape, bright coastal light, vivid teal and gold, painterly",
  final_fantasy_xiv: "high-detail fantasy landscape, warm golden hour light, painterly and richly coloured",
  fullmetal_alchemist: "early twentieth century industrial nation, gaslight and coal smoke, muted amber and steel, painterly",
  mario: "bright cartoon landscape, clean thick outlines, saturated primary colours, rolling green hills and blue sky",
  marvel: "comic-book city scene, bold ink outlines and flat vivid colour, halftone shading, dramatic angle",
  middle_earth: "painted landscape of an ancient age, overcast northern light, weathered and muted, epic scale",
  monster_hunter: "detailed fantasy wilderness, natural daylight, earthy palette, giant creature tracks and hunter camps",
  naruto: "shonen anime landscape, hidden village among forested mountains, bold ink outlines, dramatic rim light",
  one_piece: "bold anime seascape, bright saturated colour, exaggerated island shapes, sea light",
  pokemon: "bright anime landscape, clear daylight, bold clean colour, small towns and country routes",
  sonic: "vivid cartoon zone landscape, checkerboard hills and loops, bold outlines, high saturation",
  star_wars_galactic_civil_war: "grainy film still of a used-future location, worn machinery, harsh corridor lighting, grime and rust",
  star_wars_old_republic: "war-era holo capture of a location, hard rim light and blue backscatter, scuffed plasteel, soot and dust",
  stranger_things: "eighties film still of a small-town location, warm practical lighting with heavy shadow, grainy film stock",
  sword_art_online: "anime MMO landscape, floating castle floors, faint HUD glow, clean cel shading",
  vox_machina: "painted fantasy landscape, warm light, expressive and characterful, rich colour",
  warcraft: "epic fantasy landscape, dramatic backlight, saturated painterly colour, oversized architecture",
  warhammer_40k: "grimdark gothic scene, incense haze, harsh underlight and deep shadow, skull motifs and brass",
  warhammer_fantasy: "grimy Renaissance landscape, tallow candlelight, muddy earth tones, timber and stone",
  wizarding_world: "old castle and grounds, overcast window light, painterly, autumn palette",
  zelda_breath_of_the_wild: "soft cel-shaded open landscape, overgrown ruins, open sky light, airy pastel palette",
  zelda_ocarina_of_time: "heroic fairy tale landscape, soft painted light, clear bold shapes",
  zelda_twilight_princess: "muted painterly kingdom landscape, overcast grey-green light, grounded and weathered",
};

const GENRE_SCENE_STYLES = {
  high_fantasy: "painted fantasy landscape, warm light, rich colour",
  dark_fantasy: "grim painterly landscape, desaturated palette, heavy shadow",
  cyberpunk: "neon-lit rain-slick city, teal and magenta glow, wet reflections",
  steampunk: "gaslight and brass, coal smoke, sepia and copper tones",
  horror: "overcast, fog, decay, muted palette, unease",
  mystery: "gaslit street in fog, noir shadows, muted palette",
  post_apocalyptic: "ruined wasteland, dust and rust, bleached sky",
  custom: "painted landscape, cinematic light",
};

export function sceneStyleFor(pack) {
  return SCENE_STYLES[pack.id] || GENRE_SCENE_STYLES[pack.baseGenre] || GENRE_SCENE_STYLES.custom;
}

function portraitStyleFor(pack) {
  return pack.portraitStyle || "painted fantasy portrait, warm light, rich colour";
}

// `canonical` answers what the SRD thing behind a reskin is, so the model is
// told "a dwarf" or "a giant spider" and not left to guess from a made-up
// name. Each lookup may return "" when nothing is known.
// Blurbs end in a full stop; the prompt supplies its own.
function line(text) {
  return String(text ?? "").trim().replace(/[.!]+$/, "");
}

export function worldArtJobs(pack, canonical, { slots, packArtKey }) {
  const scene = sceneStyleFor(pack);
  const portrait = portraitStyleFor(pack);
  const jobs = [];

  for (const slot of slots) {
    let prompt = "";
    let framing = "bust";
    let aspect = "square";

    if (slot.kind === "cover") {
      framing = "scene";
      aspect = "landscape";
      prompt = `${FRAMING.scene}. A scene that evokes a world described as: ${line(pack.blurb)}. ${scene}`;
    } else if (slot.kind === "race") {
      const entry = pack.races.find((row) => packArtKey("race", row.id) === slot.key);
      const base = canonical.race(entry.id);
      prompt = `${FRAMING.bust}. ${entry.name}${base ? `, a ${base}` : ""}. ${line(entry.blurb)}. ${portrait}`;
    } else if (slot.kind === "class") {
      const entry = pack.classes.find((row) => packArtKey("class", row.id) === slot.key);
      const base = canonical.class(entry.id);
      prompt = `${FRAMING.bust}. ${entry.name}${base ? `, a ${base}` : ""}. ${line(entry.blurb)}. ${portrait}`;
    } else if (slot.kind === "background") {
      const entry = pack.backgrounds.find((row) => packArtKey("background", row.id) === slot.key);
      prompt = `${FRAMING.bust}. ${entry.name}. ${line(entry.blurb)}. ${portrait}`;
    } else if (slot.kind === "monster") {
      const entry = pack.monsters.find((row) => packArtKey("monster", row.slug) === slot.key);
      const base = canonical.monster(entry.slug);
      const kind = entry.type ? `${entry.type} ` : "";
      framing = entry.cr >= BOSS_CR_FLOOR ? "boss" : "creature";
      prompt =
        `${FRAMING[framing]}. ${entry.name}, a ${kind}creature${base ? ` like a ${base}` : ""}. ` +
        `${line(entry.blurb)}. ${portrait}`;
    } else if (slot.kind === "location") {
      const entry = pack.locations.find((row) => packArtKey("location", row.name) === slot.key);
      framing = "scene";
      aspect = "landscape";
      prompt = `${FRAMING.scene}. ${entry.name}: ${line(entry.blurb)}. ${scene}`;
    } else if (slot.kind === "faction") {
      const entry = pack.factions.find((row) => packArtKey("faction", row.name) === slot.key);
      framing = "faction";
      prompt = `${FRAMING.faction}. ${entry.name}: ${line(entry.blurb)}. ${portrait}`;
    }

    jobs.push({
      packId: pack.id,
      key: slot.key,
      kind: slot.kind,
      aspect,
      prompt: prompt.replace(/\s+/g, " ").trim(),
      negative: NEGATIVE[framing],
    });
  }
  return jobs;
}
