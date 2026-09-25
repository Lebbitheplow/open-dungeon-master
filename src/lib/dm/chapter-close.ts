import { publishTitleCard } from "@/lib/dm/scene-state";
import { listTranscriptSince } from "@/lib/db/voice-transcript";
import { renderTranscript } from "@/lib/voice/transcript";
import { describeInstant } from "@/lib/dm/calendar";
import { listFactions } from "@/lib/db/factions";
import { advanceFactionGoals } from "@/lib/dm/faction-logic";
import { shiftFactionPower } from "@/lib/dm/faction-tools";
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
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import {
  beatCountsToward,
  parseChapterJson,
  shouldCloseChapter,
  shouldJudgeBeat,
} from "@/lib/dm/chapter-logic";
import { recordExtractedFacts } from "@/lib/db/facts";
import { listNpcs } from "@/lib/db/npcs";
import { detectWitnesses } from "@/lib/dm/witness-logic";
import type { FactCandidate } from "@/lib/dm/fact-logic";
import { advanceNpcAgency } from "@/lib/dm/npc-agency";
import { advanceRelationships } from "@/lib/dm/relationship-tick";
import { captureBoundarySnapshot } from "@/lib/db/snapshots";
import { indexChapter } from "@/lib/dm/memory-index";
import { arcExhausted } from "@/lib/dm/arc-logic";
import { judgeBeatCompleted, planExhaustedArc, refreshStoryArc } from "@/lib/dm/arc";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestUtilityMessage } from "@/lib/dm/model";
import { trackUtilityCall } from "@/lib/dm/call-tracker";
import { isStageEnabled } from "@/lib/dm/stages";
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
// Sixteen messages is eight exchanges, the least that reads as a chapter
// with a title card and three to six highlights; the old floor of eight
// let a chapter close on a single arrival scene (issue #31).
const CHAPTER_MIN = Number(process.env.DM_CHAPTER_MIN || 16);
// Completed beats required before a chapter may close (below the cap). Two
// by default, so a chapter reads as a real episode of the saga rather than
// one scene, and the campaign-spanning arc stretches across many chapters.
const CHAPTER_BEATS = Math.max(1, Number(process.env.DM_CHAPTER_BEATS || 2));
// Messages that must separate two beats for both to count toward the
// chapter (chapter-logic.ts beatCountsToward). Adjacent arc beats often
// share a place or a person, so without this the party's arrival somewhere
// landed two beats in two replies and the chapter closed on the spot.
const BEAT_SPACING = Math.max(0, Number(process.env.DM_BEAT_SPACING || 8));
// How many messages may pass between beat-judge checks. The judge only runs
// once a chapter is already past the floor (so it could actually close),
// which keeps it to roughly one small call every few turns.
const JUDGE_EVERY = Number(process.env.DM_BEAT_JUDGE_EVERY || 6);

// Per-campaign pacing memory for the open chapter. Finished beats are
// STICKY counts for the chapter they happened in: without this a beat
// completed below the floor (a beat the party wrapped up in three
// exchanges) would be thrown away as a close trigger and the chapter would
// wait for the NEXT beat, drifting the chapter index out of step with the
// story. lastBeatSeq is where the arc last advanced (tool or judge), so the
// spacing rule and the judge's reading window both start after it. In
// memory rather than columns: losing it to a restart only means the chapter
// closes on a later beat or the hard cap, never a wrong close.
type ChapterPacing = { beats: number; lastBeatSeq: number | null; lastJudgedAt: number };
declare global {
  var __odmChapterPacing: Map<string, ChapterPacing> | undefined;
}
const pacingByCampaign = (globalThis.__odmChapterPacing ??= new Map<string, ChapterPacing>());
function pacingFor(campaignId: string): ChapterPacing {
  let pacing = pacingByCampaign.get(campaignId);
  if (!pacing) {
    pacing = { beats: 0, lastBeatSeq: null, lastJudgedAt: 0 };
    pacingByCampaign.set(campaignId, pacing);
  }
  return pacing;
}

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
  // A transcribed table (docs/vtt-parity-implementation-plan.md 13.3) adds
  // what was said aloud since the chapter's first line, so a chapter the DM
  // narrated out loud still closes with a summary of what happened.
  const openedAt = messages[0]?.createdAt ?? "";
  const spoken = openedAt ? renderTranscript(listTranscriptSince(campaignId, openedAt, 400), 12_000) : "";
  let transcript = lines.join("\n\n") + (spoken ? `\n\nSaid aloud at the table:\n${spoken}` : "");
  if (transcript.length > TRANSCRIPT_CHAR_BUDGET) {
    transcript = transcript.slice(-TRANSCRIPT_CHAR_BUDGET);
  }
  return transcript;
}

