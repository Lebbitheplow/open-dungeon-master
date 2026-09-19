// The catalogue of icons: one painted picture per thing a card, a sheet, a
// picker or a log line can name (docs/visual-overhaul-plan.md 8b.2).
//
// Every entry is keyed the way the app looks things up: a spell by its slug,
// an item by its slug, a class feature by its name, an option by its id, a
// condition by its id, a basic action by its id. Families give every kind a
// fallback so a homebrew spell still gets its school's icon.
//
// The sources are the app's own data: the SRD spell manifest, the SRD weapon
// and armour tables, the class feature table, the option table, the condition
// glyph table, and the content pack (data/content/open5e.sqlite) for
// adventuring gear, SRD magic items and feats when it is installed.
//
// Consumed by scripts/generate-icons.mjs. `buildIconList()` reads data and
// returns the list; the prompt assembly is pure.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");

// The one style every icon shares. The subject sits on flat black and is cut
// out, so the app draws the plate (dark disc, gold rim, rarity ribbon) and
// every icon matches, whatever it depicts.
export const ICON_STYLE =
  "painted fantasy game icon, hand painted digital illustration, bold readable silhouette, rich colour with a soft inner glow, " +
  "subtle dark outline, isolated on a plain flat black background, centred, the whole subject visible with empty margin, " +
  "no text, no letters, no frame, no border";

export const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// School colour so a whole spell list reads as one palette.
// Colour only. A shape hint ("a shield or ward") turned every abjuration
// spell into the same blue shield; the spell's own name carries the shape.
const SCHOOL_HINT = {
  abjuration: "in cool blue tones",
  conjuration: "in violet tones",
  divination: "in pale gold tones",
  enchantment: "in rose pink tones",
  evocation: "in bright elemental colours",
  illusion: "in shimmering purple tones",
  necromancy: "in sickly green and black tones",
  transmutation: "in amber tones",
};
const LEVEL_WORD = ["a cantrip", "a first level spell", "a second level spell", "a third level spell", "a fourth level spell", "a fifth level spell", "a sixth level spell", "a seventh level spell", "an eighth level spell", "a ninth level spell"];

const CLASS_TONE = {
  artificer: "brass, gears and arcane blue", barbarian: "red rage and iron", bard: "gold and music", cleric: "holy gold and white",
  druid: "green leaves and antlers", fighter: "steel and crimson", monk: "orange and white, ki energy", paladin: "silver and gold light",
  ranger: "forest green and a bow", rogue: "shadow black and a dagger", sorcerer: "raw crimson and violet magic", warlock: "eldritch violet and green",
  wizard: "arcane blue and a tome",
};

const BASIC_ACTIONS = [
  ["attack", "Attack", "a sword striking, a bright arc of steel"],
  ["cast", "Cast a spell", "a hand releasing a swirl of arcane light"],
  ["dodge", "Dodge", "a shadowy figure sidestepping a blade with motion lines"],
  ["dash", "Dash", "a running figure with speed lines and dust"],
  ["disengage", "Disengage", "a figure stepping back behind a raised shield"],
  ["help", "Help", "two hands clasping in support with a warm glow"],
  ["hide", "Hide", "a hooded figure fading into shadow"],
  ["ready", "Ready", "an hourglass beside a raised blade"],
  ["grapple", "Grapple", "two arms locked in a wrestling hold"],
  ["shove", "Shove", "a palm strike pushing a figure back"],
  ["use-object", "Use an object", "a hand pulling a lever"],
  ["end-turn", "End turn", "a simple hourglass with sand run through"],
];

