import type { CatalogEntry } from "@/lib/dm/catalog-types";

// The console's shop forms (docs/vtt-parity-implementation-plan.md 11.1),
// one per tool the model has, so a person can keep a market too.
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
    name: "buy_item",
    label: "Buy from a shop",
    category: "party",
    summary: "The shelf sets the price; the purse decides.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "shop", label: "Shop", kind: "text", required: true },
      { name: "item", label: "Item", kind: "text", required: true },
      { name: "qty", label: "How many", kind: "number", min: 1, max: 99 },
    ],
  },
  {
    name: "sell_item",
    label: "Sell to a shop",
    category: "party",
    summary: "The keeper pays half list; name a price only for what the pack does not know.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "shop", label: "Shop", kind: "text", required: true },
      { name: "item", label: "Item", kind: "text", required: true },
      { name: "qty", label: "How many", kind: "number", min: 1, max: 99 },
      { name: "priceCp", label: "Price each (copper)", kind: "number", min: 1, help: "Only for an item the content pack has no price for." },
    ],
  },
  {
    name: "haggle",
    label: "Haggle",
    category: "social",
    summary: "A Persuasion check: win and every price drops a step, lose and they rise one. Once per character per shop.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "shop", label: "Shop", kind: "text", required: true },
    ],
  },
];
