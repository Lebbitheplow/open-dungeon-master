import { containsPhrase } from "../language/text-logic.ts";

// Creatures a model must never hand the Bestiary (docs/art/creature-art-guidance.md):
// the SRD 5.1 OGL edition's Product Identity list, page 1, and the watch list
// of WotC-specific designs ODM has no permission basis for. A generated
// creature is a named SRD creature or an original design; a generic prompt
// ("an aberration", "a horror from the deep") must not come back as one of
// these. Pure, so the outline reader and the creature adapter share it and
// scripts/test-world-outline.mjs drives it directly.

const RESERVED: readonly string[] = [
  // Product Identity, SRD 5.1 (OGL edition), page 1.
  "beholder",
  "gauth",
  "carrion crawler",
  "displacer beast",
  "githyanki",
  "githzerai",
  "mind flayer",
  "illithid",
  "umber hulk",
  "yuan-ti",
  "yuan ti",
  "tanar'ri",
  "baatezu",
  // No permission basis recorded for ODM.
  "kuo-toa",
  "slaad",
  "slaadi",
  "flumph",
  "neogi",
  "hook horror",
  "grell",
  "intellect devourer",
  "death knight",
];

// The reserved name a text names as whole words, or "" for none.
export function reservedCreature(...texts: string[]): string {
  for (const text of texts) {
    if (!text) continue;
    const hit = RESERVED.find((name) => containsPhrase(text, name));
    if (hit) return hit;
  }
  return "";
}

// What the prompt tells the model, in the guide's own terms.
export const RESERVED_RULE =
  "Every creature is either a named creature from the 5e System Reference Document 5.1 (an owlbear, a chuul, an aboleth, a basilisk) or an original design of your own. " +
  "Never a beholder, mind flayer, illithid, githyanki, githzerai, yuan-ti, umber hulk, carrion crawler, displacer beast, slaad, kuo-toa, flumph, neogi, hook horror, grell, intellect devourer or death knight, nor a renamed one.";
