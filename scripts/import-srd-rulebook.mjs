// Builds the rulebook (src/lib/rulebook/srd-5.1.json): the whole System
// Reference Document 5.1 as ordered pages of markdown, from Old Man Umby's
// reForged markdown conversion of the SRD (CC-BY-4.0, see docs/LICENSES.md).
//
// The conversion is pinned to one commit so a rebuild is byte-for-byte the
// same book. The tarball is cached under data/content/raw/ so re-runs work
// offline; pass --refresh to download it again.
//
// Usage: node scripts/import-srd-rulebook.mjs [--refresh]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const REPO = "oldmanumby/dnd.srd.5.1";
const COMMIT = "cecde944c90b50e630aad031b76af35933805013";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(process.env.ODM_CONTENT_DIR || path.join(root, "data", "content"), "raw");
const tarball = path.join(rawDir, `srd-5.1-reforged-${COMMIT.slice(0, 12)}.tar.gz`);
const outPath = path.join(root, "src", "lib", "rulebook", "srd-5.1.json");

// The chapters in the SRD's own order. A page is a file (with the title the
// book shows) or a folder of one-entry files; `pick` sorts entries into the
// chapter that owns them when one folder feeds several (monsters, creatures
// and NPCs all live in Monsters_Each).
const RACE_ORDER = ["Dwarf", "Elf", "Halfling", "Human", "Dragonborn", "Gnome", "Half-Elf", "Half-Orc", "Tiefling"];
const CLASS_ORDER = ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"];

