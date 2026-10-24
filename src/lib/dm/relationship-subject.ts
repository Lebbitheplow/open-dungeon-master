import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { insertFact } from "@/lib/db/facts";
import { getNpcByName, nearestNpcName, setNpcAttitude, standsBehindLiveCompanion, type Npc } from "@/lib/db/npcs";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { settleConsciences } from "@/lib/dm/conscience";
import {
  ensureRelationship,
  getRelationship,
  type Relationship,
  type RelationshipSubjectKind,
} from "@/lib/db/relationships";
import { derivePersonality, nearestNpcHint } from "@/lib/dm/npc-logic";
import { romanceIndex, type Personality, type RomanceStage } from "@/lib/dm/relationship-logic";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

// Who a relationship tool is about, and the shared bookkeeping of a
// romantic step: the pieces relationship_beat, romance_advance and an NPC's
// advance (src/lib/dm/npc-advance.ts) all stand on. Split out of
// relationship-tools.ts so the advance module can use them without an
// import cycle.

export type Subject = {
  kind: RelationshipSubjectKind;
  name: string;
  id: string;
  personality: Personality;
  hostile: boolean;
  npc: Npc | null;
};

// An NPC by name, or an AI companion by its sheet. A lasting companion is
// weighed by the personality axes on the row behind it (#503 Phase 0.1),
// made the first time it is asked for, so a deed lands by who they are, as
// the relationship rules promise. A companion who has left keeps that row,
// so what the party felt for them can still move.
export function resolveSubject(campaign: Campaign, rawName: string, sheets: CharacterSheet[]): Subject | ToolError {
  const needle = textKey(rawName);
  const sheet = sheets.find((candidate) => textKey(candidate.name) === needle);
  if (sheet && !sheet.isCompanion) {
    return {
      error: `${sheet.name} is a player's character. How two player characters feel about each other belongs to those two players and is not metered here; play the scene.`,
      retry: true,
    };
  }
  if (sheet?.isCompanion) {
    return companionSubject(sheet);
  }
  const npc = getNpcByName(campaign.id, rawName);
  if (!npc) {
    return {
      error: `No tracked NPC or companion named "${rawName}".${nearestNpcHint(nearestNpcName(campaign.id, rawName))} Register them with set_npc (or npc_reaction), or add_companion, before recording how they take things.`,
      retry: true,
    };
  }
  // The row behind a companion still in the party, reached by another of
  // their names: it is the companion that is meant.
  if (standsBehindLiveCompanion(npc)) {
    const live = sheets.find((candidate) => candidate.id === npc.companionSheetId) ?? getSheetById(npc.companionSheetId);
    if (live) {
      return companionSubject(live);
    }
  }
  return {
    kind: npc.companionSheetId ? "companion" : "npc",
    name: npc.name,
    id: npc.id,
    personality: npc.agency.personality ?? derivePersonality(npc.name, npc.attitude, npc.trait),
    hostile: npc.attitude === "hostile",
    npc,
  };
}

function companionSubject(sheet: CharacterSheet): Subject {
  // A guest is scene-scoped and has no row: every deed lands at face value.
  const npc = companionNpcFor(sheet);
  return {
    kind: "companion",
    name: sheet.name,
    id: sheet.id,
    personality: npc ? (npc.agency.personality ?? derivePersonality(sheet.name, "friendly", sheet.personality)) : null,
    hostile: false,
    npc,
  };
}

export function resolveActor(
  args: { characterId: string },
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet | null {
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  return stale ? getSheetById(stale.id) ?? stale : null;
}

export function openLedger(campaign: Campaign, sheet: CharacterSheet, subject: Subject): Relationship {
  return (
    getRelationship(campaign.id, sheet.id, subject.name) ??
    ensureRelationship({
      campaignId: campaign.id,
      characterId: sheet.id,
      characterName: sheet.name,
      subjectKind: subject.kind,
      subjectName: subject.name,
      subjectId: subject.id,
    })
  );
}

// Milestones land in the character's own story log, which is where the table
// already reads its history, and follow the character into their library
// entry. The panel refetches on the contentless ephemeral.
export function recordRelationshipEvent(campaign: Campaign, sheet: CharacterSheet, summary: string) {
  const event = insertCharacterEvent({
    libraryCharacterId: sheet.libraryCharacterId,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "relationship",
    summary: summary.slice(0, 300),
  });
  publishPersisted(campaign.id, "character_event", { event, characterName: sheet.name });
}

// Every write of standing ends here, so it is also where each lasting
// companion's conscience is settled against the standing it now has (issue
// 503, src/lib/dm/conscience.ts): a meter a social check sank to disliked
// warns as surely as a deed does.
export function publishRelationshipsUpdated(campaignId: string) {
  settleConsciences(campaignId);
  publishEphemeral(campaignId, "relationships_updated", {});
}

export function defaultMilestoneText(character: string, subject: string, stage: RomanceStage): string {
  switch (stage) {
    case "interested":
      return `${character} and ${subject} felt something unspoken pass between them`;
    case "courting":
      return `${character} and ${subject} began openly courting`;
    case "together":
      return `${character} and ${subject} became partners`;
    case "betrothed":
      return `${character} and ${subject} were betrothed`;
    case "married":
      return `${character} and ${subject} were married`;
    default:
      return `${character} and ${subject} grew closer`;
  }
}

// The lasting rungs belong to the campaign's own record, not just the
// relationship row: a marriage is world state every later prompt should see.
export function recordMilestone(
  campaign: Campaign,
  sheet: CharacterSheet,
  subject: Pick<Subject, "name" | "npc">,
  stage: RomanceStage,
  note?: string,
) {
  const summary = note?.trim()
    ? `${defaultMilestoneText(sheet.name, subject.name, stage)}: ${note.trim()}`
    : defaultMilestoneText(sheet.name, subject.name, stage);
  recordRelationshipEvent(campaign, sheet, summary);
  if (romanceIndex(stage) >= romanceIndex("betrothed")) {
    insertFact({
      campaignId: campaign.id,
      category: "party",
      subject: `${sheet.name} and ${subject.name}`,
      fact: `${summary}.`,
      knownBy: "party",
      // Vows are not the kind of fact a later chapter quietly supersedes.
      pinned: true,
      source: "manual",
    });
  }
  // Someone who has taken a real step with a character is not indifferent to
  // the party any more.
  if (subject.npc && romanceIndex(stage) >= romanceIndex("courting")) {
    if (subject.npc.attitude !== "friendly") {
      setNpcAttitude(subject.npc.id, "friendly", "");
    }
  }
}
