import {
  allocateSeq,
  getCampaignById,
  getCampaignSummaryState,
  setCampaignSummaryState,
  type Campaign,
} from "@/lib/db/campaigns";
import {
  hasRecentIdenticalEvent,
  insertCharacterEvent,
  CHARACTER_EVENT_KINDS,
  type CharacterEventKind,
} from "@/lib/db/character-events";
import { countMessages, listMessagesPage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { extractStoryText, stripReasoningArtifacts } from "@/lib/story-prompt";
import { requestDmMessage } from "@/lib/dm/model";

// Rolling-summary compaction, mirroring the solo narrator: once the log
// grows past a threshold, fold the oldest passages into the campaign summary.
const COMPACT_THRESHOLD = Number(process.env.DM_COMPACT_THRESHOLD || 120);
const COMPACT_BATCH = 40;

export async function maybeCompactHistory(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  const total = campaign ? countMessages(campaignId) : 0;
  if (!campaign || total < COMPACT_THRESHOLD) {
    return;
  }
  const { summary, coveredCount } = getCampaignSummaryState(campaignId);
  if (total - coveredCount < COMPACT_THRESHOLD) {
    return;
  }

  const batch = listMessagesPage(campaignId, coveredCount, COMPACT_BATCH);
  const transcript = batch
    .map((message) => `${message.authorType === "dm" ? "DM" : "Player"}: ${message.content}`)
    .join("\n\n");

  const { message } = await requestDmMessage(
    campaign.settings,
    [
      {
        role: "system",
        content:
          "You maintain the canonical campaign memory for an ongoing D&D 5e game. Merge the existing summary with the new passages into one updated summary. Preserve plot threads, NPCs met, promises, injuries, loot, locations, and party decisions. Compact past-tense prose, at most 500 words. Output only the summary.",
      },
      {
        role: "user",
        content: `Existing summary:\n${summary || "(none yet)"}\n\nNew passages to fold in:\n${transcript}`,
      },
    ],
    {},
  );

  const updated = extractStoryText(message?.content);
  if (updated) {
    setCampaignSummaryState(campaignId, updated.slice(0, 8_000), coveredCount + batch.length);
    await extractCharacterEvents(campaign, transcript);
  }
}

// Second pass: mine the compacted transcript for lasting per-character
// milestones the DM did not record explicitly with record_event.
async function extractCharacterEvents(campaign: Campaign, transcript: string) {
  const sheets = listSheets(campaign.id);
  if (!sheets.length) {
    return;
  }
  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      {
        role: "system",
        content:
          'Extract lasting per-character milestones from this D&D transcript as JSON only, shaped: [{"characterName": string, "kind": "achievement"|"item"|"relationship"|"death"|"level_up"|"story", "summary": string}]. Only durable developments worth remembering months later (victories, treasures, bonds, deaths, oaths). One past-tense sentence each. Empty array if none. No code fences.',
      },
      {
        role: "user",
        content: `Characters: ${sheets.map((sheet) => sheet.name).join(", ")}\n\nTranscript:\n${transcript}`,
      },
    ],
    {},
  );
  if (error) {
    return;
  }
  const raw = stripReasoningArtifacts(
    typeof message?.content === "string" ? message.content : "",
  )
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let parsed: Array<{ characterName?: unknown; kind?: unknown; summary?: unknown }>;
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) {
    return;
  }
  for (const entry of parsed.slice(0, 10)) {
    const name = String(entry.characterName ?? "").trim().toLowerCase();
    const sheet = sheets.find((candidate) => candidate.name.toLowerCase() === name);
    const kind = String(entry.kind ?? "story") as CharacterEventKind;
    const summary = String(entry.summary ?? "").trim().slice(0, 300);
    if (!sheet || !summary || !CHARACTER_EVENT_KINDS.includes(kind)) {
      continue;
    }
    if (hasRecentIdenticalEvent(sheet.id, summary)) {
      continue;
    }
    insertCharacterEvent({
      libraryCharacterId: sheet.libraryCharacterId,
      campaignCharacterId: sheet.id,
      campaignId: campaign.id,
      seq: allocateSeq(campaign.id),
      kind,
      summary,
    });
  }
}
