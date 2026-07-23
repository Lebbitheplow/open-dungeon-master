import { getCampaignById, getCampaignSummaryState } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { listActiveFacts } from "@/lib/db/facts";
import { getCampaignMessage } from "@/lib/db/messages";
import { getNpcByName, listNpcs } from "@/lib/db/npcs";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestDmMessage } from "@/lib/dm/model";
import { enqueueDmJob } from "@/lib/dm/queue";
import { scoreChaptersByKeywords } from "@/lib/dm/recall-logic";
import { searchScenes } from "@/lib/dm/memory-index";
import { agencyFragment } from "@/lib/dm/npc-logic";
import {
  parseLoreCheckJson,
  LORE_CATEGORY_LABELS,
  type LoreCheckCategory,
  type LoreCheckResult,
} from "@/lib/dm/lore-logic";

// The lore check: a player flags a passage of a chat message, the engine
// gathers everything the server knows that bears on it (world facts with
// their transcript anchors, semantically recalled chapters and verbatim
// scenes, the rolling summary, and for tone/character checks the NPC's
// tracked state), and one queued model call returns a verdict with
// citations and a suggested rewrite. Runs on the per-campaign DM queue so
// it never races a live narration on the single GPU.

const CHECK_SYSTEM = `You are the consistency checker for an ongoing D&D 5e campaign. A player has flagged a passage of the game transcript. Judge the flagged passage ONLY against the evidence provided; the evidence is the campaign's authoritative record. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"verdict": "consistent"|"unsupported"|"contradicts", "explanation": string, "citations": [{"kind": "fact"|"chapter"|"scene"|"summary", "ref": string, "quote": string}], "rewrite": string|null}

verdict: "consistent" when the evidence supports the passage (or at least does not conflict with it and the complaint is unfounded); "unsupported" when the evidence neither supports nor contradicts it and the passage invents something load-bearing; "contradicts" when the evidence disagrees with the passage.
explanation: 1-3 sentences naming the specific issue, or why the passage stands.
citations: the specific evidence lines you relied on. kind and ref identify the source you were given (use the ref labels exactly as provided); quote is the relevant sentence from that evidence, verbatim.
rewrite: null when consistent. Otherwise the FULL flagged passage rewritten with the smallest change that fixes the issue, preserving everything else: same voice, same length, same events except the corrected detail.`;

export type LoreCheckRequest = {
  campaignId: string;
  messageId: string;
  // The flagged excerpt (a selection, or the whole message).
  selection: string;
  category: LoreCheckCategory;
  // Optional NPC the tone/character complaint is about.
  npcName?: string;
};

async function assembleEvidence(request: LoreCheckRequest): Promise<string[]> {
  const { campaignId, selection } = request;
  const evidence: string[] = [];

  const facts = listActiveFacts(campaignId);
  const factLines = facts
    .slice(0, 40)
    .map(
      (fact) =>
        `[fact:${fact.id.slice(0, 8)}] (${fact.category}${fact.subject ? `, about ${fact.subject}` : ""}) ${fact.fact}`,
    );
  if (factLines.length) {
    evidence.push(`Server-tracked world facts:\n${factLines.join("\n")}`);
  }

  // Semantic recall against the flagged text; keyword scoring as fallback.
  let sceneLines: string[] = [];
  let chapterIndexes: number[] = [];
  try {
    const scenes = await searchScenes(campaignId, selection);
    sceneLines = scenes.map(
      (scene) => `[scene:ch${scene.chapterIndex}@${scene.seqStart}] ${scene.text}`,
    );
    chapterIndexes = [...new Set(scenes.map((scene) => scene.chapterIndex))];
  } catch {
    // embedder unavailable; chapters below still anchor the check
  }
  const closed = listChapters(campaignId).filter((chapter) => chapter.status === "closed");
  const relevantChapters = chapterIndexes.length
    ? closed.filter((chapter) => chapterIndexes.includes(chapter.index))
    : scoreChaptersByKeywords(closed, selection).slice(0, 2);
  for (const chapter of relevantChapters.slice(0, 3)) {
    evidence.push(
      `[chapter:${chapter.index}] "${chapter.title}": ${chapter.summary}${
        chapter.highlights.length ? `\nHighlights: ${chapter.highlights.join(" | ")}` : ""
      }`,
    );
  }
  if (sceneLines.length) {
    evidence.push(`Verbatim past scenes (the actual play):\n${sceneLines.join("\n\n")}`);
  }

  const { summary } = getCampaignSummaryState(campaignId);
  if (summary) {
    evidence.push(`[summary] Current chapter so far:\n${summary}`);
  }

  // Tone and characterization checks get the NPC's server-tracked state.
  if (
    (request.category === "tone_mismatch" || request.category === "out_of_character") &&
    (request.npcName || listNpcs(campaignId).length)
  ) {
    const npc = request.npcName ? getNpcByName(campaignId, request.npcName) : null;
    const roster = npc ? [npc] : listNpcs(campaignId).slice(0, 8);
    const lines = roster.map((entry) => {
      const fragment = agencyFragment(entry.agency, new Map());
      return `[fact:npc-${entry.name}] ${entry.name}: ${entry.attitude}${entry.trait ? `, ${entry.trait}` : ""}${fragment ? ` | ${fragment}` : ""}`;
    });
    if (lines.length) {
      evidence.push(`Tracked NPC states (authoritative):\n${lines.join("\n")}`);
    }
  }

  return evidence;
}

export async function runLoreCheck(
  request: LoreCheckRequest,
): Promise<LoreCheckResult | { error: string }> {
  const campaign = getCampaignById(request.campaignId);
  if (!campaign) {
    return { error: "Campaign not found." };
  }
  const message = getCampaignMessage(request.messageId);
  if (!message || message.campaignId !== request.campaignId) {
    return { error: "Message not found." };
  }
  const selection = request.selection.trim().slice(0, 2000) || message.content.slice(0, 2000);

  const evidence = await assembleEvidence({ ...request, selection });
  if (!evidence.length) {
    return { error: "Nothing recorded yet to check against." };
  }

  let result: LoreCheckResult | { error: string } = {
    error: "The checker did not answer; try again.",
  };
  // Queued behind any live narration so the single model server never
  // interleaves two jobs for this campaign.
  await enqueueDmJob(request.campaignId, async () => {
    const { message: reply, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: CHECK_SYSTEM },
        {
          role: "user",
          content: [
            `Complaint category: ${LORE_CATEGORY_LABELS[request.category]}${request.npcName ? ` (about ${request.npcName})` : ""}`,
            `Flagged passage:\n"""${selection}"""`,
            `Evidence:\n\n${evidence.join("\n\n")}`,
          ].join("\n\n"),
        },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      result = { error: "The model is unavailable; try again shortly." };
      return;
    }
    const parsed = parseLoreCheckJson(typeof reply?.content === "string" ? reply.content : "");
    result = parsed ?? { error: "The checker's reply was unusable; try again." };
  });
  return result;
}
