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
  // AI companions the DM can write into the story. 'full' allows lasting
  // party members plus scene-scoped guest allies; 'guests' allows only the
  // temporary allies (a soldier helping for one battle) so the AI never
  // fabricates campaign-long members; 'off' disables both. 'auto' resolves
  // to full for solo campaigns and guests for multiplayer ones.
  companions: z.enum(["auto", "full", "guests", "off"]).default("auto"),
  // Lasting party companions allowed at once. Scene-scoped guests have their
  // own cap so a temporary ally never eats a party slot.
  maxCompanions: z.number().int().min(1).max(4).default(2),
  maxGuests: z.number().int().min(1).max(4).default(2),
});

export type GameSettings = z.infer<typeof gameSettingsSchema>;

// Shared by the create dialog and the lobby settings panel.
export const COMPANION_LABELS: Record<GameSettings["companions"], string> = {
  auto: "Auto (solo: full; multiplayer: guests only)",
  full: "Party members and guests",
  guests: "Temporary guests only",
  off: "Off",
};

export type CompanionMode = "full" | "guests" | "off";

// 'auto' resolves per table size: a solo player gets lasting party members, a
// multiplayer table gets only scene-scoped guest allies. Pure so the server
// (companion-tools) and the client panels resolve it identically.
export function resolveCompanionMode(
  settings: GameSettings,
  memberCount: number,
): CompanionMode {
  const setting = settings.companions;
  if (setting === "off" || setting === "full" || setting === "guests") {
    return setting;
  }
  return memberCount <= 1 ? "full" : "guests";
}

// Whether the DM could still write an ally in: party members and scene guests
// have separate caps, so either kind having room is enough.
export function companionSlotsFree(
  settings: GameSettings,
  memberCount: number,
  companionKinds: Array<"party" | "guest">,
): boolean {
  const mode = resolveCompanionMode(settings, memberCount);
  if (mode === "off") {
    return false;
  }
  const guests = companionKinds.filter((kind) => kind === "guest").length;
  if (guests < settings.maxGuests) {
    return true;
  }
  const party = companionKinds.length - guests;
  return mode === "full" && party < settings.maxCompanions;
}

export function normalizeGameSettings(raw: unknown): GameSettings {
  const parsed = gameSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : gameSettingsSchema.parse({});
}
