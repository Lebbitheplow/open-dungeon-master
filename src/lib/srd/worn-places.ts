// The places a workshop item's author may pick for it in the item form
// ("Worn on"), carried onto a sheet as `gear.wornOn` and read by the slot
// rules (src/lib/srd/wear-slots.ts). A suit or a shield takes its place from
// its armour block instead. Imports nothing, so the homebrew data module and
// the form read it without the rules tables.

export const WORN_PLACES = ["cloak", "head", "feet", "hands", "wrists", "neck", "waist", "ring", "eyes", "robe"] as const;
export type WornPlace = (typeof WORN_PLACES)[number];

// Where on the body, and what usually goes there.
export const WORN_PLACE_LABELS: Record<WornPlace, string> = {
  cloak: "Shoulders (a cloak or cape)",
  head: "Head (a hat, helm or circlet)",
  feet: "Feet (boots or slippers)",
  hands: "Hands (gloves or gauntlets)",
  wrists: "Wrists (bracers)",
  neck: "Neck (an amulet or necklace)",
  waist: "Waist (a belt)",
  ring: "Finger (a ring)",
  eyes: "Eyes (goggles or lenses)",
  robe: "Body (a robe)",
};

// What the place means at the table, for the picker's glossary (SRD 5.1,
// Magic Items, Multiple Items of the Same Kind).
export const WORN_PLACE_BLURBS: Record<WornPlace, string> = {
  cloak: "One cloak counts at a time; a second one worn there adds nothing unless the DM allows both.",
  head: "One item of headwear counts at a time; the DM may allow a circlet under a helmet.",
  feet: "One pair of footwear counts at a time.",
  hands: "One pair of gloves or gauntlets counts at a time.",
  wrists: "One pair of bracers counts at a time.",
  neck: "No limit beyond attunement; amulets and necklaces may be worn together.",
  waist: "No limit beyond attunement.",
  ring: "No limit beyond attunement.",
  eyes: "No limit beyond attunement.",
  robe: "No limit beyond attunement.",
};

// The place in a sentence: "worn on the shoulders" (the workshop list line).
export const WORN_PLACE_WORDS: Record<WornPlace, string> = {
  cloak: "shoulders",
  head: "head",
  feet: "feet",
  hands: "hands",
  wrists: "wrists",
  neck: "neck",
  waist: "waist",
  ring: "finger",
  eyes: "eyes",
  robe: "body",
};

export function isWornPlace(value: unknown): value is WornPlace {
  return typeof value === "string" && (WORN_PLACES as readonly string[]).includes(value);
}