const CHAPTERS = [
  {
    id: "races",
    title: "Races",
    blurb: "The peoples of the world, and the traits each one gives a character.",
    pages: [
      { file: "01_Races/Racial_Traits.md", title: "Racial Traits" },
      ...RACE_ORDER.map((name) => ({ file: `01_Races/Races_Each/${name}.md`, title: name, kind: "race" })),
    ],
  },
  {
    id: "classes",
    title: "Classes",
    blurb: "The twelve callings, their features level by level, and one archetype each.",
    pages: CLASS_ORDER.map((name) => ({ file: `02_Classes/${name}.md`, title: name, kind: "class" })),
  },
  {
    id: "beyond-1st-level",
    title: "Beyond 1st Level",
    blurb: "Experience, advancement, and taking levels in more than one class.",
    pages: [
      { file: "03_Characterization/Beyond_1st_Level.md", title: "Beyond 1st Level" },
      { file: "03_Characterization/Multiclassing.md", title: "Multiclassing" },
    ],
  },
  {
    id: "personality",
    title: "Personality and Background",
    blurb: "Alignment, languages, inspiration, and where a hero comes from.",
    pages: [
      { file: "03_Characterization/Alignment.md", title: "Alignment" },
      { file: "03_Characterization/Languages.md", title: "Languages" },
      { file: "03_Characterization/Inspiration.md", title: "Inspiration" },
      { file: "03_Characterization/Backgrounds.md", title: "Backgrounds" },
    ],
  },
  {
    id: "equipment",
    title: "Equipment",
    blurb: "Coin, armor, weapons, gear, tools, mounts, and the cost of living.",
    pages: [
      { file: "04_Equipment/Coinage.md", title: "Coinage" },
      { file: "04_Equipment/Selling_Treasure.md", title: "Selling Treasure" },
      { file: "04_Equipment/Armor.md", title: "Armor" },
      { file: "04_Equipment/Weapons.md", title: "Weapons" },
      { file: "04_Equipment/Adventuring_Gear.md", title: "Adventuring Gear" },
      { file: "04_Equipment/Tools.md", title: "Tools" },
      { file: "04_Equipment/Transportation.md", title: "Mounts and Vehicles" },
      { file: "04_Equipment/Trade_Goods.md", title: "Trade Goods" },
      { file: "04_Equipment/Expenses.md", title: "Expenses" },
    ],
  },
  {
    id: "feats",
    title: "Feats",
    blurb: "The optional rule that trades an ability increase for a talent.",
    pages: [{ file: "05_Feats/Feats.md", title: "Feats" }],
  },
  {
    id: "ability-scores",
    title: "Using Ability Scores",
    blurb: "Checks, skills, saving throws, advantage and disadvantage.",
    pages: [{ file: "06_Gameplay/Using_Ability_Scores.md", title: "Using Ability Scores" }],
  },
  {
    id: "adventuring",
    title: "Adventuring",
    blurb: "Time, travel, the environment, resting, and life between adventures.",
    pages: [{ file: "06_Gameplay/Adventuring.md", title: "Adventuring" }],
  },
  {
    id: "combat",
    title: "Combat",
    blurb: "Initiative, actions, movement, attacks, cover, damage, and dying.",
    pages: [{ file: "06_Gameplay/Order_of_Combat.md", title: "Combat" }],
  },
  {
    id: "spellcasting",
    title: "Spellcasting",
    blurb: "How magic works, slots, components, areas, and every class spell list.",
    pages: [
      { file: "07_Spells/Spellcasting.md", title: "Spellcasting" },
      { file: "07_Spells/Spell_Lists.md", title: "Spell Lists" },
    ],
  },
  {
    id: "spells",
    title: "Spells",
    blurb: "Every spell in the reference document, from cantrips to 9th level.",
    pages: [{ folder: "07_Spells/Spells_Each", kind: "spell" }],
  },
  {
    id: "running-the-game",
    title: "Running the Game",
    blurb: "Traps, diseases, madness, objects, and poisons, for the game master.",
    pages: [
      { file: "08_Gamemastering/Traps.md", title: "Traps" },
      { file: "08_Gamemastering/Diseases.md", title: "Diseases" },
      { file: "08_Gamemastering/Madness.md", title: "Madness" },
      { file: "08_Gamemastering/Objects.md", title: "Objects" },
      { file: "08_Gamemastering/Poisons.md", title: "Poisons" },
    ],
  },
  {
    id: "magic-items",
    title: "Magic Items",
    blurb: "Attunement, sentient items, artifacts, and every magic item.",
    pages: [
      { file: "09_Magic_Items/Magic_Items.md", title: "Magic Items" },
      { file: "09_Magic_Items/Sentient_Magic.md", title: "Sentient Magic Items" },
      { file: "09_Magic_Items/Artifacts.md", title: "Artifacts" },
      { folder: "09_Magic_Items/Magic_Items_Each", kind: "item" },
    ],
  },
  {
    id: "monsters",
    title: "Monsters",
    blurb: "Reading a stat block, and the monsters themselves, A to Z.",
    pages: [
      { file: "10_Monsters/Monsters.md", title: "Monster Statistics" },
      { folder: "10_Monsters/Monsters_Each", kind: "monster", pick: (family) => family !== "Creature" && family !== "NPC" },
    ],
  },
  {
    id: "creatures",
    title: "Creatures",
    blurb: "Beasts and other ordinary creatures, from ape to wolf.",
    pages: [{ folder: "10_Monsters/Monsters_Each", kind: "monster", pick: (family) => family === "Creature" }],
  },
  {
    id: "npcs",
    title: "Nonplayer Characters",
    blurb: "Commoners to archmages, and how to make them your own.",
    pages: [
      { file: "10_Monsters/Monsters_A-Z/NPCs.md", title: "Nonplayer Characters", until: "Acolyte" },
      { folder: "10_Monsters/Monsters_Each", kind: "monster", pick: (family) => family === "NPC" },
    ],
  },
  {
    id: "appendix",
    title: "Appendices",
    blurb: "Conditions, the gods of the multiverse, the planes, and the legal notice.",
    pages: [
      { file: "08_Gamemastering/Conditions.md", title: "Conditions" },
      { file: "08_Gamemastering/Pantheons.md", title: "Gods of the Multiverse" },
      { file: "08_Gamemastering/Planes.md", title: "The Planes of Existence" },
      { file: "Legal.md", title: "Legal Information" },
    ],
  },
];

