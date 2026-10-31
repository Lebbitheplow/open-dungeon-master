import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { companionConscience, saveConscience } from "@/lib/db/companion-conscience";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { insertCampaignMessage, type CampaignMessage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { computeSheetDerived } from "@/lib/srd";
import { passiveScore } from "@/lib/dm/check-tools";
import { conscienceOn, consciousCompanions } from "@/lib/dm/conscience";
import { dueSpoken, fallbackLine, heard, uneaseWhisper, voicedIn, type VoicedMessage } from "@/lib/dm/conscience-voice-logic";
import { notices } from "@/lib/dm/pact-logic";
import { secretRoll } from "@/lib/dm/roll-card";
import { deliverWhisper } from "@/lib/dm/whispers";
import { publishEphemeral, publishWithSeq } from "@/lib/events";
import { stopWordsFor } from "@/lib/language/language";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A companion's conscience said at the table (issue 615), the rim around
// src/lib/dm/conscience-voice-logic.ts. A move the table is owed (set where
// every rung moves, conscience.ts settleCompanion) is read against each
// narration as it lands: said in it, the table has heard it; not said, the
// server posts the companion's own line right after it, as a GM message
// spoken by the companion, so it shows with their face, is read in their
// voice, and stays in the chapter record like any other line of the story.
// It never waits on the model: like the "walked out" and "no longer takes
// orders" lines, it does not depend on what the narration chose to say.
//
// Unease a composed companion keeps in is read here too: a hidden Deception
// against each standing character's passive Insight, as a pact's tells are
// (src/lib/dm/pacts.ts readTells). One who notices is told in a whisper to
// their player alone, and the storyteller learns who.
//
// Imported by the turn's narration (src/lib/dm/turn.ts finalize), the human
// GM's and an agent program's narration (dm/narrate), a recorded beat
// (src/lib/dm/beats.ts), and the moments unease is read (a deed, the night
// watch, the road, the turn's start). conscience.ts must not import this:
// it would close a cycle through check-tools.ts.

// After a narration: each owed move it said is the table's; each it did not
// is posted as the companion's own line when `post` is set (a beat records
// play that already happened, so it only clears what it said). Returns the
// lines posted, for the caller to read aloud after the narration's own audio,
// so the table hears them in order.
export function voiceOwedConscience(campaign: Campaign, message: VoicedMessage, options: { post: boolean }): CampaignMessage[] {
  if (!conscienceOn(campaign)) {
    return [];
  }
  const now = (getCampaignById(campaign.id) ?? campaign).clock.instant;
  const stopWords = stopWordsFor(campaign.gameSettings.tableLanguage);
  const posted: CampaignMessage[] = [];
  let changed = false;
  for (const companion of consciousCompanions(listSheets(campaign.id))) {
    const npc = companionNpcFor(companion);
    const conscience = npc ? companionConscience(npc.id) : null;
    if (!npc || !conscience?.owed) {
      continue;
    }
    if (voicedIn(conscience.owed, { name: companion.name, ids: [companion.id, npc.id] }, message, stopWords)) {
      saveConscience(npc.id, heard(conscience));
      changed = true;
      continue;
    }
    if (!options.post) {
      continue;
    }
    posted.push(sayAsCompanion(campaign, companion, fallbackLine(conscience.owed, dueSpoken(now, conscience.owed.due ?? now))));
    // Once, whether said or posted: the next narration owes nothing more.
    saveConscience(npc.id, heard(conscience));
    changed = true;
  }
  if (changed) {
    publishEphemeral(campaign.id, "relationships_updated", {});
  }
  return posted;
}

// The companion's line, as a GM message spoken by them: a speaker of kind
// "pc" with their sheet id, the way the transcript and the narration voices
// already give a party companion their own face and voice (speech-lines.ts).
function sayAsCompanion(campaign: Campaign, companion: CharacterSheet, line: string): CampaignMessage {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "dm",
    content: `${companion.name}: "${line}"`,
    speech: [{ line, speaker: { kind: "pc", id: companion.id, name: companion.name } }],
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  return message;
}

// Unease kept in, read by the party: one hidden Deception from the companion
// against each standing player character's passive Insight, leaving out
// whoever already noticed. `fresh` reads only unease that has just set in
// (after a deed, at the turn's start); the night watch and the road read all
// of it again, as companions are watched closest there.
export function readUneaseTells(campaign: Campaign, turnId: string, which: "fresh" | "all" = "all") {
  if (!conscienceOn(campaign)) {
    return;
  }
  const sheets = listSheets(campaign.id);
  const watchers = sheets.filter((sheet) => !sheet.isCompanion && !sheet.summon && sheet.currentHp > 0 && !sheet.deathSaves?.dead);
  let changed = false;
  for (const companion of consciousCompanions(sheets)) {
    const npc = companionNpcFor(companion);
    const conscience = npc ? companionConscience(npc.id) : null;
    const hidden = conscience?.concealed;
    if (!npc || !conscience || !hidden || (which === "fresh" && !hidden.pending)) {
      continue;
    }
    const unaware = watchers.filter((sheet) => !hidden.noticedBy.includes(sheet.id));
    const noticed: CharacterSheet[] = [];
    if (unaware.length) {
      const roll = secretRoll(
        campaign.id,
        null,
        null,
        "skill_check",
        `${companion.name}: Deception, hiding their unease`,
        d20Expression(computeSheetDerived(companion).skills.deception ?? 0),
      );
      for (const sheet of unaware) {
        if (notices(passiveScore(campaign, sheet, "insight"), roll.total)) {
          noticed.push(sheet);
          deliverWhisper(campaign.id, turnId, [{ userId: sheet.userId, characterId: sheet.id, characterName: sheet.name }], uneaseWhisper(sheet.name, companion.name));
        }
      }
    }
    saveConscience(npc.id, { ...conscience, concealed: { noticedBy: [...hidden.noticedBy, ...noticed.map((sheet) => sheet.id)], pending: false } });
    changed = changed || noticed.length > 0;
  }
  if (changed) {
    publishEphemeral(campaign.id, "relationships_updated", {});
  }
}