const CONDITION_SUBJECT = {
  blinded: "a closed eye with a dark blindfold", charmed: "a heart with a hypnotic spiral", deafened: "an ear with a strike through it",
  frightened: "a screaming face in a cold blue glow", grappled: "a clenched hand gripping an arm", incapacitated: "a slumped figure with swirling stars",
  invisible: "a faint translucent outline of a figure", paralyzed: "a rigid figure bound in crackling energy", petrified: "a figure turned to grey stone",
  poisoned: "a skull over a green drop of poison", prone: "a figure fallen flat, seen from above", restrained: "a figure bound in chains and rope",
  stunned: "a face with spinning stars and a lightning jolt", unconscious: "a figure lying down with closed eyes and a dim halo", exhaustion: "a figure slumped over, sweating, with a dim lantern",
  concentrating: "a glowing third eye with rings of focus", dodging: "a figure sidestepping with motion lines", raging: "a roaring face wreathed in red fire",
  hidden: "a hooded figure half in shadow", blessed: "a golden halo of light with small stars", hasted: "a figure blurred with speed and lightning",
  slowed: "a figure sunk in thick blue treacle with a clock", cursed: "a black skull with violet flames", marked: "a red target reticle on a figure",
  shielded: "a glowing blue shield of force", flying: "a pair of spread wings", burrowing: "a claw digging through earth",
};

// Genre class tones and the word the emblem prompt uses for the setting.
const GENRE_TONE = {
  cyberpunk: "chrome, neon cyan and magenta on black", "dark-fantasy": "ash grey, dried blood red and cold silver",
  horror: "bone white, candle gold and deep shadow", mystery: "sepia, brass and fog grey",
  "post-apocalyptic": "rust, dust and radiation green", steampunk: "brass, copper, oak and steam",
};
const GENRE_WORD = {
  cyberpunk: "cyberpunk", "dark-fantasy": "dark fantasy", horror: "gothic horror", mystery: "victorian mystery",
  "post-apocalyptic": "post apocalyptic wasteland", steampunk: "steampunk",
};

const SKILL_SUBJECT = {
  acrobatics: "a figure mid backflip", "animal-handling": "an open hand calming a horse's muzzle", arcana: "a glowing arcane sigil over an open book",
  athletics: "a climbing arm gripping a ledge", deception: "a smiling theatre mask hiding a frowning one", history: "an unrolled ancient scroll with a broken seal",
  insight: "an eye within a heart", intimidation: "a clenched gauntlet casting a long shadow", investigation: "a magnifying glass over a footprint",
  medicine: "a bandaged hand and a herb sprig", nature: "an oak leaf and an acorn", perception: "a wide open eye with rays",
  performance: "a lute with a flourish of notes", persuasion: "two hands shaking over a coin", religion: "a holy symbol with a beam of light",
  "sleight-of-hand": "a hand palming a coin", stealth: "a soft boot print fading into shadow", survival: "a compass over a campfire",
};

