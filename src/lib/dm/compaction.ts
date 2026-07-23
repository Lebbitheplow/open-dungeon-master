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
import { recordExtractedFacts } from "@/lib/db/facts";
import { listSheets } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { extractStoryText, stripReasoningArtifacts } from "@/lib/story-prompt";
import { normalizeCandidate, type FactCandidate } from "@/lib/dm/fact-logic";
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
// milestones the DM did not record explicitly with record_event, plus
// durable world-state facts. This is the fallback fact extractor for the
// stretch before a campaign's first chapter closes (chapter close is the
// primary heartbeat and usually fires well before the compaction threshold).
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
          'Extract durable memory from this D&D transcript as JSON only, shaped: {"events": [{"characterName": string, "kind": "achievement"|"item"|"relationship"|"death"|"level_up"|"story", "summary": string}], "facts": [{"category": "location"|"npc"|"promise"|"world"|"party"|"lore", "subject": string, "fact": string}]}. events: lasting per-character milestones worth remembering months later (victories, treasures, bonds, deaths, oaths), one past-tense sentence each. facts: up to 6 world-state facts the passages established (who is where, who holds what, alliances, deaths, promises, debts); subject names who or what each fact is about. Empty arrays if none. No code fences.',
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
  // Accept both the object shape and the legacy bare events array a model
  // trained on the old prompt might still emit.
  let parsed: Array<{ characterName?: unknown; kind?: unknown; summary?: unknown }>;
  let factEntries: Array<Record<string, unknown>> = [];
  try {
    const objStart = raw.indexOf("{");
    const arrStart = raw.indexOf("[");
    if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
      const end = raw.lastIndexOf("}");
      const wrapper = JSON.parse(raw.slice(objStart, end + 1)) as {
        events?: unknown;
        facts?: unknown;
      };
      parsed = Array.isArray(wrapper.events) ? wrapper.events : [];
      factEntries = Array.isArray(wrapper.facts)
        ? (wrapper.facts as Array<Record<string, unknown>>)
        : [];
    } else {
      const end = raw.lastIndexOf("]");
      parsed = JSON.parse(raw.slice(arrStart, end + 1));
    }
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) {
    return;
  }
  const candidates = factEntries
    .slice(0, 6)
    .map((entry) => normalizeCandidate(entry ?? {}))
    .filter((entry): entry is FactCandidate => entry !== null);
  if (candidates.length) {
    try {
      const inserted = recordExtractedFacts(campaign.id, candidates, "compaction");
      if (inserted.length) {
        publishEphemeral(campaign.id, "facts_updated", {});
      }
    } catch (factError) {
      console.error("[facts] compaction extraction failed", factError);
    }
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