// The reference document gathers the open rules of three books, and the
// contents shows them that way: what a player reads, what the Dungeon Master
// reads, and the monsters. The appendices belong to every reader and sit
// after all three.
const PARTS = [
  {
    id: "players",
    title: "Players",
    blurb: "The Player's Handbook, as far as the SRD opens it: making a hero, playing the game, and every spell.",
    chapters: ["races", "classes", "beyond-1st-level", "personality", "equipment", "feats", "ability-scores", "adventuring", "combat", "spellcasting", "spells"],
  },
  {
    id: "dungeon-master",
    title: "The Game Master",
    blurb: "The Dungeon Master's Guide, as far as the SRD opens it: hazards to run and every magic item.",
    chapters: ["running-the-game", "magic-items"],
  },
  {
    id: "monsters",
    title: "Monsters",
    blurb: "The Monster Manual, as far as the SRD opens it: every stat block, the beasts, and the people of the world.",
    chapters: ["monsters", "creatures", "npcs"],
  },
];

// Slips in the conversion, put back to the SRD's own words: page id, the
// text as converted, the text as printed.
const ERRATA = [
  ["creation", "vegetable matter within\n**Range:** soft goods", "vegetable matter within range: soft goods"],
  ["contagion", "**Range:** Touch\n**Component:** V, S", "**Range:** Touch\n\n**Components:** V, S"],
  ["coinage", "The old piece is", "The gold piece is"],
  ["guardian-of-faith", "when it has delat a total", "when it has dealt a total"],
  ["spell-scroll", "copied from a the copier", "copied from a *spell scroll*, the copier"],
  ["spellcasting", "later in the this chapter", "later in this chapter"],
  ["salamander", "**Sense**s", "**Senses**"],
  ["satyr", "**Sense**s", "**Senses**"],
  // The Travel Pace table's Day column has Normal and Slow swapped; SRD 5.1
  // prints Normal 24 miles and Slow 18 (3 and 2 miles an hour).
  ["adventuring", "| Normal | 300 feet | 3 miles | 18 miles |", "| Normal | 300 feet | 3 miles | 24 miles |"],
  ["adventuring", "| Slow   | 200 feet | 2 miles | 24 miles |", "| Slow   | 200 feet | 2 miles | 18 miles |"],
  // Hyphens the PDF broke across a line, which kept the space.
  ["elf", "self- expression", "self-expression"],
  ["monk", "two- handed", "two-handed"],
  ["paladin", "all- night", "all-night"],
  ["multiclassing", "higher- than-average", "higher-than-average"],
  ["alignment", "good- aligned", "good-aligned"],
  ["half-dragon-template", "half- dragon's", "half-dragon's"],
  ["the-planes-of-existence", "fog- shrouded", "fog-shrouded"],
  ["madness", "self- destructive", "self-destructive"],
];