// [id, label, subject] per glyph group.
const GLYPHS = {
  ability: [
    ["str", "Strength", "a flexed arm of iron"], ["dex", "Dexterity", "a feather balanced on a fingertip"], ["con", "Constitution", "a stout heart of stone"],
    ["int", "Intelligence", "a glowing brain with gears"], ["wis", "Wisdom", "an owl's eye"], ["cha", "Charisma", "a crowned smiling mask with a glow"],
  ],
  coin: [
    ["cp", "Copper", "a single copper coin, top down"], ["sp", "Silver", "a single silver coin, top down"], ["ep", "Electrum", "a single pale gold electrum coin, top down"],
    ["gp", "Gold", "a single gold coin, top down"], ["pp", "Platinum", "a single platinum coin, top down"], ["purse", "Purse", "a leather coin purse with a gold drawstring, coins spilling"],
  ],
  die: [
    ["d4", "d4", "a single four sided die, a pyramid, bone white with red pips"], ["d6", "d6", "a single six sided die, bone white with red pips"],
    ["d8", "d8", "a single eight sided die, bone white with red pips"], ["d10", "d10", "a single ten sided die, bone white with red pips"],
    ["d12", "d12", "a single twelve sided die, bone white with red pips"], ["d20", "d20", "a single twenty sided die, bone white with red numerals"],
    ["d100", "d100", "a pair of ten sided percentile dice, bone white with red numerals"],
  ],
  rest: [
    ["short", "Short rest", "a bedroll and a small campfire under an hourglass"], ["long", "Long rest", "a tent under a crescent moon and stars"],
    ["exhaustion", "Exhaustion", "a slumped figure leaning on a staff"], ["inspiration", "Inspiration", "a bright spark above an open hand"],
    ["death-save", "Death save", "a skull with a heartbeat line across it"], ["level-up", "Level up", "a rising star with a laurel"],
    ["hp", "Hit points", "a red heart with a soft glow"], ["temp-hp", "Temporary hit points", "a heart wrapped in a pale blue shield"],
    ["ac", "Armour class", "a kite shield with a rivet border"], ["speed", "Speed", "a winged boot"], ["initiative", "Initiative", "a drawn sword with an hourglass"],
    ["spell-slot", "Spell slot", "a glowing faceted gem in a socket"], ["xp", "Experience", "a gold star with a laurel below"],
    ["concentration-break", "Concentration broken", "a cracked third eye"], ["proficiency", "Proficiency", "a wax seal with a check mark"],
  ],
  sky: [
    ["clear", "Clear", "a bright sun in a clear sky"], ["cloudy", "Cloudy", "a sun half behind a cloud"], ["overcast", "Overcast", "a heavy grey cloud bank"],
    ["fog", "Fog", "pale fog rolling over low ground"], ["rain", "Rain", "a dark cloud with falling rain"], ["storm", "Storm", "a black cloud with lightning"],
    ["snow", "Snow", "a cloud with falling snowflakes"], ["wind", "Wind", "curling gusts of wind"], ["heat", "Heat", "a sun with shimmering heat rays"], ["cold", "Cold", "an icy snowflake with frost"],
  ],
  daypart: [
    ["night", "Night", "a crescent moon and stars"], ["dawn", "Dawn", "a sun rising over a horizon in pink"], ["morning", "Morning", "a low bright sun with birds"],
    ["day", "Day", "a high noon sun"], ["dusk", "Dusk", "a sun setting in orange"], ["evening", "Evening", "a first star over a dark horizon"],
  ],
  climate: [
    ["temperate", "Temperate", "an oak tree in a green field"], ["arid", "Arid", "a sun over sand dunes and a cactus"], ["boreal", "Boreal", "a snow laden pine"],
    ["tropical", "Tropical", "a palm and a hibiscus flower"], ["blighted", "Blighted", "a dead tree under a sickly green sky"],
  ],
  mount: [
    ["riding-horse", "Riding horse", "a horse's head in profile"], ["warhorse", "Warhorse", "an armoured horse's head in profile"], ["pony", "Pony", "a shaggy pony's head"],
    ["draft-horse", "Draft horse", "a heavy horse's head with a collar"], ["camel", "Camel", "a camel's head in profile"], ["mastiff", "Mastiff", "a mastiff's head"],
    ["elk", "Elk", "an elk's head with antlers"], ["griffon", "Griffon", "a griffon's head in profile"], ["wagon", "Wagon", "a covered wagon from the side"], ["boat", "Boat", "a small rowing boat from the side"],
  ],
  sense: [
    ["darkvision", "Darkvision", "an eye glowing in darkness"], ["blindsight", "Blindsight", "a closed eye with sound rings"], ["tremorsense", "Tremorsense", "a foot with ripples in the ground"],
    ["truesight", "Truesight", "an eye with a golden iris and rays"], ["passive-perception", "Passive perception", "a half open eye"],
  ],
  pace: [["slow", "Slow pace", "a tortoise"], ["normal", "Normal pace", "a walking boot"], ["fast", "Fast pace", "a hare"]],
  quest: [
    ["active", "Active quest", "an unrolled scroll with a red wax seal"], ["done", "Completed quest", "a scroll with a gold check mark"],
    ["failed", "Failed quest", "a torn scroll with a black cross"], ["hidden", "Hidden quest", "a rolled scroll bound with a dark ribbon"],
  ],
  attitude: [
    ["hostile", "Hostile", "a red crossed pair of blades"], ["wary", "Wary", "an amber narrowed eye"], ["neutral", "Neutral", "grey balanced scales"],
    ["friendly", "Friendly", "a green open hand"], ["allied", "Allied", "two gold hands clasped"],
  ],
  tab: [
    ["dm", "Dungeon master", "a crowned hooded figure"], ["lead", "Story lead", "a quill over a lantern"], ["party", "Party", "three silhouettes side by side"],
    ["battle", "Battle", "two crossed swords over a shield"], ["map", "Map", "a rolled map with a compass rose"], ["story", "Story", "an open book with a bookmark"],
    ["quests", "Quests", "a quest scroll with a seal"], ["timeline", "Timeline", "an hourglass with a winding path"], ["facts", "Facts", "a stack of index cards with a pin"],
    ["log", "Log", "a ledger with a quill"], ["notes", "Notes", "a parchment note with a pin"], ["chat", "Chat", "two speech ribbons"],
    ["context", "Context", "a lantern lighting a stack of books"], ["settings", "Settings", "a brass cog"], ["bonds", "Bonds", "a red thread tied between two rings"],
    ["factions", "Factions", "a heraldic banner"], ["market", "Market", "a merchant's scale with coins"], ["handout", "Handout", "a folded letter with a seal"],
    ["shop", "Shop", "a shop awning over a counter"], ["trade", "Trade", "two hands exchanging a pouch"], ["loot", "Loot", "an open treasure chest"],
    ["journal", "Journal", "a leather journal with a strap"], ["session", "Session", "a candle and an hourglass"], ["friends", "Friends", "two clasped hands with a ribbon"],
    ["reference", "Reference", "a thick book with a brass bookmark"], ["characters", "Characters", "a portrait medallion"], ["campaigns", "Campaigns", "a banner over a map"],
    ["ambience", "Ambience", "a lute and a candle"], ["dice", "Dice", "two rolling dice"], ["admin", "Admin", "a key and a seal"],
  ],
  system: [
    ["storyboard", "Storyboard", "three pinned cards on a board"], ["party", "Party", "a party banner"], ["maps", "Battle maps", "a folded battle map with a token"],
    ["region", "Region", "a globe with a compass"], ["encounters", "Encounters", "crossed swords over a scale"], ["cast", "Cast", "a row of theatre masks"],
    ["factions", "Factions", "a heraldic flag"], ["bestiary", "Bestiary", "a horned skull over a book"], ["homebrew", "Homebrew", "a bubbling alchemist's flask"],
    ["lore", "Lore", "an open tome with a glowing page"], ["tables", "Tables", "a die over a scroll"], ["rules", "Rules", "balanced scales on a book"],
    ["plugin", "Plugin", "a puzzle piece with a glow"], ["share", "Share", "a sealed bundle with a ribbon"], ["rulesets", "Rulesets", "a stack of rule books"],
  ],
};

