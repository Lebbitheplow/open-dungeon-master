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
import { judgeBeatCompleted, refreshStoryArc } from "@/lib/dm/arc";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestDmMessage } from "@/lib/dm/model";
import { setDmStatus } from "@/lib/dm/status";
import { listSheets } from "@/lib/db/sheets";
import { milestoneXp } from "@/lib/srd/encounter-math";
import { XP_THRESHOLDS } from "@/lib/srd";
import { applyDmMutation } from "@/lib/dm/mutations";

// Chapter-close milestone XP: each surviving character gains a slice of the
// XP gap toward their next level.
function awardChapterMilestoneXp(campaignId: string, chapterIndex: number) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return;
  }
  const sheets = listSheets(campaignId).filter((sheet) => !sheet.deathSaves?.dead);
  if (!sheets.length) {
    return;
  }
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  // Per-character amounts differ by level, so award one call per level tier.
  const byAmount = new Map<number, string[]>();
  for (const sheet of sheets) {
    const amount = milestoneXp(sheet.level, XP_THRESHOLDS);
    if (amount > 0) {
      byAmount.set(amount, [...(byAmount.get(amount) ?? []), sheet.id]);
    }
  }
  for (const [amount, characterIds] of byAmount) {
    applyDmMutation(
      campaign,
      "",
      "award_xp",
      JSON.stringify({
        characterIds,
        amount,
        reason: `chapter ${chapterIndex} milestone`,
      }),
      sheets,
      sheetsById,
    );
  }
}

// Chapter closing: when the DM reports a finished story-arc beat (the
// complete_beat tool) past a small floor, or at a hard size cap, the open
// chapter is sealed with an AI-written title, summary, and highlights, and
// the next chapter opens. The rolling story_summary restarts at the
// boundary; closed history is owned by the chapter summaries injected into
// GAME STATE. Pacing therefore follows the story: exploration, shopping,
// and downtime can run as long as the table likes without spending a
// chapter, because none of it finishes a beat.

// Floor under the beat signal, not a target: a beat wrapped up in a few
// exchanges keeps the chapter open until there is enough to summarize.
const CHAPTER_MIN = Number(process.env.DM_CHAPTER_MIN || 8);
// A finished beat is STICKY for the chapter it happened in. Without this a
// beat completed below the floor (a beat the party wrapped up in three
// exchanges) would be thrown away as a close trigger and the chapter would
// wait for the NEXT beat, drifting the chapter index out of step with the
// story. In memory rather than a column: losing it to a restart only means
// the chapter closes on a later beat or the hard cap, never a wrong close.
declare global {
  var __odmChapterBeatPending: Map<string, boolean> | undefined;
}
const beatPending = (globalThis.__odmChapterBeatPending ??= new Map<string, boolean>());

// How many messages may pass between beat-judge checks. The judge only runs
// once a chapter is already past the floor (so it could actually close),
// which keeps it to roughly one small call every few turns.
const JUDGE_EVERY = Number(process.env.DM_BEAT_JUDGE_EVERY || 6);
declare global {
  var __odmChapterBeatJudged: Map<string, number> | undefined;
}
const lastJudged = (globalThis.__odmChapterBeatJudged ??= new Map<string, number>());

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
  signals: { beatCompleted: boolean; manual?: boolean },
) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return;
  }
  const chapter = ensureOpenChapter(campaignId);
  const messageCount = countChapterMessages(campaignId, chapter);
  if (signals.beatCompleted) {
    beatPending.set(campaignId, true);
  }
  const beatDone = beatPending.get(campaignId) ?? false;
  if (process.env.DM_DEBUG) {
    console.log(
      `[dm-debug] chapter ${chapter.index}: messages=${messageCount} beatCompleted=${signals.beatCompleted} beatPending=${beatDone} manual=${Boolean(signals.manual)} floor=${CHAPTER_MIN} cap=${CHAPTER_MAX}`,
    );
  }
  if (signals.manual) {
    if (messageCount < MANUAL_MIN) {
      return;
    }
  } else if (!shouldCloseChapter(messageCount, beatDone, { min: CHAPTER_MIN, max: CHAPTER_MAX })) {
    // The DM narrates a beat landing far more reliably than it calls
    // complete_beat, so a chapter that is long enough to close but has no
    // beat signal gets a cheap yes/no check instead of drifting to the cap.
    if (
      beatDone ||
      messageCount < CHAPTER_MIN ||
      messageCount - (lastJudged.get(campaignId) ?? 0) < JUDGE_EVERY
    ) {
      return;
    }
    lastJudged.set(campaignId, messageCount);
    if (!(await judgeBeatCompleted(campaignId))) {
      return;
    }
    beatPending.set(campaignId, true);
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

  beatPending.delete(campaignId);
  lastJudged.delete(campaignId);

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

  // Milestone XP: surviving a chapter advances everyone a little, so
  // roleplay-heavy campaigns level without the model remembering award_xp.
  // Idempotent because a chapter closes exactly once.
  awardChapterMilestoneXp(campaignId, result.closed.index);

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
