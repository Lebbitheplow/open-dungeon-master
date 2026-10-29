import type { Campaign } from "@/lib/db/campaigns";
import { getNpcById, markNpcMet, standsBehindLiveCompanion, type Npc } from "@/lib/db/npcs";
import { ensureRelationship, getRelationship, type RelationshipSubjectKind } from "@/lib/db/relationships";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { fieldedSheets } from "@/lib/dm/roster";
import { textKey } from "@/lib/language/text-logic";
import type { Speaker, SpokenLine } from "@/lib/dm/speech";

// The bonds the party has with someone it travels with or has met (issue
// 580). A bond used to open only when a roll or a moment happened to name
// one character, so after hours of play the Bonds panel listed nobody the
// party had travelled with: a companion who joined, an NPC the story brought
// into the scene. Kept apart from relationship-subject.ts so the companion
// tools can reach it without an import cycle through the conscience.

export type BondSubject = { kind: RelationshipSubjectKind; name: string; id: string };

// A bond at neutral for every player character in play who has none with
// them yet, never a companion or a summoned creature. Nothing already on
// file changes, a parted or ended bond included. Returns how many it opened,
// for the caller to tell the table (relationships_updated).
export function openPartyBonds(campaign: Campaign, subject: BondSubject): number {
  if (campaign.gameSettings.relationships === "off") {
    return 0;
  }
  let opened = 0;
  for (const sheet of fieldedSheets(campaign, listSheets(campaign.id))) {
    if (sheet.isCompanion || sheet.summon || textKey(sheet.name) === textKey(subject.name)) {
      continue;
    }
    if (getRelationship(campaign.id, sheet.id, subject.name)) {
      continue;
    }
    ensureRelationship({
      campaignId: campaign.id,
      characterId: sheet.id,
      characterName: sheet.name,
      subjectKind: subject.kind,
      subjectName: subject.name,
      subjectId: subject.id,
    });
    opened += 1;
  }
  return opened;
}

// Who a bond with an NPC row is with: the companion, when the row stands
// behind one still in the party (as relationship-subject.ts resolveSubject
// reads it), else the NPC.
export function npcBondSubject(npc: Npc): BondSubject {
  if (standsBehindLiveCompanion(npc)) {
    const sheet = getSheetById(npc.companionSheetId);
    if (sheet) {
      return { kind: "companion", name: sheet.name, id: sheet.id };
    }
  }
  return { kind: npc.companionSheetId ? "companion" : "npc", name: npc.name, id: npc.id };
}

// The party deals with an NPC through a rule (a reaction roll, a social
// check, a moment between them, an attitude the story shifted): they are met
// (Npc.metAt), and at the first meeting every character's bond with them
// opens. `always` opens any still missing on a later dealing as well: an
// attitude the story shifts is the whole party's business.
export function meetNpc(campaign: Campaign, npc: Npc, always = false): { npc: Npc; opened: number } {
  const first = !npc.metAt;
  const met = markNpcMet(npc.id) ?? getNpcById(npc.id) ?? npc;
  const opened = first || always ? openPartyBonds(campaign, npcBondSubject(met)) : 0;
  return { npc: met, opened };
}

// Someone registered who speaks to the party in a narration has met it: the
// engine's one sure sign that a person is in the scene, read from the
// speakers the narration's lines are already tagged with (speech-lines.ts),
// or the person a GM narrates as. The patron a bundle prepared, whom the story
// brings in without any tool call naming her gets her bonds this way: in a
// live check the default model narrated that meeting without set_npc.
// Nothing when bonds are off, so a reaction roll reads the table as before.
// Returns how many bonds it opened, for the caller to tell the table.
export function meetSpeakers(campaign: Campaign, lines: readonly SpokenLine[], speaker: Speaker | null = null): number {
  if (campaign.gameSettings.relationships === "off") {
    return 0;
  }
  const ids = new Set(
    [...lines.map((entry) => entry.speaker), ...(speaker ? [speaker] : [])]
      .filter((entry) => entry.kind === "npc" && entry.id)
      .map((entry) => entry.id),
  );
  let opened = 0;
  for (const id of ids) {
    const npc = getNpcById(id);
    if (npc && npc.campaignId === campaign.id && !npc.metAt) {
      opened += meetNpc(campaign, npc).opened;
    }
  }
  return opened;
}
