import type { CatalogEntry } from "@/lib/dm/catalog-types";

// The console's shop forms (docs/vtt-parity-implementation-plan.md 11.1),
// one per tool the model has, so a person can keep a market too. Buying and
// selling is the party's Buy or sell form (purchase), which trades at a shop
// standing here (issue #471).
export const COMMERCE_ADJUDICATIONS: CatalogEntry[] = [
  {
    name: "generate_settlement",
    label: "Populate this place",
    category: "world",
    summary: "Invent the people, shops, rumours and a hook for the party's current place.",
    fields: [
      { name: "size", label: "Size", kind: "select", options: [
        { value: "thorp", label: "Thorp" },
        { value: "hamlet", label: "Hamlet" },
        { value: "village", label: "Village" },
        { value: "town", label: "Town" },
        { value: "city", label: "City" },
      ] },
      { name: "terrain", label: "Terrain", kind: "select", options: [
        { value: "plains", label: "Plains" },
        { value: "forest", label: "Forest" },
        { value: "hills", label: "Hills" },
        { value: "mountains", label: "Mountains" },
        { value: "coast", label: "Coast" },
        { value: "river", label: "River" },
        { value: "swamp", label: "Swamp" },
        { value: "desert", label: "Desert" },
      ] },
    ],
  },
  {
    name: "open_shop",
    label: "Open a shop here",
    category: "world",
    summary: "Stock a shop at the party's place from the content pack, at the settlement's markup.",
    fields: [
      { name: "name", label: "Name", kind: "text", required: true, placeholder: "Marla's Sundries" },
      { name: "kind", label: "Kind", kind: "select", required: true, options: [
          { value: "general", label: "General store" },
          { value: "smith", label: "Smith" },
          { value: "apothecary", label: "Apothecary" },
          { value: "outfitter", label: "Outfitter" },
          { value: "curiosities", label: "Curiosities" },
        ],
      },
      { name: "size", label: "Settlement", kind: "select", options: [
          { value: "hamlet", label: "Hamlet" },
          { value: "village", label: "Village" },
          { value: "town", label: "Town" },
          { value: "city", label: "City" },
        ],
      },
      { name: "keeper", label: "Keeper", kind: "text", placeholder: "An NPC's name" },
    ],
  },
  {
    name: "haggle",
    label: "Haggle",
    category: "social",
    summary: "A haggling check: win and prices drop a step, fail and they hold, fail by 5 or more and they rise a step (two for Intimidation). The result is for the haggler and those at the counter with them. Once per character per shop; Deception works once per shop.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "shop", label: "Shop", kind: "text", required: true },
      { name: "skill", label: "Skill", kind: "select", options: [
          { value: "persuasion", label: "Persuasion" },
          { value: "intimidation", label: "Intimidation" },
          { value: "deception", label: "Deception" },
        ],
      },
      { name: "present", label: "Also at the counter", kind: "characters" },
    ],
  },
];
