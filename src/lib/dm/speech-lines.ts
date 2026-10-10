// Who speaks each quoted line of a DM message, decided when the message is
// written and stored with it (src/lib/dm/speech.ts SpokenLine). Text a person
// wrote is read from its structure, with English pronouns at an English
// table; text a model wrote is read by the claims reader first
// (src/lib/dm/claims.ts), in any language, and from its structure for the
// lines the reader leaves out. Every read here happens outside any
// transaction.

import type { Campaign } from "@/lib/db/campaigns";
import { listRecentMessages } from "@/lib/db/messages";
import { getNpcByName } from "@/lib/db/npcs";
import { listSheets } from "@/lib/db/sheets";
import { guardOutcomes } from "@/lib/dm/engine-boundary";
import { liveStateFor, readClaims, speakerRoster } from "@/lib/dm/claims";
import { commonWords, foldName } from "@/lib/language/text-logic";
import { attributeSpeech, hasQuotedLine, linesOf, mergeLines, storedSpeaker, type Speaker, type SpokenLine } from "@/lib/dm/speech";

// How many of the latest messages commonWords reads: a fixed window, so its
// cost never grows with the campaign.
const COMMON_WORDS_MESSAGES = 80;

// Person-written text: the human DM's narration, a beat, an edit, an
// accepted rewrite. No model call.
export function personLines(campaign: Pick<Campaign, "id" | "gameSettings">, text: string): SpokenLine[] {
  if (!hasQuotedLine(text)) {
    return [];
  }
  const sheets = listSheets(campaign.id);
  const creatures = new Map([...guardOutcomes([], liveStateFor(campaign.id)).creatures].map(([ref, fact]) => [ref, fact.display]));
  const speakers = [...speakerRoster(campaign.id, sheets, creatures).values()];
  const recent = listRecentMessages(campaign.id, COMMON_WORDS_MESSAGES)
    .filter((message) => message.authorType === "dm")
    .map((message) => message.content);
  return linesOf(
    attributeSpeech(text, speakers, {
      common: commonWords(recent),
      pronouns: campaign.gameSettings.tableLanguage === "english",
    }),
  );
}

// Model-written text outside a turn (a reroll, a continued scene, an
// expanded beat): one read asking only who speaks, made only when the text
// quotes somebody.
export async function modelLines(campaign: Campaign, text: string, label: string): Promise<SpokenLine[]> {
  if (!hasQuotedLine(text)) {
    return [];
  }
  const claims = await readClaims(campaign, {
    label,
    text,
    kinds: ["speaker"],
    outcomes: guardOutcomes([], liveStateFor(campaign.id)),
    sheets: listSheets(campaign.id),
  });
  return modelTextLines(
    campaign,
    text,
    claims.flatMap((claim) => (claim.kind === "speaker" ? [{ line: claim.line, speaker: claim.speaker }] : [])),
  );
}

// The lines of model-written text as stored: the reader's speakers, then
// the structural reading for any line the reader left out (a line its tag
// splits in two, say), which also stands in when the read failed. The
// structural reading never gives a model's line to a party character: the
// DM does not speak for one (src/lib/dm/prompt.ts), and on recorded
// narration nearly every line it gave the wrong person went to a party
// character named beside the speaker. A speaker the reply itself registered
// had no row when it was read, and is found by name now that its tools have
// run.
export function modelTextLines(campaign: Pick<Campaign, "id" | "gameSettings">, text: string, read: readonly SpokenLine[]): SpokenLine[] {
  const resolved = read.map(({ line, speaker }): SpokenLine => {
    if (speaker.kind !== "npc" || speaker.id) {
      return { line, speaker: storedSpeaker(speaker) };
    }
    const npc = getNpcByName(campaign.id, speaker.name);
    if (npc) {
      return { line, speaker: { kind: "npc", id: npc.id, name: npc.name } };
    }
    const sheet = listSheets(campaign.id).find((entry) => foldName(entry.name) === foldName(speaker.name));
    return { line, speaker: sheet ? { kind: "pc", id: sheet.id, name: sheet.name } : storedSpeaker(speaker) };
  });
  return mergeLines(
    resolved,
    personLines(campaign, text).filter((entry) => entry.speaker.kind !== "pc"),
  );
}

// The lines of a passage the human DM or an agent program narrates: none
// when it is spoken as one person, who has no lines of anyone else's; the
// reader's for an agent program's prose; a person's prose read from its
// words.
export function narratedLines(
  campaign: Pick<Campaign, "id" | "gameSettings">,
  text: string,
  from: { speaker: Speaker | null; agentLines: SpokenLine[] | null },
): SpokenLine[] {
  if (from.speaker) {
    return [];
  }
  return from.agentLines ?? personLines(campaign, text);
}