function countChapterMessages(campaignId: string, chapter: Chapter): number {
  return countPlayMessages(campaignId, chapter.seqStart);
}

// Non-system messages from seqFrom to the latest, inclusive.
function countPlayMessages(campaignId: string, seqFrom: number): number {
  return listMessagesInSeqRange(campaignId, seqFrom, latestSeq(campaignId)).filter(
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
  const pacing = pacingFor(campaignId);
  // Play since the arc last advanced in this chapter; null before the
  // first beat (or after a restart, which only widens the window).
  const sinceLastBeat = (): number | null =>
    pacing.lastBeatSeq === null ? null : countPlayMessages(campaignId, pacing.lastBeatSeq + 1);
  // A beat landing (tool or judge) restarts the spacing window and, when
  // it is far enough from the previous one, counts toward the chapter.
  const recordBeat = () => {
    if (beatCountsToward(sinceLastBeat(), BEAT_SPACING)) {
      pacing.beats += 1;
    }
    pacing.lastBeatSeq = latestSeq(campaignId);
    pacing.lastJudgedAt = messageCount;
  };
  if (signals.beatCompleted) {
    recordBeat();
  }
  const exhausted = campaign.storyArc ? arcExhausted(campaign.storyArc) : false;
  const limits = { min: CHAPTER_MIN, max: CHAPTER_MAX, beatsRequired: CHAPTER_BEATS };
  if (process.env.DM_DEBUG) {
    console.log(
      `[dm-debug] chapter ${chapter.index}: messages=${messageCount} beatCompleted=${signals.beatCompleted} beatsDone=${pacing.beats}/${CHAPTER_BEATS} sinceBeat=${sinceLastBeat() ?? "-"} exhausted=${exhausted} manual=${Boolean(signals.manual)} floor=${CHAPTER_MIN} cap=${CHAPTER_MAX}`,
    );
  }
  if (signals.manual) {
    if (messageCount < MANUAL_MIN) {
      return;
    }
  } else if (!shouldCloseChapter(messageCount, pacing.beats, exhausted, limits)) {
    if (exhausted && pacing.beats === 0) {
      // The chapter opened on an exhausted arc: the next act was not
      // planned at the last close (model timeout, bad JSON). Plan it here,
      // on the queue, instead of closing a stub chapter per attempt; the
      // judge cadence throttles the retries.
      if (messageCount - pacing.lastJudgedAt >= JUDGE_EVERY) {
        pacing.lastJudgedAt = messageCount;
        await planExhaustedArc(campaignId);
      }
      return;
    }
    // The DM narrates a beat landing far more reliably than it calls
    // complete_beat, so a chapter that is long enough to close but is still
    // short on beat signals gets a cheap yes/no check instead of drifting
    // to the cap.
    if (
      !shouldJudgeBeat({
        messageCount,
        beatsDone: pacing.beats,
        beatCompletedThisTurn: signals.beatCompleted,
        messagesSinceLastBeat: sinceLastBeat(),
        messagesSinceLastJudge: messageCount - pacing.lastJudgedAt,
        options: { ...limits, judgeEvery: JUDGE_EVERY, spacing: BEAT_SPACING },
      })
    ) {
      return;
    }
    pacing.lastJudgedAt = messageCount;
    // The judge reads only this chapter's play after the last beat, so the
    // scene that landed the previous beat can never be credited twice.
    const judgeFrom = Math.max(chapter.seqStart, (pacing.lastBeatSeq ?? 0) + 1);
    if (!(await judgeBeatCompleted(campaignId, judgeFrom))) {
      return;
    }
    recordBeat();
    // The judge advanced the arc, so recompute exhaustion before deciding.
    const refreshed = getCampaignById(campaignId);
    const nowExhausted = refreshed?.storyArc ? arcExhausted(refreshed.storyArc) : false;
    if (!shouldCloseChapter(messageCount, pacing.beats, nowExhausted, limits)) {
      return;
    }
  }

  const seqEnd = latestSeq(campaignId);
  const transcript = chapterTranscript(campaignId, chapter, seqEnd);
  const previous = previousChapterLines(campaignId, chapter.index);
  setDmStatus(campaignId, "writing_chapter");

  let parsed = {
    title: `Chapter ${chapter.index}`,
    summary: "",
    highlights: [] as string[],
    facts: [] as FactCandidate[],
  };
  try {
    // Skipped when the table turned chapter summaries off; the chapter still
    // closes, it just carries no summary (src/lib/dm/stages.ts).
    const { message, error } = !isStageEnabled(campaign.gameSettings.stages, "chapterSummary")
      ? { message: null, error: "chapter summaries disabled" }
      : await trackUtilityCall(campaign.id, "chapter", () =>
          requestUtilityMessage(
            campaign.settings,
            [
              {
                role: "system",
                content:
                  'You are closing a chapter of an ongoing D&D 5e campaign. Return STRICT JSON only, no code fences, shaped: {"title": string, "summary": string, "highlights": string[], "facts": [{"category": "location"|"npc"|"promise"|"world"|"party"|"lore", "subject": string, "fact": string}]}. title: evocative, at most 60 characters, no surrounding quotes. summary: past tense, at most 250 words, preserving plot threads, NPCs, promises, loot, and decisions. highlights: 3 to 6 one-sentence standout moments. facts: up to 8 durable world-state facts this chapter established (who is where, who holds what, alliances, deaths, promises, debts); subject names who or what each fact is about; fact is one past-tense sentence under 300 characters; empty array if nothing durable changed.',
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
          ),
        );
    if (!error) {
      parsed = parseChapterJson(String(message?.content ?? ""), chapter.index);
    }
  } catch {
    // Model unavailable; close with the fallback title so the campaign
    // never wedges on a chapter boundary.
  }

  const result = closeChapterRow(chapter.id, {
    title: parsed.title,
    summary: parsed.summary,
    highlights: parsed.highlights,
    seqEnd,
    clockLabel: describeInstant(campaign.clock.calendar, campaign.clock.instant),
  });
  if (!result) {
    setDmStatus(campaignId, "idle");
    return;
  }

  // Fold the chapter's durable facts into the world-state sheet (deduped;
  // same-subject facts supersede what was on file). Never blocks a close.
  if (parsed.facts.length) {
    try {
      // Stamp who was on screen during the chapter, so an NPC can later be
      // held to what they could plausibly have witnessed. Chapter-level
      // rather than per-fact: the extraction gives no per-fact provenance,
      // and over-crediting a witness is the safe direction to err (the
      // prompt treats witness data as evidence of knowledge, never as proof
      // of ignorance).
      const witnessedBy = detectWitnesses(
        transcript,
        listNpcs(campaignId).map((npc) => ({ name: npc.name, aliases: npc.aliases })),
      );
      const inserted = recordExtractedFacts(campaignId, parsed.facts, "chapter", {
        sourceSeq: seqEnd,
        witnessedBy,
      });
      if (inserted.length) {
        publishEphemeral(campaignId, "facts_updated", {});
      }
    } catch (error) {
      console.error("[facts] chapter extraction failed", error);
    }
  }

  pacingByCampaign.delete(campaignId);

  // The rolling summary now only covers the new open chapter.
  setCampaignSummaryState(campaignId, "", countMessagesUpToSeq(campaignId, seqEnd));

  publishPersisted(campaignId, "chapter_closed", {
    chapter: result.closed,
    opened: result.opened,
  });
  // The new chapter's card on every screen (SceneTitle.tsx).
  publishTitleCard(campaignId, {
    title: result.opened.title || `Chapter ${result.opened.index}`,
    subtitle: result.opened.title ? `Chapter ${result.opened.index}` : undefined,
    tone: "gold",
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

  // NPC lives move on between chapters: pressure counters, background goal
  // dice, and goal collisions, all deterministic. Never blocks a close.
  try {
    advanceNpcAgency(campaignId, transcript);
  } catch (error) {
    console.error("[npc-agency] chapter pass failed", error);
  }
  // Factions move between chapters the way people do (docs/vtt-parity-
  // implementation-plan.md section 6): goal dice, power drift, a fact.
  try {
    for (const moved of advanceFactionGoals(listFactions(campaignId))) {
      shiftFactionPower(campaignId, moved.faction.id, moved.power, moved.fact);
    }
  } catch (error) {
    console.error("[factions] chapter pass failed", error);
  }

  // Relationships move with the chapter too: repeated-beat fatigue forgives
  // itself, and someone the party has not seen for chapters pulls at the
  // story.
  try {
    advanceRelationships(campaignId, transcript);
  } catch (error) {
    console.error("[relationships] chapter pass failed", error);
  }

  // Freeze the settled world as the new chapter's rewind point, after every
  // close-time cascade (facts, XP, arc, NPC agency, relationships) has landed.
  // Never blocks a close.
  try {
    captureBoundarySnapshot(campaignId, result.opened.index, seqEnd);
  } catch (error) {
    console.error("[rollback] boundary snapshot failed", error);
  }

  // Fire-and-forget semantic indexing of the sealed chapter (CPU-only, so
  // it can run alongside GPU turns without contention).
  void indexChapter(campaignId, result.closed.id);
}

// Chapter rewind (src/lib/dm/rollback.ts) clears the in-memory pacing
// record; stale counts would close the reopened chapter on beats from the
// timeline that no longer happened.
export function resetChapterMemory(campaignId: string) {
  pacingByCampaign.delete(campaignId);
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
