// Whether the fight is in direct sunlight: an outdoor battle map whose sky,
// by the table's clock and weather, gives bright light. Sunlight Sensitivity
// (drow) reads it for attack rolls and for Perception by sight. Off a map
// the engine cannot tell a sunny road from a cellar, and nothing is imposed.
import { getClock } from "@/lib/db/clock";
import { effectiveAmbient } from "@/lib/battlemap/daylight";
import { getActiveBattleMap } from "@/lib/battlemap/view";
import { breakDown } from "@/lib/dm/calendar";

export function inDirectSunlight(campaignId: string): boolean {
  const map = getActiveBattleMap(campaignId);
  if (!map || !map.outdoors) {
    return false;
  }
  const clock = getClock(campaignId);
  const hour = breakDown(clock.calendar, clock.instant).hour;
  return effectiveAmbient(map.ambient, true, hour, clock.weather) === "bright";
}
