import { getCampaignById, latestSeq, setCampaignSummaryState, allocateSeq } from "@/lib/db/campaigns";
import {
  closeChapterRow,
  ensureOpenChapter,
  listChapters,
  type Chapter,
} from "@/lib/db/chapters";
import {
  countMessagesUpToSeq,
  insertCampaignMessage,
  listMessagesInSeqRange,
} from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { parseChapterJson, shouldCloseChapter } from "@/lib/dm/chapter-logic";
import { refreshStoryArc } from "@/lib/dm/arc";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestDmMessage } from "@/lib/dm/model";
import { setDmStatus } from "@/lib/dm/status";

// Chapter closing: at a natural scene break (the party moved somewhere new)
// or a hard size cap, the open chapter is sealed with an AI-written title,
// summary, and highlights, and the next chapter opens. The rolling
// story_summary restarts at the boundary; closed history is owned by the
// chapter summaries injected into GAME STATE.

const CHAPTER_MIN = Number(process.env.DM_CHAPTER_MIN || 25);
const CHAPTER_MAX = Number(process.env.DM_CHAPTER_MAX || 80);
const MANUAL_MIN = 5;
const TRANSCRIPT_CHAR_BUDGET = 24_000;

function chapterTranscript(campaignId: string, chapter: Chapter, seqEnd: number): string {
  const messages = listMessagesInSeqRange(campaignId, chapter.seqStart, seqEnd).filter(
    (message) => message.authorType !== "system",
  );
  const lines = messages.map(
    (message) => `${message.authorType === "dm" ? "DM" : "Player"}: ${message.content}`,
  );
  let transcript = lines.join("\n\n");
  if (transcript.length > TRANSCRIPT_CHAR_BUDGET) {
    transcript = transcript.slice(-TRANSCRIPT_CHAR_BUDGET);
  }
  return transcript;
}

function countChapterMessages(campaignId: string, chapter: Chapter): number {
  return listMessagesInSeqRange(campaignId, chapter.seqStart, latestSeq(campaignId)).filter(
    (message) => message.authorType !== "system",
  ).length;
}

// Runs after a DM turn (already serialized on the DM queue). `manual` is
// the party lead's explicit close, which skips the automatic thresholds.
export async function maybeCloseChapter(
  campaignId: string,
  signals: { movedParty: boolean; manual?: boolean },
) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return;
  }
  const chapter = ensureOpenChapter(campaignId);
  const messageCount = countChapterMessages(campaignId, chapter);
  if (signals.manual) {
    if (messageCount < MANUAL_MIN) {
      return;
    }
  } else if (
    !shouldCloseChapter(messageCount, signals.movedParty, { min: CHAPTER_MIN, max: CHAPTER_MAX })
  ) {
    return;
  }

  const seqEnd = latestSeq(campaignId);
  const transcript = chapterTranscript(campaignId, chapter, seqEnd);
  const previous = previousChapterLines(campaignId, chapter.index);
  setDmStatus(campaignId, "writing_chapter");

  let parsed = { title: `Chapter ${chapter.index}`, summary: "", highlights: [] as string[] };
  try {
    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        {
          role: "system",
          content:
            'You are closing a chapter of an ongoing D&D 5e campaign. Return STRICT JSON only, no code fences, shaped: {"title": string, "summary": string, "highlights": string[]}. title: evocative, at most 60 characters, no surrounding quotes. summary: past tense, at most 250 words, preserving plot threads, NPCs, promises, loot, and decisions. highlights: 3 to 6 one-sentence standout moments.',
        },
        {
          role: "user",
          content: [
            previous ? `Previous chapters for continuity:\n${previous}` : "",
            `Transcript of the closing chapter:\n${transcript || "(quiet chapter with no recorded scenes)"}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    );
    if (!error) {
      parsed = parseChapterJson(String(message?.content ?? ""), chapter.index);
    }
  } catch {
    // Model unavailable; close with the fallback title so the campaign
    // never wedges on a chapter boundary.
  }

  const result = closeChapterRow(chapter.id, { ...parsed, seqEnd });
  if (!result) {
    setDmStatus(campaignId, "idle");
    return;
  }

  // The rolling summary now only covers the new open chapter.
  setCampaignSummaryState(campaignId, "", countMessagesUpToSeq(campaignId, seqEnd));

  publishPersisted(campaignId, "chapter_closed", {
    chapter: result.closed,
    opened: result.opened,
  });
  const seq = allocateSeq(campaignId);
  const divider = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `Chapter ${result.closed.index}${result.closed.title ? `, "${result.closed.title}",` : ""} comes to a close.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message: divider });

  // Chapter boundaries are the arc's heartbeat: mark beats the chapter
  // accomplished, settle or open sub-arcs. Never throws (arc.ts swallows).
  await refreshStoryArc(campaignId, result.closed);
}

function previousChapterLines(campaignId: string, beforeIndex: number): string {
  return listChapters(campaignId)
    .filter((chapter) => chapter.status === "closed" && chapter.index < beforeIndex)
    .slice(-8)
    .map(
      (chapter) =>
        `${chapter.index}. "${chapter.title}"${chapter.highlights[0] ? ` - ${chapter.highlights[0]}` : ""}`,
    )
    .join("\n");
}
