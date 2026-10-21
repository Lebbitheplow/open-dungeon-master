import { z } from "zod";
import { CAMPAIGN_DIFFICULTIES } from "@/lib/campaign-types";
import { HOUSE_RULES_MAX } from "@/lib/dm/rules-logic";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";

// A person's own campaign defaults: the table they usually run, saved once
// from the new-campaign dialog and used to start every campaign they create
// after (docs/campaign-creator-guided-setup-plan.md section 6). One saved
// setup per account, kept with the account's other preferences
// (users.settings_json, key `campaignDefaults`), never in a browser.
//
// Only table settings are kept. What belongs to one campaign (its title,
// premise, theme, world pack, lore and imported prep) never is, and neither is
// anything about the server: no provider, key, address or campaign id.
//
// Pure: the profile route validates writes with it, the dialog converts with
// it, and scripts/test-campaign-defaults.mjs pins both.

export const CAMPAIGN_DEFAULTS_VERSION = 1;

// The game settings a default may carry, under their gameSettings names (the
// draft calls `voice` `voiceChat`).
export const DEFAULT_GAME_SETTING_KEYS = [
  "dmMode",
  "genre",
  "customGenreText",
  "tableLanguage",
  "aiStorySetup",
  "campaignLength",
  "dicePolicy",
  "hpMethod",
  "startingWealth",
  "abilityRerollBelow",
  "ttsEnabled",
  "ttsVoice",
  "ttsSpeed",
  "ttsAutoCast",
  "mapsEnabled",
  "ambienceEnabled",
  "ambienceAuto",
  "boardDrawing",
  "enemyIntent",
  "presentation",
  "multiCharacter",
  "multiclassingEnabled",
  "worldSimulation",
  "inventoryApprovals",
  "vitalsApprovals",
  "midGameJoinOpen",
  "holdSubmissions",
  "narrationGuard",
  "safety",
  "gm",
  "relationships",
  "romance",
  "variantRules",
  "companions",
  "maxCompanions",
  "maxGuests",
  "voice",
] as const satisfies ReadonlyArray<keyof typeof gameSettingsSchema.shape>;

type GameSettingKey = (typeof DEFAULT_GAME_SETTING_KEYS)[number];

// The campaign row's own fields a default may carry, plus the house rules
// text a person reuses from table to table.
const TABLE_FIELD_SCHEMAS = {
  maxPlayers: z.number().int().min(1).max(8),
  startingLevel: z.number().int().min(1).max(20),
  difficulty: z.enum(CAMPAIGN_DIFFICULTIES),
  houseRules: z.string().max(HOUSE_RULES_MAX),
};

type TableFieldKey = keyof typeof TABLE_FIELD_SCHEMAS;

export type CampaignDefaultKey = GameSettingKey | TableFieldKey;

export const CAMPAIGN_DEFAULT_KEYS: readonly CampaignDefaultKey[] = [
  ...DEFAULT_GAME_SETTING_KEYS,
  ...(Object.keys(TABLE_FIELD_SCHEMAS) as TableFieldKey[]),
];

const shape = gameSettingsSchema.shape;

// Each key is checked against the schema the campaign itself uses, so a
// default can never hold a value a new campaign would refuse. Parsed one key
// at a time and only when present: a missing key stays missing rather than
// arriving as the schema's default, so a saved setup keeps meaning "what this
// person chose", never "what the schema filled in".
function schemaFor(key: CampaignDefaultKey): z.ZodType {
  return key in TABLE_FIELD_SCHEMAS ? TABLE_FIELD_SCHEMAS[key as TableFieldKey] : shape[key as GameSettingKey];
}

export type CampaignDefaultSettings = {
  [K in GameSettingKey]?: z.infer<(typeof shape)[K]>;
} & { [K in TableFieldKey]?: z.infer<(typeof TABLE_FIELD_SCHEMAS)[K]> };

export type CampaignDefaults = {
  version: typeof CAMPAIGN_DEFAULTS_VERSION;
  savedAt: string;
  settings: CampaignDefaultSettings;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A write from the dialog: every key known, every value valid, nothing else.
// A refusal names the first thing wrong, so the dialog can say it.
export function validateDefaultsWrite(
  input: unknown,
): { ok: true; settings: CampaignDefaultSettings } | { ok: false; error: string } {
  if (!isRecord(input) || input.version !== CAMPAIGN_DEFAULTS_VERSION || !isRecord(input.settings)) {
    return { ok: false, error: "Those defaults are not in a form this server reads." };
  }
  const extra = Object.keys(input).find((key) => key !== "version" && key !== "settings");
  if (extra) {
    return { ok: false, error: `Defaults cannot hold "${extra}".` };
  }
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.settings)) {
    if (!CAMPAIGN_DEFAULT_KEYS.includes(key as CampaignDefaultKey)) {
      return { ok: false, error: `Defaults cannot hold "${key}".` };
    }
    const parsed = schemaFor(key as CampaignDefaultKey).safeParse(value);
    if (value === undefined || !parsed.success) {
      return { ok: false, error: `The saved value for "${key}" is not one a campaign accepts.` };
    }
    settings[key] = parsed.data;
  }
  return { ok: true, settings: settings as CampaignDefaultSettings };
}

// What was stored, read back as kindly as it can be: a key a later version
// renamed, or a value a later schema no longer takes, is dropped on its own
// and the rest still apply. Null when nothing usable is left.
export function readStoredDefaults(stored: unknown): CampaignDefaults | null {
  if (!isRecord(stored) || !isRecord(stored.settings)) {
    return null;
  }
  const settings: Record<string, unknown> = {};
  for (const key of CAMPAIGN_DEFAULT_KEYS) {
    if (!(key in stored.settings) || stored.settings[key] === undefined) {
      continue;
    }
    const parsed = schemaFor(key).safeParse(stored.settings[key]);
    if (parsed.success) {
      settings[key] = parsed.data;
    }
  }
  if (!Object.keys(settings).length) {
    return null;
  }
  return {
    version: CAMPAIGN_DEFAULTS_VERSION,
    savedAt: typeof stored.savedAt === "string" ? stored.savedAt : "",
    settings: settings as CampaignDefaultSettings,
  };
}
