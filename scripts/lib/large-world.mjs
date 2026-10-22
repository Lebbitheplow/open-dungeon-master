// A large WorldForge world for the scaling measurements (audit WF-24, plan
// M6): a WorldForge file (format 4, the one scripts/fixtures/worldforge-
// saltmarch.json is) of any size up to the document's limits, built the
// same way every time from the size alone, so a measurement can be rerun.
//
// The mix is what a long-running author's world looks like: four in ten
// entries are people, a quarter places, one in ten factions, the rest lore
// across a few types. Most texts are short, a quarter run to a few
// paragraphs and one in twenty is a long article (8,000 to 15,000
// characters). About two links per entry, an event for every two entries,
// a secret for every twenty, folders, custom fields, and an Atlas of
// regional maps with pins on a tenth of the places.
//
// Three needles are planted for search, and returned with the file:
//   - `name`: an entry's exact name;
//   - `body`: a word that appears only in the last paragraph of one long
//     lore article;
//   - `field`: a value that appears only in one character's custom Rank
//     field.
// Each comes with the name of the entry that holds it.

const LIMITS = { links: 8_000, events: 2_000, pins: 3_000 };

// mulberry32: a small seeded generator, so a size always builds one world.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ONSETS = ["Br", "Th", "Kal", "Mir", "Vel", "Or", "Sar", "Ten", "Gul", "Ash", "Fen", "Hal", "Ivo", "Jor", "Lys", "Mor", "Nes", "Pell", "Quen", "Rho", "Sel", "Tav", "Ul", "Wen", "Yar", "Zed"];
const MIDDLES = ["a", "e", "i", "o", "u", "ae", "ei", "ou", "ar", "en", "il", "or"];
const CODAS = ["n", "th", "ric", "mere", "wick", "dor", "lan", "ra", "ven", "sk", "holm", "gard", "ion", "ys"];
const PLACE_WORDS = ["Harbour", "Hollow", "Reach", "Ford", "Keep", "Marsh", "Spire", "Crossing", "Vale", "Watch", "Fen", "Steps"];
const FACTION_WORDS = ["Compact", "Brotherhood", "Circle", "Guild", "Wardens", "Company", "Covenant", "Lantern"];
const LORE_WORDS = ["Song", "Rite", "Treaty", "Plague", "Crown", "Codex", "Tide", "Schism", "Feast", "Oath"];
const NOUNS = ["tide", "wall", "lamp", "harbour", "salt", "storm", "ledger", "bell", "marsh", "road", "tower", "ship", "grain", "toll", "shrine", "bridge", "well", "orchard", "mine", "forge", "market", "garrison", "archive", "chapel"];
const VERBS = ["guards", "remembers", "trades", "hides", "rebuilt", "taxes", "betrayed", "rules", "fears", "keeps", "sold", "found", "lost", "blessed", "burned", "mapped"];
const ADJECTIVES = ["old", "drowned", "silver", "grey", "quiet", "broken", "sunken", "northern", "hidden", "salted", "green", "ashen"];
const LABELS = ["ally of", "rival of", "member of", "lives in", "rules", "mentor of", "enemy of", "serves", "located in", "worships"];

