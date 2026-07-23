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

// How far the secret story saga is planned: how many acts the arc spans and
// how many bosses/threads it seeds. Read when a saga is generated (activation,
// lead regenerate, the v2 upgrade pass, and each sequel saga), so changing it
// mid-campaign applies when the next saga is planned.
export const CAMPAIGN_LENGTHS = ["short", "standard", "epic"] as const;
export type CampaignLengthSetting = (typeof CAMPAIGN_LENGTHS)[number];

// Game-facing campaign settings. Stored in campaigns.game_settings_json,
// separate from settings_json (the model/image StorySettings) so the two
// never fight over shape.
export const gameSettingsSchema = z.object({
  genre: z.enum(GENRES).default("high_fantasy"),
  customGenreText: z.string().trim().max(500).default(""),
  aiStorySetup: z.boolean().default(true),
  campaignLength: z.enum(CAMPAIGN_LENGTHS).default("standard"),
  dicePolicy: z.enum(DICE_POLICIES).default("digital_only"),
  ttsEnabled: z.boolean().default(true),
  ttsVoice: z.string().trim().max(40).default("af_heart"),
  mapsEnabled: z.boolean().default(true),
  // Whether characters may take levels in a second (or third) class at
  // level-up. On by default; turning it off keeps the level-up flow
  // single-class (already-multiclassed characters keep what they have).
  multiclassingEnabled: z.boolean().default(true),
  // Lets new players join with the invite code after the adventure started.
  midGameJoinOpen: z.boolean().default(false),
  // The living-world engines: off-screen world arcs advancing on background
  // dice, surprise/encounter sparks, and NPC goal simulation during
  // timeskips. Off preserves pre-engine behavior exactly.
  worldSimulation: z.boolean().default(true),
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
  // When on, DM-initiated item and gold changes to player characters become
  // pending offers the owning player accepts or declines instead of applying
  // immediately (src/lib/dm/proposal-logic.ts). Off preserves auto-apply.
  inventoryApprovals: z.boolean().default(false),
  // Optional 5e variant rules the server engines and DM prompt honor.
  // Rendered as one line each in the prompt by src/lib/dm/rules-logic.ts.
  variantRules: z
    .object({
      flanking: z.boolean().default(false),
      criticalFumbles: z.boolean().default(false),
      encumbrance: z.boolean().default(false),
      lingeringInjuries: z.boolean().default(false),
      restVariant: z.enum(["standard", "gritty", "heroic"]).default("standard"),
    })
    .default({
      flanking: false,
      criticalFumbles: false,
      encumbrance: false,
      lingeringInjuries: false,
      restVariant: "standard",
    }),
});

export type GameSettings = z.infer<typeof gameSettingsSchema>;

// Shared by the create dialog and the lobby settings panel.
export const CAMPAIGN_LENGTH_LABELS: Record<CampaignLengthSetting, string> = {
  short: "Short (3 acts, a focused adventure)",
  standard: "Standard (4-5 acts)",
  epic: "Epic (6-8 acts, a sprawling saga)",
};

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
