import { TABLE_LANGUAGE_LABELS } from "@/lib/schemas/game-settings-options";
import type { CampaignDraft, WizardGates } from "@/app/create-campaign/draft";

// The one line under each group's name, and the review's read-back of what
// is inside the groups. Worked out from the draft only, so a closed group
// still says truthfully what it holds. Pure, for scripts/test-campaign-
// creator-flow.mjs.

const BOUNDARY_WORDS = { family: "All ages", standard: "Standard", mature: "Mature" } as const;
const STRICTNESS_WORDS = { lenient: "lenient", standard: "by the book", harsh: "harsh" } as const;
const REST_WORDS = { standard: "standard rests", gritty: "gritty rests", heroic: "heroic rests" } as const;
const HP_WORDS = { average: "average hit points", rolled: "rolled hit points", max: "maximum hit points" } as const;
const ALLY_WORDS = { auto: "automatic", full: "party members and guests", guests: "guests only", off: "off" } as const;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const onOff = (on: boolean) => (on ? "on" : "off");

export function worldSummary(draft: CampaignDraft, gates: WizardGates, packName: string | null): string {
  return [
    packName ?? "No world pack",
    TABLE_LANGUAGE_LABELS[draft.tableLanguage],
    gates.aiNarrates ? `${draft.campaignLength} length` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function characterSummary(draft: CampaignDraft): string {
  return [
    HP_WORDS[draft.hpMethod],
    draft.startingWealth === "equipment" ? "starting kit" : "rolled gold",
    draft.dicePolicy === "digital_only" ? "digital dice" : "real dice allowed",
    `multiclassing ${onOff(draft.multiclassingEnabled)}`,
  ].join(" · ");
}

export function prepSummary(draft: CampaignDraft, sourceTitle: string | null): string {
  const lore = draft.loreDrafts.filter((entry) => entry.title.trim()).length;
  const importing = Boolean(draft.contentImport.sourceId && draft.contentImport.select.length);
  return [
    draft.houseRules.trim() ? "house rules written" : "no house rules",
    lore ? count(lore, "lore entry", "lore entries") : "no lore yet",
    importing ? `prep from ${sourceTitle ?? "a workshop"}` : "no prep brought in",
  ].join(" · ");
}

export function narrationSummary(draft: CampaignDraft, gates: WizardGates, voiceName: string): string {
  if (!gates.ttsAvailable) {
    return "Not read aloud: this server has no speech service";
  }
  if (!draft.ttsEnabled) {
    return "Off: nothing is read aloud";
  }
  return `${voiceName} at ${draft.ttsSpeed.toFixed(2)}× · ${
    draft.ttsAutoCast ? "each speaker gets a voice" : "the narrator reads the characters"
  }`;
}

export function safetySummary(draft: Pick<CampaignDraft, "safety" | "gm">): string {
  const { safety, gm } = draft;
  const lists = [
    safety.lines.length ? count(safety.lines.length, "line") : null,
    safety.veils.length ? count(safety.veils.length, "veil") : null,
  ].filter(Boolean);
  return [
    BOUNDARY_WORDS[safety.boundaries],
    `X-card ${onOff(safety.xCard)}`,
    lists.length ? lists.join(", ") : "no lines or veils",
    STRICTNESS_WORDS[gm.strictness],
    gm.tone.length ? gm.tone.join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function aiSummary(draft: CampaignDraft): string {
  return [
    `story setup ${onOff(draft.aiStorySetup)}`,
    `outcome check ${onOff(draft.narrationGuard)}`,
    `living world ${onOff(draft.worldSimulation)}`,
    `allies: ${ALLY_WORDS[draft.companions]}`,
  ].join(" · ");
}

export function bondsSummary(draft: Pick<CampaignDraft, "relationships" | "romance">): string {
  if (draft.relationships === "off") {
    return "Bonds off";
  }
  return draft.romance === "off" ? "Bonds on, romance off" : "Bonds and romance on";
}

export function playersSummary(draft: CampaignDraft, gates: WizardGates): string {
  return [
    draft.multiCharacter === "off" ? "one character each" : draft.multiCharacter === "one_active" ? "several characters, one at a time" : "several characters, all fielded",
    gates.solo ? null : `joining mid-game ${draft.midGameJoinOpen ? "open" : "closed"}`,
    gates.solo ? null : draft.holdSubmissions ? "held responses" : null,
    draft.inventoryApprovals || draft.vitalsApprovals ? "players confirm changes" : "changes apply at once",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function boardSummary(draft: Pick<CampaignDraft, "boardDrawing" | "enemyIntent">): string {
  return `Drawing ${onOff(draft.boardDrawing)} · enemy intent ${draft.enemyIntent ? "shown" : "hidden"}`;
}

export function variantSummary(draft: Pick<CampaignDraft, "variantRules">): string {
  const { restVariant, ...toggles } = draft.variantRules;
  const on = Object.values(toggles).filter(Boolean).length;
  return `${on ? `${on} on` : "None on"} · ${REST_WORDS[restVariant]}`;
}

export function voiceChatSummary(draft: Pick<CampaignDraft, "voiceChat">): string {
  return voiceSummary(draft.voiceChat);
}

// The live table's settings call it `voice`; the creator's draft `voiceChat`.
export function voiceSummary(voice: CampaignDraft["voiceChat"]): string {
  if (!voice.enabled) {
    return "Off";
  }
  const turns = { off: "turns ignored", soft: "turns shown", strict: "turns enforced" }[voice.turnEnforcement];
  return ["On", turns, voice.rules.proximity ? `proximity, ${voice.rules.hearingRangeFeet} ft` : null].filter(Boolean).join(" · ");
}

// Whether the table has rules beyond the book: any variant rule, a rest
// variant, or house rules typed here.
export function customRules(draft: CampaignDraft): string | null {
  const { restVariant, ...toggles } = draft.variantRules;
  const on = Object.values(toggles).filter(Boolean).length;
  const parts = [
    on ? count(on, "variant rule") : null,
    restVariant !== "standard" ? REST_WORDS[restVariant] : null,
    draft.houseRules.trim() ? "house rules" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
