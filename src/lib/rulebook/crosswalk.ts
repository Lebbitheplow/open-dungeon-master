import { rulebookPages } from "@/lib/rulebook/book";
import type { RulebookPage } from "@/lib/rulebook/types";
import { spellMechanicsFor } from "@/lib/content";
import { itemMechanicsOf } from "@/lib/workshop/catalog-mechanics";
import { PAGE_CATALOG_NAMES } from "@/lib/rulebook/catalog-rows";

// Every page of the bundled book, and where it goes in ODM
// (docs/workshop-rulebook-audit-pr169.md F18, F19): the workshop editor an
// entry is copied into and the catalog name it is found under, or the
// template it stands for, or the rules it is; and how the table runs it.
//
//   engine      the server applies it (rolls, conditions, areas, gates)
//   structured  prepared in a workshop tool whose fields the engines read
//   editable    prepared as words the DM reads and runs
//   reference   read in the book; nothing in ODM prepares or applies it
//
// A page whose title is not the catalog's name for it (a family of +1, +2
// and +3 items, an animated object, the deep gnome) says the name it is
// found under. A template or a guide (the Half-Dragon Template, Customizing
// NPCs) points at the transformation that applies it. Tested page by page
// (scripts/test-rulebook-crosswalk.mjs): no page without a destination.

export type PrepSupport = "engine" | "structured" | "editable" | "reference";
export type CrosswalkEditor = "spell" | "item" | "race" | "archetype" | "monster";

export type Crosswalk = {
  page: string;
  kind: RulebookPage["kind"];
  // The workshop editor a copy of it opens in, or null for rules.
  editor: CrosswalkEditor | null;
  // What the catalog calls it (the page title unless said otherwise).
  catalogName?: string;
  // A class page: the class its subclasses are written under.
  classId?: string;
  // A page that is a family or a guide rather than one entry.
  template?: string;
  support: PrepSupport;
  // Where it is prepared and run, in a few words.
  where: string;
};

const CATALOG_NAMES = PAGE_CATALOG_NAMES;

const FAMILIES: Record<string, string> = {
  "ammunition-1-2-or-3": "a family of three items (+1, +2, +3): copy the one you want and set its bonus",
  "armor-1-2-or-3": "a family of three items (+1, +2, +3): copy it and set the armour bonus",
  "shield-1-2-or-3": "a family of three items (+1, +2, +3): copy it and set the shield's bonus",
};

const TEMPLATES: Record<string, Omit<Crosswalk, "page" | "kind">> = {
  "half-dragon-template": {
    editor: "monster",
    template: "half-dragon",
    support: "structured",
    where: "Bestiary: Build it out of the catalogue, Half-dragon template (senses, resistance, Draconic, its dragon half's breath)",
  },
  "customizing-npcs": {
    editor: "monster",
    template: "npc",
    support: "structured",
    where: "Bestiary: Build it out of the catalogue (ancestry and class chassis), and the Cast for who they are",
  },
};

// The rules chapters, page by page.
const RULES: Record<string, { support: PrepSupport; where: string }> = {
  "racial-traits": { support: "structured", where: "Workshop: Species; the builder grants every trait it reads" },
  "beyond-1st-level": { support: "engine", where: "Level-up: hit points by the table's method, features, improvements" },
  multiclassing: { support: "engine", where: "Level-up, where the table allows multiclassing: prerequisites, proficiencies, slots" },
  alignment: { support: "editable", where: "Sheet and Cast fields; no rule reads it" },
  languages: { support: "structured", where: "Builder: languages from species, background and feats" },
  inspiration: { support: "engine", where: "The DM awards it (set_condition); a roll spends it for advantage" },
  backgrounds: { support: "structured", where: "Workshop: Backgrounds; the builder grants skills, tools, languages, kit and coin" },
  coinage: { support: "engine", where: "Purses: buy_item, sell_item, modify_gold" },
  "selling-treasure": { support: "engine", where: "sell_item and purchase at the table's prices" },
  armor: { support: "engine", where: "The armour engine (AC, Strength, Stealth, don and doff); Workshop: Items" },
  weapons: { support: "engine", where: "The attack engine (properties, ranges, finesse, versatile); Workshop: Items" },
  "adventuring-gear": { support: "structured", where: "Items with weights and prices; Workshop: Items" },
  tools: { support: "structured", where: "Builder: tool proficiencies; checks with them roll the proficiency" },
  "mounts-and-vehicles": { support: "engine", where: "Mounts: mount_up and mounted combat. Vehicles are narrated" },
  "trade-goods": { support: "engine", where: "Trade goods keep their full value when sold (trade-value.ts)" },
  expenses: { support: "engine", where: "set_lifestyle and downtime charge the costs" },
  feats: { support: "structured", where: "Workshop: Feats; Runs as for the feats the engines know" },
  "using-ability-scores": { support: "engine", where: "Checks, saves, contests, passive scores" },
  adventuring: { support: "engine", where: "Travel, rests, falling, suffocation, vision and light" },
  combat: { support: "engine", where: "The fight engine: initiative, actions, attacks, damage, death saves" },
  spellcasting: { support: "engine", where: "The cast guard: slots, components, concentration, rituals" },
  "spell-lists": { support: "engine", where: "Builder and level-up spell lists" },
  traps: { support: "structured", where: "Workshop: Hazards (traps), run by apply_hazard" },
  diseases: { support: "structured", where: "Workshop: Hazards (diseases), run by afflict" },
  madness: { support: "engine", where: "afflict: short-, long-term and indefinite madness from the tables" },
  objects: { support: "engine", where: "damage_object: AC by material, hit points by size, damage threshold" },
  poisons: { support: "structured", where: "Workshop: Hazards (poisons), run by afflict" },
  "magic-items": { support: "structured", where: "Workshop: Items (attunement, effects, riders, charges, spells)" },
  "sentient-magic-items": { support: "structured", where: "Workshop: Items (It is sentient); a conflict is the DM's Charisma contest" },
  artifacts: { support: "editable", where: "Workshop: Items for what it does; its destruction and properties are the DM's" },
  "monster-statistics": { support: "engine", where: "Bestiary editor, rated against the DMG table" },
  "nonplayer-characters": { support: "structured", where: "The Cast, with stat blocks from the bestiary" },
  conditions: { support: "engine", where: "The condition engine" },
  "gods-of-the-multiverse": { support: "reference", where: "Lore and WorldForge entries for a world's own gods" },
  "the-planes-of-existence": { support: "reference", where: "Lore; plane-crossing spells are narrated" },
  "legal-information": { support: "reference", where: "The licence the book is published under" },
};

