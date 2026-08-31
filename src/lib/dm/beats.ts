import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertDmBeat, type DmBeat } from "@/lib/db/dm-beats";
import { getLatestDmMessage, insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { listRecentRolls } from "@/lib/db/rolls";
import { listRecentAudit } from "@/lib/db/sheet-audit";
import { listSheets } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { trackUtilityCall } from "@/lib/dm/call-tracker";
import { maybeCloseChapter } from "@/lib/dm/chapter-close";
import { maybeCompactHistory } from "@/lib/dm/compaction";
import { requestUtilityMessage } from "@/lib/dm/model";
import { enqueueDmJob } from "@/lib/dm/queue";
import {
  beatSourceText,
  hasBeatSource,
  normalizeBeatBody,
  type BeatKind,
  type BeatSource,
  type BeatSourceLine,
} from "@/lib/dm/beat-logic";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

// Story capture for a human DM: writing down what was said out loud, and
// drafting it from the mechanical record when the DM would rather edit than
// compose.
//
// The important design decision is that a beat is published as an ordinary DM
// message. Chapters, compaction, scene-chunk embedding, retrieval, recap, the
// export and Ask all read campaign_messages and none of them needs to learn
// what a beat is. dm_beats carries only the provenance the transcript cannot.

export function recordBeat(
  campaign: Campaign,
  authorUserId: string,
  input: { body: string; kind: BeatKind; source: BeatSource },
): { beat: DmBeat; messageId: string } {
  const body = normalizeBeatBody(input.body);
  const seq = allocateSeq(campaign.id);
  // author_type 'dm' with user_id set, exactly like typed narration: a beat
  // IS story text, and the transcript should read as one voice.
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "dm",
    userId: authorUserId,
    content: body,
  });
  // The `beat` flag rides on the event rather than the row. A narration is
  // the DM answering the party, and the client clears the console's "waiting
  // on you" queue when one arrives; a beat is a record of play that already
  // happened, and must not tick off actions nobody has resolved yet.
  publishWithSeq(campaign.id, seq, "message_added", { message, beat: true });

  const beat = insertDmBeat({
    campaignId: campaign.id,
    seq,
    messageId: message.id,
    authorUserId,
    kind: input.kind,
    source: input.source,
    body,
  });
  publishPersisted(campaign.id, "beat_recorded", { beat });

  // A beat is the DM saying a piece of story finished, which is exactly the
  // signal the chapter engine spends a model call guessing at when the AI
  // runs the game (chapter-close.ts judgeBeatCompleted). Take them at their
  // word. Upkeep runs on the campaign queue so the DM never waits on it.
  enqueueDmJob(campaign.id, async () => {
    await maybeCloseChapter(campaign.id, { beatCompleted: true });
    await maybeCompactHistory(campaign.id);
  });

  return { beat, messageId: message.id };
}

// Where the current uncaptured stretch begins: the last time story text of
// any kind reached the transcript. Mirrors lastStoryCaptureAt in
// beat-cadence.ts, which is how the client decides to nudge, so the banner and
// the draft are always talking about the same stretch of play.
export function storyCutoffAt(campaignId: string): string {
  return getLatestDmMessage(campaignId)?.createdAt ?? "";
}

const DRAFT_SYSTEM =
  "You are the scribe for a tabletop D&D session. The Dungeon Master ran the last stretch of play out loud, so only the mechanical record was typed: what the players said, what the dice did, and what changed on the sheets. Write that stretch up as 2 to 4 past-tense sentences the table would recognise: who did what, what they found out, what changed. Use only what the record supports. Never invent a name, a place, a motive or an outcome that is not in it. Output only the summary, with no heading and no quotes.";

// Everything typed during the uncaptured stretch, as lines a model can read.
// Rolls and sheet changes are in here because they are often the ONLY record
// of a fight the DM narrated aloud.
export function beatSourceLines(campaignId: string, since: string): BeatSourceLine[] {
  const names = new Map(listSheets(campaignId).map((sheet) => [sheet.id, sheet.name]));
  const lines: BeatSourceLine[] = [];

  for (const message of listRecentMessages(campaignId, 80)) {
    if (message.createdAt <= since || message.authorType === "system") {
      continue;
    }
    const who =
      message.authorType === "dm"
        ? "DM"
        : (message.characterId && names.get(message.characterId)) || "A player";
    lines.push({ at: message.createdAt, text: `${who}: ${message.content}` });
  }

  for (const roll of listRecentRolls(campaignId, 40)) {
    if (roll.createdAt <= since) {
      continue;
    }
    const who = (roll.characterId && names.get(roll.characterId)) || "Someone";
    const against = roll.dc === null ? "" : ` against DC ${roll.dc}`;
    const outcome = roll.success === null ? "" : roll.success ? ", and made it" : ", and missed it";
    lines.push({
      at: roll.createdAt,
      text: `Roll: ${who} rolled ${roll.detail || roll.kind} for ${roll.total}${against}${outcome}.`,
    });
  }

  for (const entry of listRecentAudit(campaignId, 40)) {
    if (entry.createdAt <= since) {
      continue;
    }
    const who = names.get(entry.characterId) || "Someone";
    lines.push({
      at: entry.createdAt,
      text: `Change: ${who}, ${entry.kind}${entry.reason ? ` (${entry.reason})` : ""}.`,
    });
  }

  return lines;
}

// The only model call a pure human-DM campaign ever makes, and it is opt-in:
// the DM presses a button, reads what comes back, and edits it before any of
// it reaches the table. Nothing here writes to the campaign.
export async function draftBeat(
  campaign: Campaign,
): Promise<{ draft: string; error?: string }> {
  const since = storyCutoffAt(campaign.id);
  const lines = beatSourceLines(campaign.id, since);
  if (!hasBeatSource(lines)) {
    return {
      draft: "",
      error: "Nothing has happened since the last time story reached the log.",
    };
  }

  const { message, error } = await trackUtilityCall(campaign.id, "beat", () =>
    requestUtilityMessage(
      campaign.settings,
      [
        { role: "system", content: DRAFT_SYSTEM },
        { role: "user", content: `The record of play:\n${beatSourceText(lines)}` },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    ),
  );
  if (error) {
    return { draft: "", error: "The model could not be reached." };
  }
  const draft = normalizeBeatBody(
    stripReasoningArtifacts(String(message?.content ?? "")),
  );
  if (!draft) {
    return { draft: "", error: "The model returned nothing usable." };
  }
  return { draft };
}
