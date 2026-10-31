// The fixed tags an item can carry for what it is, when no English row says
// it (src/lib/srd/item-tags.ts reads them). A list of its own so the sheet
// and homebrew schemas take it without importing the SRD tables.

export const ITEM_TAGS = [
  // How use_item treats it (src/lib/dm/item-logic.ts itemUseProblem): used
  // up, kept though used (a waterskin), or worn, wielded and kept.
  "consumable",
  "kept",
  "durable",
  // Drunk, or read (src/lib/dm/consumables.ts).
  "potion",
  "healing_potion",
  "scroll",
  // A day's food and water (src/lib/dm/supplies.ts).
  "food",
  "water",
  // Light and its fuel (src/lib/dm/light-timers.ts).
  "everburning_light",
  "bullseye_lantern",
  "lantern",
  "torch",
  "candle",
  "lamp_oil",
  "lamp",
  // Dressed for the weather (src/lib/dm/hazard-tools.ts).
  "cold_weather_gear",
  "heavy_clothing",
  // Spellcasting's material and focus (src/lib/dm/cast-materials.ts).
  "component_pouch",
  "arcane_focus",
  "holy_symbol",
  "druidic_focus",
  "instrument",
  "tools",
  // A focus held in the hand (src/lib/dm/cast-rules.ts), an artificer's
  // Arcane Firearm (authored effects).
  "wand",
  "staff",
  "rod",
  // Ammunition by the weapon that fires it (src/lib/srd/ammunition.ts).
  "arrows",
  "bolts",
  "bullets",
  "needles",
  // A weapon's material (src/lib/dm/damage-logic.ts).
  "silvered",
  "adamantine",
  // Treasure sold by its worth (src/lib/dm/trade-value.ts).
  "gem",
  "art_object",
  "trade_good",
  // Works from the pack, never worn (components/sheet/sheet-state.ts).
  "carried",
] as const;
export type ItemTag = (typeof ITEM_TAGS)[number];

// The listed tags in a stored value, in list order; anything else is dropped.
export function listedItemTags(raw: unknown): ItemTag[] {
  return Array.isArray(raw) ? ITEM_TAGS.filter((tag) => raw.includes(tag)) : [];
}
