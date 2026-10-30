// The light a character sees by off the battle map, read once for the
// passive gate (check_notice, src/lib/dm/check-tools.ts) and for a rolled
// check (rollExtrasFor, src/lib/dm/forced-save.ts), so the two never
// disagree about whether the party can see: before this, check_notice said
// "darkness: sees nothing" while a request_roll Perception by sight beside it
// rolled as in daylight. A board keeps its own light (null here).
import { getActiveBattleMap, sheetDarkvisionTiles } from "@/lib/battlemap/view";
import { getClock } from "@/lib/db/clock";
import { getCurrentLocation } from "@/lib/db/locations";
import { getPreparedMap } from "@/lib/db/prepared-maps";
import { breakDown } from "@/lib/dm/calendar";
import { carriedLight } from "@/lib/dm/light-timers";
import { lightSeenBy, offBoardLight, type Light } from "@/lib/dm/notice-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The light of the place off the board: the one the DM names, else the
// current location's (an unlit cave is dark at noon, a lit inn is not dark
// at midnight), else the sky's by the hour. Null on a board, or where the
// place's words do not settle it.
export function offBoardAmbient(campaignId: string, named: Light | null = null): Light | null {
  if (getActiveBattleMap(campaignId)) {
    return null;
  }
  const clock = getClock(campaignId);
  const place = getCurrentLocation(campaignId);
  return offBoardLight({
    hour: breakDown(clock.calendar, clock.instant).hour,
    named,
    place: place
      ? {
          name: place.name,
          description: place.layoutDescription,
          outdoors: place.preparedMapId ? getPreparedMap(campaignId, place.preparedMapId)?.outdoors ?? null : null,
        }
      : null,
  });
}

// What one character sees by in that light: their own lit torch or lantern,
// then darkvision on top.
export function lightForSheet(ambient: Light, sheet: CharacterSheet): Light {
  return lightSeenBy(ambient, carriedLight(sheet).radius > 0, sheetDarkvisionTiles(sheet) > 0);
}

// The light a character's own check by sight is made in, off the board.
export function rollerLight(campaignId: string, sheet: CharacterSheet): Light | null {
  const ambient = offBoardAmbient(campaignId);
  return ambient ? lightForSheet(ambient, sheet) : null;
}