// Em dashes the conversion turned into hyphens ("trade goods-bars of iron,
// ... and so on-retain"): page id, then the text around one such hyphen. The
// hyphen, and any space beside it, becomes an em dash, as the SRD prints it.
const DASHES = [
  ["barbarian", "end- that"],
  ["cleric", "spells - its"],
  ["cleric", "spells - that"],
  ["cleric", "energy-one"],
  ["cleric", "universe-that"],
  ["druid", "land-arctic"],
  ["druid", "swamp-and"],
  ["paladin", "angels-the"],
  ["paladin", "good-as"],
  ["rogue", "focus-not"],
  ["warlock", "will-targeting"],
  ["warlock", "elemental-without"],
  ["warlock", "existence-not"],
  ["wizard", "book-for"],
  ["multiclassing", "know-and"],
  ["alignment", "alignments-they"],
  ["backgrounds", "cleric - performing"],
  ["selling-treasure", "goods-bars"],
  ["selling-treasure", "on-retain"],
  ["weapons", "property-the"],
  ["adventuring-gear", "item-an"],
  ["adventuring-gear", "item- designed"],
  ["adventuring-gear", "torch-or"],
  ["adventuring-gear", "fuel-takes"],
  ["expenses", "afford-paying"],
  ["expenses", "payment-the"],
  ["feats", "somehow-perhaps"],
  ["feats", "curse-you"],
  ["using-ability-scores", "qualities-a"],
  ["using-ability-scores", "game-the"],
  ["using-ability-scores", "roll-rely"],
  ["using-ability-scores", "success-the"],
  ["using-ability-scores", "goal- for"],
  ["using-ability-scores", "skill-for"],
  ["using-ability-scores", "effort-or"],
  ["using-ability-scores", "modifier-can"],
  ["using-ability-scores", "throw-also"],
  ["using-ability-scores", "save-represents"],
  ["adventuring", "slope-all"],
  ["adventuring", "ground-all"],
  ["adventuring", "terrain- moving"],
  ["adventuring", "speed-so"],
  ["adventuring", "adventuring- noticing"],
  ["adventuring", "few-rely"],
  ["adventuring", "area-such"],
  ["adventuring", "foliage-blocks"],
  ["adventuring", "rest-time"],
  ["adventuring", "activity-at"],
  ["adventuring", "activity-the"],
  ["combat", "speed- sometimes"],
  ["combat", "speed-is"],
  ["combat", "staircases-the"],
  ["combat", "hidden-both"],
  ["combat", "unheard-when"],
  ["combat", "modifier-the"],
  ["combat", "roll-to"],
  ["combat", "attacks-hammers"],
  ["combat", "like-deal"],
  ["spellcasting", "effect-in"],
  ["spellcasting", "Cantrips-simple"],
  ["spellcasting", "rote-are"],
  ["spellcasting", "size-small"],
  ["spellcasting", "components-or"],
  ["spellcasting", "focus-but"],
  ["spellcasting", "effect-such"],
  ["spellcasting", "bonus-from"],
  ["minor-illusion", "object-such"],
  ["minor-illusion", "chest-it"],
  ["disguise-self", "yourself-including"],
  ["disguise-self", "person- look"],
  ["detect-thoughts", "creature-what"],
  ["enlarge-reduce", "category- from"],
  ["enlarge-reduce", "category-from"],
  ["locate-object", "close-within"],
  ["locate-object", "feet-at"],
  ["water-walk", "surface-such"],
  ["water-walk", "lava-as"],
  ["locate-creature", "close-within"],
  ["locate-creature", "feet-at"],
  ["resilient-sphere", "Nothing-not"],
  ["resilient-sphere", "effects-can"],
  ["raise-dead", "survival-its"],
  ["raise-dead", "instance-the"],
  ["teleportation-circle", "sequence-a"],
  ["contingency", "spell-called"],
  ["contingency", "spell-as"],
  ["find-the-path", "tools- such"],
  ["find-the-path", "runes-worth"],
  ["move-earth", "soils-clay"],
  ["astral-projection", "cut-something"],
  ["astral-projection", "does-your"],
  ["prismatic-wall", "wall-up"],
  ["prismatic-wall", "thick-centered"],
  ["diseases", "stress-including"],
  ["diseases", "nightmare-forces"],
  ["deck-of-many-things", "death-a"],
  ["helm-of-telepathy", "reply-using"],
  ["helm-of-telepathy", "so-while"],
  ["marvelous-pigments", "features-such"],
  ["marvelous-pigments", "weapons - that"],
  ["rod-of-absorption", "energy-not"],
  ["rod-of-absorption", "itself-is"],
  ["monster-statistics", "sense-frightening"],
  ["monster-statistics", "actions-called"],
  ["monster-statistics", "actions-outside"],
  ["medusa", "attacks-one"],
  ["medusa", "shortsword-or"],
  ["gods-of-the-multiverse", "oak-and"],
  ["gods-of-the-multiverse", "Ma'at-the"],
  ["gods-of-the-multiverse", "spring-this"],
  ["the-planes-of-existence", "touches-such"],
  ["the-planes-of-existence", "locations- circles"],
  ["the-planes-of-existence", "towns-that"],
  ["the-planes-of-existence", "Planes** - Air"],
  ["the-planes-of-existence", "Water - form"],
  ["the-planes-of-existence", "form-great"],
  ["the-planes-of-existence", "day-if"],
];

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII"];

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

