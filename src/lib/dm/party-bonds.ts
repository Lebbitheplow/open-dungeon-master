import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { getNpcById, listCastNpcs, listNpcs, markNpcMet, standsBehindLiveCompanion, type Npc } from "@/lib/db/npcs";
import {
  endRelationshipsWithSubject,
  ensureRelationship,
  getRelationship,
  listRelationships,
  listRelationshipsForSubject,
} from "@/lib/db/relationships";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { livingHero } from "@/lib/characters/fallen-logic";
import { fieldedSheets } from "@/lib/dm/roster";
import { deathMemory, foeBondName, joinerSubjects, subjectDied, type BondSubject } from "@/lib/dm/party-bonds-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import type { Speaker, SpokenLine } from "@/lib/dm/speech";

// The bonds the party has with someone it travels with or has met (issue
// 580). A bond used to open only when a roll or a moment happened to name
// one character, so after hours of play the Bonds panel listed nobody the
// party had travelled with: a companion who joined, an NPC the story brought
// into the scene. Kept apart from relationship-subject.ts so the companion
// tools can reach it without an import cycle through the conscience.

export type { BondSubject };

// A bond at neutral for every living player character in play who has none
// with them yet, never a companion or a summoned creature, and never a hero
// who has fallen (issue 657: the dead kept gaining bonds with people met
// after they died). Nothing already on file changes, a parted or ended bond
// included. Nobody meets an NPC who is dead. Returns how many it opened, for
// the caller to tell the table (relationships_updated).
export function openPartyBonds(campaign: Campaign, subject: BondSubject): number {
  if (campaign.gameSettings.relationships === "off") {
    return 0;
  }
  // A companion with a sheet at the table is alive whatever an older bond
  // under the same name says.
  if (!getSheetById(subject.id) && subjectDied(listRelationshipsForSubject(campaign.id, subject.name))) {
    return 0;
  }
  let opened = 0;
  for (const sheet of fieldedSheets(campaign, listSheets(campaign.id))) {
    if (!livingHero(sheet) || textKey(sheet.name) === textKey(subject.name)) {
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

// A hero who takes a seat after the party has met people (issue 657): a
// replacement for one who fell, a player who joins a table in play, one
// raised from the dead who missed whoever the party met meanwhile. Each gets
// a bond at neutral with everyone the party has met and still deals with
// (party-bonds-logic.ts joinerSubjects), as the heroes who were there got at
// the meeting. Bonds opened only at a first meeting, so a newcomer had none
// with the people the party travelled among. Returns how many it opened.
export function openJoinerBonds(campaign: Campaign, sheet: CharacterSheet): number {
  if (campaign.gameSettings.relationships === "off" || !livingHero(sheet)) {
    return 0;
  }
  const subjects = joinerSubjects({ npcs: listNpcs(campaign.id), sheets: listSheets(campaign.id), bonds: listRelationships(campaign.id) });
  let opened = 0;
  for (const subject of subjects) {
    if (textKey(subject.name) === textKey(sheet.name) || getRelationship(campaign.id, sheet.id, subject.name)) {
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

// A fight just ended: the foes who died in it are dead to everyone who knew
// them (issue 657). A raider the party had dealt with before the fight stayed
// on the Bonds tab at Neutral after it killed him, since a death closed bonds
// only when the GM named it with relationship_end. Read at the fight's end,
// not at the blow: a GM's correction can set a dead foe's hit points back
// mid-fight, and two paths write "dead". Returns the names whose bonds closed.
export function closeFallenFoes(campaign: Campaign, enemies: readonly Pick<EncounterEnemy, "displayName" | "status">[]): string[] {
  const npcs = listCastNpcs(campaign.id);
  const closed: string[] = [];
  const seen = new Set<string>();
  for (const enemy of enemies) {
    if (enemy.status !== "dead") {
      continue;
    }
    const name = foeBondName(enemy.displayName, npcs) ?? enemy.displayName;
    const key = textKey(name);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (endRelationshipsWithSubject(campaign.id, name, (bond) => deathMemory(bond, name)).length) {
      closed.push(name);
    }
  }
  return closed;
}
