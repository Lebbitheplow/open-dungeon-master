// Original setting-specific backgrounds layered on top of the SRD/Open5e
// lists, mirroring the custom class catalog: each entry carries the genres
// that surface it in the picker's recommended group. Skills, tools,
// languages and starting gear, same grants an SRD background makes; no
// level tables.
import { SRD_BACKGROUNDS } from "@/lib/srd";
import type { Genre } from "@/lib/schemas/game-settings";
import catalogJson from "@/lib/backgrounds/catalog.json";

export type CustomBackground = {
  id: string;
  name: string;
  // Two skill ids from src/lib/srd/skills.json.
  skills: string[];
  // Named flavor feature, like the SRD backgrounds carry.
  feature: string;
  // Tool/kit proficiencies granted.
  tools: string[];
  // Extra languages of the player's choice.
  languages: number;
  // Starting gear, listed on the sheet's inventory at creation.
  equipment: string[];
  genres: Genre[];
  // One-line pitch, shown under the background select.
  blurb: string;
};

const catalog = catalogJson as { backgrounds: CustomBackground[] };

export const CUSTOM_BACKGROUNDS: CustomBackground[] = catalog.backgrounds;

// The named feature a background grants, for the sheet's feature list.
// Covers both the SRD list and the setting catalog.
export function backgroundFeatureFor(
  backgroundId: string,
): { name: string; background: string } | null {
  const id = (backgroundId || "").trim().toLowerCase();
  if (!id) {
    return null;
  }
  const custom = CUSTOM_BACKGROUNDS.find((entry) => entry.id === id);
  if (custom) {
    return { name: custom.feature, background: custom.name };
  }
  const srd = SRD_BACKGROUNDS.find((entry) => entry.id === id);
  return srd ? { name: srd.feature, background: srd.name } : null;
}
