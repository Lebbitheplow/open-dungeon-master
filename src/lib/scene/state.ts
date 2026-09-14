// The shape of the persisted `scene_state` event and its siblings: what the
// sky over the table looks like, what the DM's camera is doing, and what
// title card or handout is up. Pure types plus the defaults, so the client
// reducer, the server publisher and the tests all agree without importing
// the database. Publishers live in src/lib/dm/scene-state.ts.

export type Sky = "clear" | "overcast" | "rain" | "storm" | "snow" | "fog" | "wind";
export type Temperature = "frigid" | "cold" | "mild" | "warm" | "hot";
export type Wind = "calm" | "breeze" | "gale";

export type Weather = {
  sky: Sky;
  temperature: Temperature;
  wind: Wind;
  // 0 none, 1 light, 2 steady, 3 heavy.
  precipitation: 0 | 1 | 2 | 3;
};

export type DayPart = "night" | "dawn" | "morning" | "day" | "dusk" | "evening";

export type SceneState = {
  // 0..23 in the campaign calendar.
  hour: number;
  dayPart: DayPart;
  isDark: boolean;
  weather: Weather | null;
  // Climate from the genre preset; the sky layer picks embers or motes.
  climate: "temperate" | "arid" | "boreal" | "tropical" | "blighted";
  // The line the prompt reads, so the client can print the same words.
  summary: string;
  at: number;
};

export const DEFAULT_WEATHER: Weather = {
  sky: "clear",
  temperature: "mild",
  wind: "calm",
  precipitation: 0,
};

export const DEFAULT_SCENE: SceneState = {
  hour: 12,
  dayPart: "day",
  isDark: false,
  weather: null,
  climate: "temperate",
  summary: "",
  at: 0,
};

export type TitleCard = {
  id: string;
  title: string;
  subtitle?: string;
  // Gold for chapters, ember for a fight, dawn for a rest, plain for the DM's own.
  tone: "gold" | "ember" | "dawn" | "plain";
  sting?: string;
  at: number;
};

export type CameraEvent = {
  mode: "pull" | "lock" | "free";
  // Tile coordinates of the centre and a zoom factor, when pulling or locking.
  x?: number;
  y?: number;
  zoom?: number;
  at: number;
};

export type HandoutShown = {
  id: string;
  loreId?: string;
  imagePath?: string;
  title: string;
  caption?: string;
  // Parchment for lore, notice for a poster, image for a bare picture.
  style: "parchment" | "notice" | "image";
  // User ids allowed to see it, or null for the table. The server already
  // filtered before sending, but the client keeps the field so a DM seat
  // can show who got it.
  audience: string[] | null;
  dismissed?: boolean;
  at: number;
};

export function dayPartOf(hour: number): DayPart {
  if (hour < 5 || hour >= 22) {
    return "night";
  }
  if (hour < 7) {
    return "dawn";
  }
  if (hour < 12) {
    return "morning";
  }
  if (hour < 17) {
    return "day";
  }
  if (hour < 19) {
    return "dusk";
  }
  return "evening";
}
