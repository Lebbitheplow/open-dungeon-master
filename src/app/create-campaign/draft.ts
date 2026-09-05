import type { CampaignDifficulty } from "@/lib/campaign-types";
import type { LoreDraft } from "@/app/WorldSetupFields";
import { EMPTY_SELECTION, type ImportSelection } from "@/app/workshop/ContentImportPicker";
import type { WorldPackSummary } from "@/lib/worlds/types";
import type {
  CampaignLengthSetting,
  DicePolicy,
  DmModeSetting,
  GameSettings,
  Genre,
} from "@/lib/schemas/game-settings";

// Everything the new-campaign wizard collects, as one object. The wizard is
// six screens sharing one form, so the fields live together and each step
// reads the slice it draws and patches the slice it edits. The payload that
// leaves for POST /api/campaigns is assembled in CreateCampaignDialog, not
// here, so scripts/test-create-campaign-options.mjs keeps one file to audit.
export type CampaignDraft = {
  dmMode: DmModeSetting;
  title: string;
  description: string;
  theme: string;
  maxPlayers: number;
  startingLevel: number;
  difficulty: CampaignDifficulty;
  campaignLength: CampaignLengthSetting;
  genre: Genre;
  customGenreText: string;
  worldPack: string;
  // A theme or premise the person typed is never clobbered by a later pack
  // choice; one the pack filled in is fair game to replace.
  themeTouched: boolean;
  descriptionTouched: boolean;
  aiStorySetup: boolean;
  dicePolicy: DicePolicy;
  ttsEnabled: boolean;
  ttsVoice: string;
  mapsEnabled: boolean;
  ambienceEnabled: boolean;
  // Scene-following is only meaningful once ambience is on, and is shown as
  // a second toggle beside it rather than buried.
  ambienceAuto: boolean;
  multiclassingEnabled: boolean;
  worldSimulation: boolean;
  inventoryApprovals: boolean;
  midGameJoinOpen: boolean;
  holdSubmissions: boolean;
  narrationGuard: boolean;
  relationships: GameSettings["relationships"];
  romance: GameSettings["romance"];
  variantRules: GameSettings["variantRules"];
  houseRules: string;
  loreDrafts: LoreDraft[];
  // Prep built in a workshop, brought in right after the row exists.
  contentImport: ImportSelection;
  companions: GameSettings["companions"];
  maxCompanions: number;
  maxGuests: number;
  voiceChat: GameSettings["voice"];
};

export const DEFAULT_DRAFT: CampaignDraft = {
  dmMode: "ai",
  title: "",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 1,
  difficulty: "normal",
  campaignLength: "standard",
  genre: "high_fantasy",
  customGenreText: "",
  worldPack: "",
  themeTouched: false,
  descriptionTouched: false,
  aiStorySetup: true,
  dicePolicy: "digital_only",
  ttsEnabled: true,
  ttsVoice: "af_heart",
  mapsEnabled: true,
  ambienceEnabled: true,
  ambienceAuto: true,
  multiclassingEnabled: true,
  worldSimulation: true,
  inventoryApprovals: false,
  midGameJoinOpen: false,
  holdSubmissions: false,
  narrationGuard: true,
  relationships: "on",
  romance: "on",
  variantRules: {
    flanking: false,
    criticalFumbles: false,
    encumbrance: false,
    lingeringInjuries: false,
    powerfulCritical: false,
    criticalDamageMods: false,
    ammunition: false,
    restVariant: "standard",
  },
  houseRules: "",
  loreDrafts: [],
  contentImport: EMPTY_SELECTION,
  companions: "auto",
  maxCompanions: 2,
  maxGuests: 2,
  voiceChat: {
    enabled: true,
    turnEnforcement: "soft",
    rules: {
      proximity: false,
      hearingRangeFeet: 30,
      sayRange: false,
      wallsAttenuate: false,
      downedGoDeaf: false,
    },
  },
};

export type Patch = (changes: Partial<CampaignDraft>) => void;

// What the server can do, as the wizard gates on it. null from the
// capabilities endpoint collapses to "offer everything" before it gets here.
export type WizardGates = {
  solo: boolean;
  // Everything the AI narrator brings with it. A table running its own game
  // still gets the rules engine, the maps and the dice; what it does not get
  // is a second author, so those settings are hidden rather than shown
  // switched off with no explanation.
  aiNarrates: boolean;
  storyKnownMissing: boolean;
  storyUnreachable: boolean;
  ttsAvailable: boolean;
  mapsAvailable: boolean;
};

export type StepProps = {
  draft: CampaignDraft;
  patch: Patch;
  gates: WizardGates;
};

// A pack always also sets the genre, which is what keeps every existing
// genre consumer working. The Setting row visibly follows along, which is
// the honest explanation of what a pack actually is.
export function applyPack(draft: CampaignDraft, pack: WorldPackSummary): CampaignDraft {
  return {
    ...draft,
    worldPack: pack.id,
    genre: pack.baseGenre,
    theme: draft.themeTouched ? draft.theme : pack.theme,
    description: draft.descriptionTouched ? draft.description : pack.premise,
  };
}

export function clearPack(
  draft: CampaignDraft,
  selectedPack: WorldPackSummary | null,
): CampaignDraft {
  const packTheme =
    !draft.themeTouched && selectedPack !== null && draft.theme === selectedPack.theme;
  const packPremise =
    !draft.descriptionTouched &&
    selectedPack !== null &&
    draft.description === selectedPack.premise;
  return {
    ...draft,
    worldPack: "",
    theme: packTheme ? "" : draft.theme,
    description: packPremise ? "" : draft.description,
  };
}