export function largeWorld(size, { seed = 1 } = {}) {
  const rand = random(seed * 7919 + size);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (low, high) => low + Math.floor(rand() * (high - low + 1));
  const used = new Set();
  const nameOf = (shape) => {
    for (let tries = 0; ; tries += 1) {
      const root = `${pick(ONSETS)}${pick(MIDDLES)}${pick(CODAS)}`;
      const name = shape(root) + (tries > 3 ? ` ${between(2, 999)}` : "");
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  };
  const sentence = () => {
    const words = [`The ${pick(ADJECTIVES)} ${pick(NOUNS)}`, pick(VERBS), `the ${pick(NOUNS)} of ${pick(ONSETS)}${pick(CODAS)}`];
    if (rand() < 0.5) words.push(`while the ${pick(NOUNS)} ${pick(VERBS)} the ${pick(ADJECTIVES)} ${pick(NOUNS)}`);
    return `${words.join(" ")}.`;
  };
  const paragraph = (chars) => {
    let text = "";
    while (text.length < chars) text += `${text ? " " : ""}${sentence()}`;
    return text;
  };
  // Most texts are short; a quarter run to a few paragraphs; one in twenty
  // is a long article.
  const body = () => {
    const roll = rand();
    const total = roll < 0.7 ? between(200, 800) : roll < 0.95 ? between(1_500, 3_000) : between(8_000, 15_000);
    const parts = [];
    let length = 0;
    while (length < total) {
      const part = paragraph(Math.min(700, total - length + 40));
      parts.push(part);
      length += part.length + 2;
    }
    return parts.join("\n\n");
  };

  const types = [
    { id: "t_character", name: "Character", fields: [{ id: "f_born", name: "Born", kind: "year" }, { id: "f_rank", name: "Rank", kind: "text" }, { id: "f_real", name: "Real Name", kind: "text", authorOnly: true }] },
    { id: "t_location", name: "Location", fields: [{ id: "f_pop", name: "Population", kind: "number" }, { id: "f_climate", name: "Climate", kind: "select", options: ["Temperate", "Cold", "Arid", "Wet"] }] },
    { id: "t_faction", name: "Faction", fields: [{ id: "f_founded", name: "Founded", kind: "year" }] },
    { id: "t_artifact", name: "Artifact", fields: [] },
    { id: "t_deity", name: "Deity", fields: [] },
    { id: "t_event_lore", name: "History", fields: [] },
  ];
  const calendars = [{ id: "cal_tide", name: "Reckoning of Tides", abbrev: "RT", epochOffset: 0, notes: "" }];
  const categories = Array.from({ length: Math.max(3, Math.round(size / 50)) }, (_, at) => ({ id: `cat_${at}`, name: `Folder ${at + 1}` }));

  const entities = [];
  const shelfOf = (at) => {
    const roll = (at * 37) % 100;
    return roll < 40 ? "Character" : roll < 65 ? "Location" : roll < 75 ? "Faction" : pick(["Artifact", "Deity", "History"]);
  };
  for (let at = 0; at < size; at += 1) {
    const type = shelfOf(at);
    const name =
      type === "Character" ? nameOf((root) => `${root} ${pick(ONSETS)}${pick(CODAS)}`)
      : type === "Location" ? nameOf((root) => `${root} ${pick(PLACE_WORDS)}`)
      : type === "Faction" ? nameOf((root) => `The ${root} ${pick(FACTION_WORDS)}`)
      : nameOf((root) => `The ${pick(LORE_WORDS)} of ${root}`);
    const fields =
      type === "Character" ? { f_born: { calendarId: "cal_tide", yearNum: between(1, 300) }, f_rank: pick(["Captain", "Keeper", "Smith", "Warden", "Scribe", "Envoy"]), ...(rand() < 0.2 ? { f_real: nameOf((root) => root) } : {}) }
      : type === "Location" ? { f_pop: between(20, 40_000), f_climate: pick(["Temperate", "Cold", "Arid", "Wet"]) }
      : type === "Faction" ? { f_founded: { calendarId: "cal_tide", yearNum: between(1, 300) } }
      : {};
    entities.push({
      id: `e_${at}`,
      name,
      type,
      categoryId: rand() < 0.7 ? pick(categories).id : "",
      aliases: rand() < 0.15 ? [nameOf((root) => root)] : [],
      summary: body(),
      hiddenTruth: rand() < 0.1 ? paragraph(between(60, 300)) : "",
      tags: rand() < 0.4 ? [pick(NOUNS)] : [],
      canon: rand() < 0.9 ? "canon" : pick(["draft", "alternate", "retired"]),
      notes: "",
      createdAt: "2026-10-01T00:00:00.000Z",
      links: [],
      fields,
    });
  }
  // Links: about two per entry, up to the document's limit.
  let linkCount = 0;
  const linkTotal = Math.min(LIMITS.links, size * 2);
  while (linkCount < linkTotal && size > 1) {
    const from = entities[between(0, size - 1)];
    const to = entities[between(0, size - 1)];
    if (from === to) continue;
    from.links.push({ targetId: to.id, label: pick(LABELS), ...(rand() < 0.05 ? { veracity: "hidden" } : {}) });
    linkCount += 1;
  }
  const events = Array.from({ length: Math.min(LIMITS.events, Math.round(size / 2)) }, (_, at) => ({
    id: `ev_${at}`,
    era: "",
    title: sentence().slice(0, 70),
    body: rand() < 0.5 ? paragraph(between(80, 400)) : "",
    year: "",
    yearNum: between(1, 400),
    calendarId: "cal_tide",
    entityIds: [entities[between(0, size - 1)].id],
    canon: rand() < 0.92 ? "canon" : pick(["draft", "alternate"]),
  }));
  const secrets = Array.from({ length: Math.round(size / 20) }, (_, at) => ({
    id: `sec_${at}`,
    title: sentence().slice(0, 70),
    entityId: entities[between(0, size - 1)].id,
    notes: paragraph(between(60, 240)),
    knownBy: {},
    audienceReveal: {},
  }));
  // The Atlas: one world map, a regional map for every hundred entries, and
  // pins on a tenth of the places.
  const places = entities.filter((entity) => entity.type === "Location");
  const maps = [{ id: "m_world", name: "The World", parentPinId: null }, ...Array.from({ length: Math.floor(size / 100) }, (_, at) => ({ id: `m_${at}`, name: `Region ${at + 1}`, parentPinId: null }))];
  const pins = places
    .filter((_, at) => at % 10 === 0)
    .slice(0, LIMITS.pins)
    .map((place, at) => ({ id: `p_${at}`, mapId: maps[at % maps.length].id, x: rand(), y: rand(), name: place.name, type: "Location", notes: "", entityId: place.id }));

  // The needles.
  const lore = entities.filter((entity) => !["Character", "Location", "Faction"].includes(entity.type));
  const longLore = lore.find((entity) => entity.summary.length > 8_000) ?? lore[0];
  longLore.summary = `${longLore.summary}\n\nAt the very end, the archivists note that the obsidianwright guild kept the oldest key.`;
  const ranked = entities.filter((entity) => entity.type === "Character");
  const fieldHolder = ranked[Math.floor(ranked.length / 2)];
  fieldHolder.fields.f_rank = "Quartermaster-Vexil";
  const named = entities[Math.floor(size * 0.77)];

  const file = {
    version: 4,
    exportedAt: "2026-10-21T00:00:00.000Z",
    worldName: `A world of ${size}`,
    entities,
    pins,
    events,
    calendars,
    types,
    maps,
    stories: [],
    scenes: [],
    secrets,
    categories,
    sceneBodies: {},
    writeStats: {},
    settings: {},
    media: {},
    stubs: [],
  };
  return {
    file,
    needles: {
      name: { query: named.name, holder: named.name },
      body: { query: "obsidianwright", holder: longLore.name },
      field: { query: "Quartermaster-Vexil", holder: fieldHolder.name },
    },
  };
}
