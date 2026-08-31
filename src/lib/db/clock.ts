import { tickEffectMinutes } from "@/lib/db/active-effects";
import { getDatabase, parseJson } from "@/lib/db/core";
import {
  advance,
  clampInstant,
  normalizeClock,
  type AdvanceUnit,
  type CalendarDefinition,
  type CampaignClock,
  type Instant,
} from "@/lib/dm/calendar";

// Reading and writing the campaign's in-world clock.
//
// One column on the campaign row, hydrated onto every Campaign as `clock`, so
// the DM prompt, the status bar and every engine that wants to know what day
// it is read the same value without a second query. The functions here exist
// for the callers that MOVE it: travel, rests, and the DM saying a week goes
// by.

export function getClock(campaignId: string): CampaignClock {
  const row = getDatabase()
    .prepare(`SELECT clock_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { clock_json?: string } | undefined;
  return normalizeClock(parseJson(row?.clock_json ?? "", null));
}

export function setClock(campaignId: string, clock: CampaignClock) {
  getDatabase()
    .prepare(`UPDATE campaigns SET clock_json = ? WHERE id = ?`)
    .run(JSON.stringify(clock), campaignId);
}

// Moving the clock forward, read and written in one place so two engines
// advancing it at once (a rest finishing while the world ticks) cannot both
// write from the same stale instant.
export function advanceClock(
  campaignId: string,
  amount: number,
  unit: AdvanceUnit,
): { clock: CampaignClock; minutes: number } | { error: string } {
  const current = getClock(campaignId);
  const moved = advance(current.instant, amount, unit);
  if ("error" in moved) {
    return moved;
  }
  const clock = { calendar: current.calendar, instant: moved.instant };
  setClock(campaignId, clock);
  // Time passing is what ends an effect measured in minutes. Doing it here
  // rather than in each caller means travel, a rest and pass_time all expire
  // the same things, which is the point of having one clock.
  tickEffectMinutes(campaignId, moved.minutes);
  return { clock, minutes: moved.minutes };
}

// Setting the date by hand, which only a DM does and only to start a campaign
// somewhere other than day one, or to correct a drift.
export function setClockInstant(campaignId: string, instant: Instant): CampaignClock {
  const current = getClock(campaignId);
  const clock = { calendar: current.calendar, instant: clampInstant(instant) };
  setClock(campaignId, clock);
  return clock;
}

// Swapping the calendar keeps the instant, so the same moment is simply
// described differently. Changing what a year means would otherwise silently
// move every date the campaign has ever written down.
export function setCalendar(campaignId: string, calendar: CalendarDefinition): CampaignClock {
  const current = getClock(campaignId);
  const clock = { calendar, instant: current.instant };
  setClock(campaignId, clock);
  return clock;
}