// The conversion keeps a few chapter headings in the PDF's capitals.
function tidyHeading(text) {
  if (text !== text.toUpperCase() || !/[A-Z]{3}/.test(text)) return text;
  return text
    .toLowerCase()
    .split(/(\s+)/)
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

// One page's markdown, cleaned: no title heading (the book letters its own),
// no trailing spaces, capitals tidied, and the one struck-through dash the
// PDF export left behind put back as the dash it was. The PDF also spells a
// few hyphens as a hyphen, a soft hyphen and two Unicode hyphens (U+00AD,
// U+2010, U+2011 after the "-" of "7th-level"), and a hyphen at a line break
// kept its space ("a 15- foot cone", "6th- level spell"); both become the
// plain hyphen they are in print.
function tidy(markdown, { until } = {}) {
  let lines = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\u0336/g, "\u2014")
    .replace(/-\u00AD?[\u2010\u2011]+/g, "-")
    .replace(/(\d(?:st|nd|rd|th)?)- (level|foot)\b/g, "$1-$2")
    .split("\n");
  if (until) {
    const stop = lines.findIndex((line) => new RegExp(`^#+\\s+${until}\\s*$`).test(line));
    if (stop > 0) lines = lines.slice(0, stop);
  }
  const first = lines.findIndex((line) => line.trim());
  if (first >= 0 && /^#{1,6}\s/.test(lines[first])) lines.splice(first, 1);
  return lines
    .map((line) => line.replace(/\s+$/, ""))
    .map((line) => line.replace(/^(>?\s*#{1,6}\s+)(.+)$/, (_, hashes, text) => hashes + tidyHeading(text)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The first italic line of an entry: "3rd-level evocation", "Huge dragon,
// chaotic evil", "Wondrous item, uncommon".
function metaLine(markdown) {
  const match = /^\*([^*\n]+)\*\s*$/m.exec(markdown);
  return match ? match[1].trim() : undefined;
}

function spellLevel(meta) {
  if (!meta) return undefined;
  if (/cantrip/i.test(meta)) return 0;
  const match = /(\d)(?:st|nd|rd|th)-level/i.exec(meta);
  return match ? Number(match[1]) : undefined;
}

const LEVEL_GROUPS = ["Cantrips", "1st Level", "2nd Level", "3rd Level", "4th Level", "5th Level", "6th Level", "7th Level", "8th Level", "9th Level"];

function entryTitle(markdown) {
  const heading = /^#{1,6}\s+(.+)$/m.exec(markdown);
  return heading ? heading[1].trim() : null;
}

async function ensureSource() {
  if (existsSync(tarball) && !process.argv.includes("--refresh")) return;
  mkdirSync(rawDir, { recursive: true });
  const url = `https://codeload.github.com/${REPO}/tar.gz/${COMMIT}`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  await ensureSource();
  const work = mkdtempSync(path.join(os.tmpdir(), "odm-srd-book-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", work]);
    const [top] = readdirSync(work);
    const base = path.join(work, top);
    const read = (relative) => readFileSync(path.join(base, relative), "utf8");

    const taken = new Set();
    const claim = (wanted, kind) => {
      let id = wanted;
      if (taken.has(id)) id = `${wanted}-${kind}`;
      if (taken.has(id)) throw new Error(`Duplicate page id ${id}`);
      taken.add(id);
      return id;
    };

    const chapters = [];
    const pages = [];
    CHAPTERS.forEach((chapter, chapterIndex) => {
      const ids = [];
      for (const source of chapter.pages) {
        if (source.file) {
          const kind = source.kind ?? "rules";
          const md = tidy(read(source.file), { until: source.until });
          const id = claim(slugify(source.title), kind);
          pages.push({ id, chapter: chapter.id, title: source.title, kind, md });
          ids.push(id);
          continue;
        }
        const files = readdirSync(path.join(base, source.folder)).filter((name) => name.endsWith(".md"));
        const entries = [];
        for (const name of files) {
          const raw = read(path.join(source.folder, name));
          const family = /\(([^)]+)\)\.md$/.exec(name)?.[1];
          if (source.pick && !source.pick(family)) continue;
          let title = entryTitle(raw) ?? name.replace(/\.md$/, "").replace(/_/g, " ");
          if (family) title = title.replace(new RegExp(`\\s*\\(${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)$`), "");
          const md = tidy(raw);
          const meta = metaLine(md);
          const entry = { title, kind: source.kind, md, meta, npc: family === "NPC" };
          if (source.kind === "spell") {
            const level = spellLevel(meta);
            if (level === undefined) throw new Error(`No spell level in ${name}: ${meta}`);
            entry.group = LEVEL_GROUPS[level];
            entry.level = level;
          } else {
            entry.group = /^[A-Z]/i.test(title) ? title.charAt(0).toUpperCase() : "#";
          }
          if (family && family !== "Creature" && family !== "NPC") entry.family = family;
          entries.push(entry);
        }
        entries.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.title.localeCompare(b.title));
        for (const entry of entries) {
          const wanted = slugify(entry.family ? `${entry.title} ${entry.family}` : entry.title);
          const id = claim(wanted, entry.npc ? "npc" : entry.kind);
          const page = { id, chapter: chapter.id, title: entry.title, kind: entry.kind, md: entry.md };
          if (entry.meta) page.meta = entry.meta;
          if (entry.group) page.group = entry.group;
          if (entry.family) page.family = entry.family;
          pages.push(page);
          ids.push(id);
        }
      }
      chapters.push({ id: chapter.id, numeral: NUMERALS[chapterIndex], title: chapter.title, blurb: chapter.blurb, pages: ids });
    });

    // Links between files ("[Nightmare](new/Nightmare.md)") become links to
    // the page of that title.
    const byTitle = new Map(pages.map((page) => [page.title.toLowerCase(), page.id]));
    for (const page of pages) {
      page.md = page.md.replace(/\[([^\]]+)\]\(([^)]+\.md)\)/g, (whole, text) => {
        const target = byTitle.get(text.toLowerCase());
        return target ? `[${text}](page:${target})` : text;
      });
    }

    // The conversion lost the appendix letters; every one of them is the
    // conditions appendix, which is a page of this book.
    for (const page of pages) page.md = page.md.replace(/\(see appendix ##\)/g, "(see [Conditions](page:conditions))");

    for (const [id, from, to] of ERRATA) {
      const page = pages.find((candidate) => candidate.id === id);
      if (!page || !page.md.includes(from)) throw new Error(`Erratum for ${id} no longer applies`);
      page.md = page.md.replace(from, to);
    }
    for (const [id, from] of DASHES) {
      const page = pages.find((candidate) => candidate.id === id);
      if (!page || !page.md.includes(from)) throw new Error(`Dash for ${id} no longer applies: ${from}`);
      page.md = page.md.replace(from, from.replace(/ *- */, "\u2014"));
    }

    // Each book is a run of chapters in the order they are bound.
    const order = chapters.map((chapter) => chapter.id);
    let cursor = 0;
    for (const part of PARTS) {
      const start = order.indexOf(part.chapters[0]);
      if (start < cursor || part.chapters.some((id, offset) => order[start + offset] !== id)) {
        throw new Error(`Part ${part.id} is not a run of chapters in order`);
      }
      cursor = start + part.chapters.length;
    }

    const book = {
      source: {
        title: "System Reference Document 5.1",
        publisher: "Wizards of the Coast LLC",
        license: "CC-BY-4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/legalcode",
        conversion: `https://github.com/${REPO}/tree/${COMMIT}`,
      },
      parts: PARTS.map((part, index) => ({ ...part, numeral: NUMERALS[index] })),
      chapters,
      pages,
    };
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(book)}\n`);
    const counts = Object.fromEntries(chapters.map((chapter) => [chapter.id, chapter.pages.length]));
    console.log(`Wrote ${pages.length} pages to ${path.relative(root, outPath)}`, counts);
  } finally {
    removeTempDir(work);
  }
}

await main();
