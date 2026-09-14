// The sky over the table: the campaign clock and its weather, read as one
// scene state for the prompt and every client (docs/vtt-parity-
// implementation-plan.md section 2). refreshSky is called by everything
// that moves the clock (travel, rests, pass_time) and by set_weather; it
// rolls a new sky when a dawn was crossed or a long leg passed, stores it
// on the clock, publishes the persisted scene_state, and lets the room's
// ambience follow a storm.
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getClock, setClock } from "@/lib/db/clock";
import { breakDown, isDark, seasonOf, type CampaignClock } from "@/lib/dm/calendar";
import { publishSceneState } from "@/lib/dm/scene-state";
import { followWeatherAmbience } from "@/lib/dm/ambience-tools";
import { climateForGenre, describeWeather, rollWeather, type Climate } from "@/lib/srd/weather";
import { dayPartOf, type SceneState, type Weather } from "@/lib/scene/state";

export function campaignClimate(campaign: Pick<Campaign, "gameSettings">): Climate {
  return climateForGenre(campaign.gameSettings?.genre);
}

// The scene state as the clock stands now. Pure over the clock and the
// climate, so the snapshot and the publisher agree.
export function sceneFromClock(clock: CampaignClock, climate: Climate): SceneState {
  const date = breakDown(clock.calendar, clock.instant);
  return {
    hour: date.hour,
    dayPart: dayPartOf(date.hour),
    isDark: isDark(date.hour),
    weather: clock.weather,
    climate,
    summary: describeWeather(clock.weather),
    at: Date.now(),
  };
}

export function currentScene(campaign: Campaign): SceneState {
  return sceneFromClock(getClock(campaign.id), campaignClimate(campaign));
}

// Whether the sky should be rolled again after the clock moved: on the
// first read ever, at each dawn crossed, and after four hours on the road.
export function skyIsDue(before: CampaignClock, after: CampaignClock, minutes: number): boolean {
  if (!after.weather) {
    return true;
  }
  const dayBefore = Math.floor(before.instant / (24 * 60));
  const dayAfter = Math.floor(after.instant / (24 * 60));
  return dayAfter > dayBefore || minutes >= 4 * 60;
}

export function refreshSky(
  campaignId: string,
  input: { before?: CampaignClock; minutes?: number; force?: Weather | null } = {},
): SceneState | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }
  const clock = getClock(campaignId);
  const climate = campaignClimate(campaign);
  let weather = clock.weather;
  const previous = clock.weather;
  if (input.force !== undefined) {
    weather = input.force;
  } else if (skyIsDue(input.before ?? clock, clock, input.minutes ?? 0)) {
    const season = seasonOf(clock.calendar, breakDown(clock.calendar, clock.instant).month);
    weather = rollWeather(climate, season, clock.weather);
  }
  if (weather !== clock.weather) {
    setClock(campaignId, { ...clock, weather });
  }
  const scene = sceneFromClock({ ...clock, weather }, climate);
  publishSceneState(campaignId, scene);
  if (weather && (!previous || previous.sky !== weather.sky || previous.wind !== weather.wind)) {
    followWeatherAmbience(campaign, weather);
  }
  return scene;
}
