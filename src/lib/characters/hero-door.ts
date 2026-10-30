import type { Campaign } from "@/lib/db/campaigns";
import { listSheetsForUser } from "@/lib/db/sheets";
import { fallenHero, heroDoorOpen, heroJoinLevel } from "@/lib/characters/fallen-logic";

export const HERO_DOOR_SHUT = "You already have a character in this campaign.";

export type HeroDoor = {
  // Whether this player may seat another hero (fallen-logic.ts heroDoorOpen).
  open: boolean;
  // Their fallen hero when every one of theirs at the table has died.
  fallen: { id: string; name: string; level: number } | null;
  // The level a hero joins at, and the campaign as that seat joins it: the
  // table's own, or a copy whose start level is the replacement's, so the
  // admission, the adaptation and the preview all judge the hero at the
  // level it will play without each door passing a level of its own.
  level: number;
  campaign: Campaign;
};

// One answer for every door that seats a hero: the builder and the library
// (POST /sheet), a ready-made hero (/sheet/pregen), one the GM offered
// (/sheet/offered) and the confirm sheet before them (/sheet/preview).
export function heroDoorFor(campaign: Campaign, userId: string): HeroDoor {
  const own = listSheetsForUser(campaign.id, userId);
  const fallen = fallenHero(own);
  const level = heroJoinLevel(own, campaign.startingLevel);
  return {
    // A finished campaign seats no replacement: the story is over.
    open: heroDoorOpen(own, campaign.gameSettings.multiCharacter) && !(campaign.status === "ended" && own.length > 0),
    fallen: fallen ? { id: fallen.id, name: fallen.name, level: fallen.level } : null,
    level,
    campaign: level === campaign.startingLevel ? campaign : { ...campaign, startingLevel: level },
  };
}
