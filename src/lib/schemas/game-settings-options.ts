// The option lists and labels of the game settings, with no zod in sight:
// the campaign wizard on the home dashboard draws from these, and pulling
// the schema module itself would ship the whole validator with the home
// page. ./game-settings builds its enums from these same lists and
// re-exports them, so either import path names the same values.

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

// Who narrates. Mirrors DmMode in src/lib/dm/viewer.ts, which holds the pure
// rules about what each seat may see and do; this is the stored setting.
export const DM_MODES = ["ai", "human", "assisted"] as const;
export type DmModeSetting = (typeof DM_MODES)[number];

export const DM_MODE_LABELS: Record<DmModeSetting, string> = {
  ai: "AI Dungeon Master",
  human: "I run the game",
  assisted: "I run the game, with AI help",
};

export const DM_MODE_HINTS: Record<DmModeSetting, string> = {
  ai: "The AI narrates, adjudicates and runs the world. The party lead steers it.",
  human: "You narrate. The server still enforces every rule and rolls every die.",
  assisted: "You own the story; hand the AI the monsters, the prose, or a stretch of turns.",
};

// How far the secret story saga is planned: how many acts the arc spans and
// how many bosses/threads it seeds. Read when a saga is generated (activation,
// lead regenerate, the v2 upgrade pass, and each sequel saga), so changing it
// mid-campaign applies when the next saga is planned.
export const CAMPAIGN_LENGTHS = ["short", "standard", "epic"] as const;
export type CampaignLengthSetting = (typeof CAMPAIGN_LENGTHS)[number];

// Shared by the create dialog and the lobby settings panel.
export const CAMPAIGN_LENGTH_LABELS: Record<CampaignLengthSetting, string> = {
  short: "Short (3 acts, a focused adventure)",
  standard: "Standard (4-5 acts)",
  epic: "Epic (6-8 acts, a sprawling saga)",
};

export const COMPANION_SETTINGS = ["auto", "full", "guests", "off"] as const;
export type CompanionSetting = (typeof COMPANION_SETTINGS)[number];

export const COMPANION_LABELS: Record<CompanionSetting, string> = {
  auto: "Auto (solo: full; multiplayer: guests only)",
  full: "Party members and guests",
  guests: "Temporary guests only",
  off: "Off",
};
