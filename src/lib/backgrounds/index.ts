// Original setting-specific backgrounds layered on top of the SRD/Open5e
// lists, mirroring the custom class catalog: each entry carries the genres
// that surface it in the picker's recommended group. Purely narrative plus
// two skill proficiencies; no level tables.
import type { Genre } from "@/lib/schemas/game-settings";
import catalogJson from "@/lib/backgrounds/catalog.json";

export type CustomBackground = {
  id: string;
  name: string;
  // Two skill ids from src/lib/srd/skills.json.
  skills: string[];
  // Named flavor feature, like the SRD backgrounds carry.
  feature: string;
  genres: Genre[];
  // One-line pitch, shown under the background select.
  blurb: string;
};

const catalog = catalogJson as { backgrounds: CustomBackground[] };

export const CUSTOM_BACKGROUNDS: CustomBackground[] = catalog.backgrounds;
