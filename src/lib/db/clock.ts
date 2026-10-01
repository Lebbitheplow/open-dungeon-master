import { tickEffectMinutes } from "@/lib/db/active-effects";
import { getCampaignById } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { gutterBurntLights } from "@/lib/dm/light-timers";
import { dawnsBetween, rechargeAtDawn } from "@/lib/dm/item-charges";
import { upkeepAtDawns } from "@/lib/dm/supplies";
import { afflictionClockTick } from "@/lib/dm/afflictions";
import { poisonClockTick } from "@/lib/dm/affliction-poisons";
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
  // Time moving on closes the choosing of hit dice after a short rest.
  delete clock.shortRest;
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
  // Every dawn crossed refills the wands and staffs that regain at dawn,
  // and, under the supplies variant, ends a day of eating and drinking.
  rechargeAtDawn(campaignId, current.instant, moved.instant);
  const hunger = upkeepAtDawns(campaignId, dawnsBetween(current.instant, moved.instant), current.supplies ?? {});
  if (hunger) {
    setClock(campaignId, { ...getClock(campaignId), supplies: hunger });
  }
  fireCalendarEvents(campaignId, current.calendar, current.instant, moved.instant);
  // A disease's symptoms, a long madness ending, a poison's daily save or
  // its midnight (src/lib/dm/afflictions.ts, affliction-poisons.ts).
  afflictionClockTick(campaignId, moved.instant);
  poisonClockTick(campaignId, moved.instant);
  return { clock: getClock(campaignId), minutes: moved.minutes };
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

// The pace the party travels at, until they stop (src/lib/dm/check-tools.ts
// reads it for passive Perception).
export function setTravelPace(campaignId: string, pace: CampaignClock["travelPace"] | null) {
  const current = getClock(campaignId);
  const { travelPace: _was, ...rest } = current;
  void _was;
  setClock(campaignId, pace ? { ...rest, travelPace: pace } : rest);
}

// How much water the party finds each day, for the `supplies` variant
// (src/lib/dm/supplies.ts); "plenty" clears a shortage.
export function setWaterRation(campaignId: string, ration: "plenty" | "half" | "none") {
  const { waterRation: _was, ...rest } = getClock(campaignId);
  void _was;
  setClock(campaignId, ration === "plenty" ? rest : { ...rest, waterRation: ration });
}

// Undoing a long rest gives back the 24 hours it started: the character may
// take the rest again (sheet-undo.ts). Only the rest the undo reverts is
// forgotten, so a later one still counts.
export function forgetLongRest(campaignId: string, characterId: string) {
  const current = getClock(campaignId);
  if (!current.longRests?.[characterId]) {
    return;
  }
  const longRests = { ...current.longRests };
  delete longRests[characterId];
  setClock(campaignId, { ...current, longRests });
}

// After a short rest, the characters whose players choose their own hit
// dice (src/lib/dm/rest-tools.ts). Replaces any earlier window.
export function openShortRestWindow(campaignId: string, characterIds: string[]) {
  const current = getClock(campaignId);
  const { shortRest: _old, ...rest } = current;
  void _old;
  setClock(campaignId, characterIds.length ? { ...rest, shortRest: { ids: characterIds, sung: [] } } : rest);
}

// Whether this character may still spend hit dice from the rest just taken.
export function inShortRestWindow(campaignId: string, characterId: string): boolean {
  return getClock(campaignId).shortRest?.ids.includes(characterId) ?? false;
}

// Marks this character's Song of Rest die as spent in the open window, and
// says whether it had been before.
export function claimRestSong(campaignId: string, characterId: string): boolean {
  const current = getClock(campaignId);
  if (!current.shortRest || current.shortRest.sung.includes(characterId)) {
    return false;
  }
  setClock(campaignId, {
    ...current,
    shortRest: { ...current.shortRest, sung: [...current.shortRest.sung, characterId] },
  });
  return true;
}
