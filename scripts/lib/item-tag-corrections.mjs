// What a person corrected after reading the generated item tags against each
// item's own text. scripts/generate-item-tags.mjs applies these after the
// rules (scripts/lib/item-tag-rules.mjs), so the committed table is the
// rules' output with these rows added or retagged, and a re-run reproduces
// it. Each entry says why, so the next reader can check the call.

// Things the SRD 5.1 names that the pack lists no row for, with the tags the
// SRD's text gives them.
export const ADDED = [
  // Potions the pack's SRD document leaves out (SRD 5.1, Magic Items).
  { name: "Potion of Vitality", tags: ["consumable", "potion", "carried"], why: "an SRD 5.1 potion the pack has no row for" },
  { name: "Elixir of Health", tags: ["consumable", "potion", "carried"], why: "an SRD 5.1 potion the pack has no row for" },
  // The weather rules' clothing (SRD 5.1, The Environment: Extreme Cold,
  // Extreme Heat), which no equipment table prices.
  { name: "Cold Weather Gear", tags: ["kept", "cold_weather_gear"], why: "the extreme cold rule's gear: thick coats, gloves and the like" },
  { name: "Heavy Clothing", tags: ["kept", "heavy_clothing"], why: "the extreme heat rule's heavy clothing" },
];

// Rows whose tags the rules get wrong, keyed by the item's name in lower
// case: the tags the item's text gives it instead.
export const RETAGGED = {
  // Pours fresh water on command: a party's water, never used up.
  "decanter of endless water": ["durable", "water"],
};
