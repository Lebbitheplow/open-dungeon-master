import type { CampaignDefaultSettings } from "@/lib/campaign-defaults";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { DEFAULT_DRAFT, type CampaignDraft } from "@/app/create-campaign/draft";
import { presetTheme } from "@/app/create-campaign/portals";

// The new-campaign draft and a person's saved defaults
// (src/lib/campaign-defaults.ts), converted both ways. Pure, so
// scripts/test-campaign-defaults.mjs can hold the rules:
//
// - What one campaign owns is never saved and never overwritten: its title,
//   premise, theme, world pack, lore and imported prep.
// - The editor's own bookkeeping (what was typed, which warning was seen) is
//   never saved.
// - false, 0, an empty list and null are choices, and survive both ways.
// - Nested settings are copied, never shared, so editing the draft cannot
//   reach back into the saved setup or into DEFAULT_DRAFT.

// The draft's settings a default carries, with the gameSettings name each
// one is saved under where the two differ.
const DRAFT_KEYS = [
  "dmMode",
  "genre",
  "customGenreText",
  "tableLanguage",
  "maxPlayers",
  "startingLevel",
  "difficulty",
  "campaignLength",
  "aiStorySetup",
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
  "houseRules",
] as const satisfies ReadonlyArray<keyof CampaignDraft>;

const clone = <T>(value: T): T => (typeof value === "object" && value !== null ? structuredClone(value) : value);

export function defaultsFromDraft(draft: CampaignDraft): CampaignDefaultSettings {
  const settings: Record<string, unknown> = {};
  for (const key of DRAFT_KEYS) {
    settings[key] = clone(draft[key]);
  }
  settings.voice = clone(draft.voiceChat);
  // Trimmed the way the campaign itself would be.
  settings.customGenreText = draft.customGenreText.trim();
  return settings as CampaignDefaultSettings;
}

export type AppliedDefaults = {
  draft: CampaignDraft;
  // What was left alone and why, for the line under the defaults bar.
  kept: string[];
};

// The draft with a saved setup laid over it. The campaign's own fields stay
// as they are. A world pack the person already chose stays too: a pack is its
// own setting, so a saved genre is not blended over it, and the note says so.
// An untouched theme follows the genre the way picking it by hand would.
export function applyDefaults(
  draft: CampaignDraft,
  settings: CampaignDefaultSettings,
  selectedPack: WorldPackSummary | null,
): AppliedDefaults {
  const next: Record<string, unknown> = { ...draft };
  const kept: string[] = [];
  for (const key of DRAFT_KEYS) {
    if (!(key in settings)) {
      continue;
    }
    const value = (settings as Record<string, unknown>)[key];
    if (key === "genre" && draft.worldPack && value !== draft.genre) {
      kept.push(selectedPack ? `${selectedPack.name} keeps its own setting` : "the world pack keeps its own setting");
      continue;
    }
    next[key] = clone(value);
  }
  if (settings.voice) {
    // Transcription is switched on in the lobby, where the table is told it
    // is on; a saved setup never turns it on behind anyone's back.
    next.voiceChat = { ...clone(settings.voice), transcribe: draft.voiceChat.transcribe };
  }
  // The warning about AI story setup and an imported Storyboard is asked
  // again whenever the setting it was answered for changes.
  if (next.aiStorySetup !== draft.aiStorySetup) {
    next.storySetupKept = false;
  }
  return { draft: presetTheme(next as CampaignDraft), kept };
}

// The app's own starting table, for "use app defaults": every saved setting
// back to DEFAULT_DRAFT's, the campaign's own fields untouched.
export function appDefaultSettings(): CampaignDefaultSettings {
  return defaultsFromDraft(DEFAULT_DRAFT);
}
