import { tickEffectMinutes } from "@/lib/db/active-effects";
import { getCampaignById } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { gutterBurntLights } from "@/lib/dm/light-timers";
import { fireCalendarEvents } from "@/lib/dm/calendar-fire";
import { tickClockConditions } from "@/lib/dm/condition-tick";
import { getDatabase, parseJson } from "@/lib/db/core";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
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
  const clock = { ...current, instant: moved.instant };
  // A Wild Shape lasts hours, and the hours are these.
  const lapsed = Object.entries(current.shapeEnds ?? {}).filter(([, ends]) => ends <= moved.instant);
  if (lapsed.length) {
    const shapeEnds = Object.fromEntries(
      Object.entries(current.shapeEnds ?? {}).filter(([, ends]) => ends > moved.instant),
    );
    if (Object.keys(shapeEnds).length) {
      clock.shapeEnds = shapeEnds;
    } else {
      delete clock.shapeEnds;
    }
  }
  setClock(campaignId, clock);
  for (const [characterId] of lapsed) {
    const sheet = getSheetById(characterId);
    if (sheet?.campaignId === campaignId && sheet.wildShape?.kind === "wildshape") {
      const updated = patchSheet(sheet.id, { wildShape: null });
      if (updated) {
        publishPersisted(campaignId, "sheet_updated", { sheet: updated });
      }
    }
  }
  // Time passing is what ends an effect measured in minutes. Doing it here
  // rather than in each caller means travel, a rest and pass_time all expire
  // the same things, which is the point of having one clock.
  tickEffectMinutes(campaignId, moved.minutes);
  // Timed conditions run on the same clock outside combat (issue #30): a
  // poison that outlasted the fight wears off on the road or over a night's
  // rest. Inside an encounter the round wrap owns them (condition-tick.ts),
  // so a DM nudging the clock mid-fight does not count the same time twice.
  if (!getActiveEncounter(campaignId)) {
    const campaign = getCampaignById(campaignId);
    if (campaign) {
      tickClockConditions(campaign, moved.minutes);
    }
  }
  // The same clock burns torches down and brings the calendar's days round
  // (docs/vtt-parity-implementation-plan.md 7.2 and 7.3).
  gutterBurntLights(campaignId, moved.instant);
  fireCalendarEvents(campaignId, current.calendar, current.instant, moved.instant);
  return { clock, minutes: moved.minutes };
}

// Setting the date by hand, which only a DM does and only to start a campaign
// somewhere other than day one, or to correct a drift.
export function setClockInstant(campaignId: string, instant: Instant): CampaignClock {
  const current = getClock(campaignId);
  const clock = { ...current, instant: clampInstant(instant) };
  setClock(campaignId, clock);
  return clock;
}

// Swapping the calendar keeps the instant, so the same moment is simply
// described differently. Changing what a year means would otherwise silently
// move every date the campaign has ever written down.
export function setCalendar(campaignId: string, calendar: CalendarDefinition): CampaignClock {
  const current = getClock(campaignId);
  const clock = { ...current, calendar };
  setClock(campaignId, clock);
  return clock;
}

// Writes down when a druid's beast form runs out: so many in-world hours
// from now. Taking a new form replaces the old entry.
export function recordShapeEnd(campaignId: string, characterId: string, hours: number) {
  const current = getClock(campaignId);
  setClock(campaignId, {
    ...current,
    shapeEnds: {
      ...(current.shapeEnds ?? {}),
      [characterId]: clampInstant(current.instant + Math.max(1, Math.round(hours)) * 60),
    },
  });
}

// Writes down when these characters' long rest ended, which is what the
// next one is measured from (src/lib/dm/calendar.ts longRestAllowed).
export function recordLongRests(campaignId: string, characterIds: string[], endedAt: Instant) {
  if (!characterIds.length) {
    return;
  }
  const current = getClock(campaignId);
  const longRests = { ...(current.longRests ?? {}) };
  for (const id of characterIds) {
    longRests[id] = clampInstant(endedAt);
  }
  setClock(campaignId, { ...current, longRests });
}