const ITEM_KIND_HINT = {
  weapon: "a weapon, steel and wood, at a slight angle",
  armor: "a piece of armour, worn steel and leather",
  gear: "an adventurer's item, worn and practical",
  magic_item: "a magic item, glowing faintly with enchantment",
};

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
}

function entry(group, key, label, subject, extra = {}) {
  return {
    id: `${group}-${slugify(key)}`,
    group,
    key,
    label,
    subject,
    prompt: `${subject}, ${ICON_STYLE}`,
    ...extra,
  };
}

export async function buildIconList() {
  const list = [];

  // Spells: the SRD manifest, keyed by the slug of the SRD name.
  const rawSpells = readJson("src/lib/srd/manifest/spells.json");
  const spells = Array.isArray(rawSpells) ? rawSpells : rawSpells.spells || Object.values(rawSpells);
  for (const s of spells) {
    const level = Number(s.l) || 0;
    const school = String(s.s || "").toLowerCase();
    list.push(entry("spell", s.n, s.n, `a symbolic icon representing the fantasy spell ${s.n}, ${LEVEL_WORD[level] || "a spell"} of ${school}, ${SCHOOL_HINT[school] || "in arcane colours"}, pure imagery of what the spell does, a wordless pictogram`, { school, level }));
  }
  for (const [school, hint] of Object.entries(SCHOOL_HINT)) {
    list.push(entry("family", `spell-${school}`, `${school} spell`, `a symbol of ${school} magic, ${hint}`));
  }

  // Weapons and armour from the SRD tables.
  register("./lib/register-alias.mjs", import.meta.url);
  const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
  const { SRD_ARMOR } = await import("../src/lib/srd/armor.ts").catch(() => ({ SRD_ARMOR: [] }));
  for (const w of SRD_WEAPONS) {
    list.push(entry("item", w.name, w.name, `a ${w.name.toLowerCase()}, ${ITEM_KIND_HINT.weapon}, ${w.kind === "ranged" ? "a ranged weapon" : "a melee weapon"}`, { kind: "weapon" }));
  }
  for (const a of SRD_ARMOR || []) {
    const name = /armor|shield|mail/i.test(a.name) ? a.name : `${a.name} armor`;
    list.push(entry("item", a.name, a.name, `${name.toLowerCase()}, ${ITEM_KIND_HINT.armor}`, { kind: "armor" }));
  }

  // Adventuring gear, SRD magic items and feats from the content pack.
  const dbPath = path.join(ROOT, "data", "content", "open5e.sqlite");
  if (existsSync(dbPath)) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const have = new Set(list.filter((e) => e.group === "item").map((e) => e.key.toLowerCase()));
    const items = db.prepare("select slug, name, kind, category, rarity from items where document_slug = ? order by kind, name").all("wotc-srd");
    for (const it of items) {
      if (have.has(it.name.toLowerCase())) continue;
      if (it.kind === "weapon" || it.kind === "armor") continue;
      const rarity = it.rarity && it.rarity !== "" ? `${it.rarity} rarity` : "";
      list.push(entry("item", it.slug, it.name, `${it.name.toLowerCase()}, ${ITEM_KIND_HINT[it.kind] || ITEM_KIND_HINT.gear}${rarity ? `, ${rarity}` : ""}`, { kind: it.kind, category: it.category, rarity: it.rarity }));
    }
    const feats = db.prepare("select slug, name from feats where document_slug in ('wotc-srd', 'a5e', 'kp') order by name limit 60").all();
    for (const f of feats) {
      list.push(entry("feat", f.slug, f.name, `a symbolic icon representing the heroic feat ${f.name}, a symbol of the talent, warm gold and steel, a wordless pictogram`));
    }
    db.close();
  }
  for (const [kind, hint] of Object.entries(ITEM_KIND_HINT)) {
    list.push(entry("family", `item-${kind}`, `${kind.replace("_", " ")}`, `a symbol of ${hint}`));
  }

  // Class features, every class and level, once per unique name.
  const features = readJson("src/lib/srd/class-features.json");
  const seen = new Set();
  for (const [classId, klass] of Object.entries(features.classes)) {
    for (const names of Object.values(klass.levels)) {
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        list.push(entry("feature", name, name, `a symbolic icon representing the ${classId} class ability ${name}, ${CLASS_TONE[classId] || "steel and gold"}, a wordless pictogram, pure imagery of what it does`, { classId }));
      }
    }
    list.push(entry("family", `class-${classId}`, classId, `the emblem of the ${classId} class, ${CLASS_TONE[classId] || "steel and gold"}`));
  }

  // Genre classes (src/lib/classes/*.json): six settings, six classes each,
  // with their own feature tables. Same treatment as the SRD classes so a
  // netrunner's card carries a painted icon like a wizard's.
  for (const genre of Object.keys(GENRE_TONE)) {
    const klasses = readJson(`src/lib/classes/${genre}.json`).classes;
    const tables = readJson(`src/lib/classes/${genre}-features.json`).classes;
    for (const klass of klasses) {
      const tone = GENRE_TONE[genre];
      for (const level of Object.values(tables[klass.id]?.levels || {})) {
        for (const feature of level) {
          if (seen.has(feature.n)) continue;
          seen.add(feature.n);
          list.push(entry("feature", feature.n, feature.n, `a symbolic icon representing the ${klass.name.toLowerCase()} ability ${feature.n}, ${tone}, a wordless pictogram, pure imagery of what it does`, { classId: klass.id, genre }));
        }
      }
      list.push(entry("family", `class-${klass.id}`, klass.name, `the emblem of the ${klass.name.toLowerCase()}, a ${GENRE_WORD[genre]} character class, ${tone}`, { genre }));
    }
  }

  // Sheet, log and picker glyphs: skills, abilities, coins, dice, rests,
  // sky and time, mounts, senses, paces, quest and faction states, the
  // session tabs and the workshop systems. Small, so the app never falls
  // back to a Lucide outline where a painted glyph sits beside painted icons.
  const skills = readJson("src/lib/srd/skills.json").skills;
  for (const skill of skills) {
    list.push(entry("glyph", `skill-${skill.id}`, skill.name, `a symbolic icon representing the ${skill.name.toLowerCase()} skill, ${SKILL_SUBJECT[skill.id] || "a symbol of the skill"}, a wordless pictogram`));
  }
  for (const [group, table] of Object.entries(GLYPHS)) {
    for (const [id, label, subject] of table) {
      list.push(entry("glyph", `${group}-${id}`, label, `${subject}, a wordless pictogram`));
    }
  }

  // Ambience cues, for the DM's sound picker and the scene bar.
  const catalog = readFileSync(path.join(ROOT, "src/lib/ambience/catalog.ts"), "utf8");
  for (const m of catalog.matchAll(/id: "([a-z-]+)",\s*layer: "([a-z]+)",\s*label: "([^"]+)"/g)) {
    const [, id, layer, label] = m;
    const what = layer === "sting" ? `the sound of ${label.toLowerCase()}, a single dramatic moment` : `${label.toLowerCase()}, a place or a mood`;
    list.push(entry("glyph", `cue-${id}`, label, `a symbolic icon evoking ${what}, painted in muted tones`, { layer }));
  }

  // Options: invocations, maneuvers, metamagic, boons, infusions, runes, disciplines.
  const options = readJson("src/lib/srd/options.json");
  for (const o of options.options) {
    const kind = options.kinds[o.k];
    list.push(entry("option", `${o.k}-${o.n}`, o.n, `a symbolic icon representing the ${kind?.label?.toLowerCase() || o.k} ${o.n}, a wordless pictogram, pure imagery of what it does`, { kind: o.k }));
  }
  for (const [k, kind] of Object.entries(options.kinds)) {
    list.push(entry("family", `option-${k}`, kind.label, `a symbol of ${kind.label.toLowerCase()}s`));
  }

  // Conditions and basic actions.
  for (const [id, subject] of Object.entries(CONDITION_SUBJECT)) {
    list.push(entry("condition", id, id, subject));
  }
  for (const [id, label, subject] of BASIC_ACTIONS) {
    list.push(entry("action", id, label, subject));
  }

  // Damage types, for the log and the delivery table's chips.
  for (const [type, subject] of Object.entries({
    fire: "a flame", cold: "a snowflake of ice", lightning: "a lightning bolt", acid: "a dripping green drop", poison: "a skull and a green vial",
    necrotic: "a withered black hand", radiant: "a blazing sun", force: "a violet arcane burst", psychic: "a glowing brain with rings",
    thunder: "a shockwave ring", bludgeoning: "a heavy mace head", piercing: "an arrowhead", slashing: "a curved blade",
  })) {
    list.push(entry("family", `damage-${type}`, `${type} damage`, `a symbol of ${type} damage, ${subject}`));
  }

  // Icons the model kept writing words into get a picture description that
  // never mentions their name (scripts/icon-subjects.json).
  const overrides = existsSync(path.join(ROOT, "scripts/icon-subjects.json")) ? readJson("scripts/icon-subjects.json").subjects : {};
  for (const e of list) {
    if (overrides[e.id]) {
      // Keep the category's look: the school colour for a spell, the class or
      // setting palette for a feature, the kind's palette for an option.
      const tone =
        e.group === "spell" ? `a magical spell effect ${SCHOOL_HINT[e.school] || ""}`
        : e.group === "feature" ? CLASS_TONE[e.classId] || GENRE_TONE[e.genre] || "steel and gold"
        : e.group === "feat" ? "a heroic talent, warm gold and steel tones"
        : e.group === "option" ? { maneuver: CLASS_TONE.fighter, invocation: CLASS_TONE.warlock, metamagic: CLASS_TONE.sorcerer }[e.kind] || "steel and gold"
        : e.group === "item" ? ITEM_KIND_HINT[e.kind] || ITEM_KIND_HINT.gear
        : "";
      e.subject = overrides[e.id];
      e.prompt = `a symbolic icon of ${overrides[e.id]}${tone ? `, ${tone}` : ""}, a wordless pictogram, ${ICON_STYLE}`;
    }
  }

  const ids = new Set();
  for (const e of list) {
    if (ids.has(e.id)) throw new Error(`duplicate icon id ${e.id}`);
    ids.add(e.id);
  }
  return list;
}