// A spell the engine has a block for is rolled by the cast tools (its save,
// attack, damage, condition, area or summons); the rest are narrated.
function spellSupport(name: string): { support: PrepSupport; where: string } {
  return spellMechanicsFor({ spell: name })
    ? { support: "engine", where: "The cast tools roll it (save or attack, damage, condition, area); Workshop: Spells for a copy that runs the same" }
    : { support: "editable", where: "The cast guard spends the slot and checks the components; what it does is narrated. Workshop: Spells for a copy" };
}
// What the engine runs for an item: a weapon or suit, effects, riders,
// charges, check bonuses, spells. Attunement and weight alone are tracked,
// but what such an item does is the DM's.
const ENGINE_FIELDS = ["weapon", "armor", "weaponRiders", "armorRiders", "charges", "checks", "spells"];
function itemSupport(name: string): { support: PrepSupport; where: string } {
  const gear = itemMechanicsOf({ name, source: "srd", kind: "magic_item", data: {} }) ?? {};
  const runs = ENGINE_FIELDS.filter((key) => gear[key] !== undefined);
  if (Array.isArray(gear.effects) && gear.effects.length) runs.unshift("effects");
  return runs.length
    ? { support: "engine", where: `Workshop: Items; the engine runs its ${runs.join(", ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}` }
    : { support: "editable", where: "Workshop: Items; attunement and weight are tracked, what it does is the DM's to run" };
}

export function crosswalkFor(page: RulebookPage): Crosswalk {
  const base = { page: page.id, kind: page.kind };
  const catalogName = CATALOG_NAMES[page.id];
  if (TEMPLATES[page.id]) {
    return { ...base, ...TEMPLATES[page.id] };
  }
  switch (page.kind) {
    case "spell":
      return { ...base, editor: "spell", ...spellSupport(page.title) };
    case "item": {
      const name = catalogName ?? page.title;
      return {
        ...base,
        editor: "item",
        ...(catalogName ? { catalogName } : {}),
        ...(FAMILIES[page.id] ? { template: FAMILIES[page.id] } : {}),
        ...itemSupport(name),
      };
    }
    case "monster":
      return { ...base, editor: "monster", ...(catalogName ? { catalogName } : {}), support: "engine", where: "The fight engine runs its block; the Bestiary copies it whole, printed text included" };
    case "race":
      return { ...base, editor: "race", support: "structured", where: "The builder grants its traits; Workshop: Species for a copy or a new one" };
    case "class":
      return {
        ...base,
        editor: "archetype",
        classId: page.id,
        support: "engine",
        where: "The class is the bundled one the builder and level-up run; Workshop: Subclasses for new paths (a new base class is not something the workshop makes)",
      };
    case "rules":
    default: {
      const rule = RULES[page.id];
      return { ...base, editor: null, support: rule?.support ?? "reference", where: rule?.where ?? "Read in the book" };
    }
  }
}

let cached: Map<string, Crosswalk> | null = null;

export function crosswalkAll(): Crosswalk[] {
  cached ??= new Map(rulebookPages().map((page) => [page.id, crosswalkFor(page)]));
  return [...cached.values()];
}

export function crosswalkById(id: string): Crosswalk | null {
  if (!cached) crosswalkAll();
  return cached?.get(id) ?? null;
}

// The rules pages the matrix covers by hand, for the test that no rules
// page goes without a row.
export function ruleRowIds(): string[] {
  return Object.keys(RULES);
}
