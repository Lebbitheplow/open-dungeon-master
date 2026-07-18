import { z } from "zod";

export const GENRES = [
  "high_fantasy",
  "dark_fantasy",
  "mystery",
  "horror",
  "cyberpunk",
  "steampunk",
  "post_apocalyptic",
  "custom",
] as const;
export type Genre = (typeof GENRES)[number];

export const DICE_POLICIES = ["digital_only", "real_allowed"] as const;
export type DicePolicy = (typeof DICE_POLICIES)[number];

// Game-facing campaign settings. Stored in campaigns.game_settings_json,
// separate from settings_json (the model/image StorySettings) so the two
// never fight over shape.
export const gameSettingsSchema = z.object({
  genre: z.enum(GENRES).default("high_fantasy"),
  customGenreText: z.string().trim().max(500).default(""),
  aiStorySetup: z.boolean().default(true),
  dicePolicy: z.enum(DICE_POLICIES).default("digital_only"),
  ttsEnabled: z.boolean().default(true),
  ttsVoice: z.string().trim().max(40).default("af_heart"),
  mapsEnabled: z.boolean().default(true),
  // Lets new players join with the invite code after the adventure started.
  midGameJoinOpen: z.boolean().default(false),
  // After each DM narration, block do and say for everyone until the party
  // lead opens responses. OOC and lead directions stay available.
  holdSubmissions: z.boolean().default(false),
});

export type GameSettings = z.infer<typeof gameSettingsSchema>;

export function normalizeGameSettings(raw: unknown): GameSettings {
  const parsed = gameSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : gameSettingsSchema.parse({});
}
