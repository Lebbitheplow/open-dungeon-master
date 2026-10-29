import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { companionConscience, companionValues, saveConscience } from "@/lib/db/companion-conscience";
import { listActiveFacts, setFactStatus } from "@/lib/db/facts";
import { normalizeSubject } from "@/lib/dm/fact-logic";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { patchRelationship, type Relationship } from "@/lib/db/relationships";
import { conscienceOn, settleCompanion, worstApproval, type ConscienceMove } from "@/lib/dm/conscience";
import { departureNote, settleBreakingPoint, type DepartureOutcome } from "@/lib/dm/departure";
import { clockDay, RUNG_WORD, stepLadder, type LadderStep } from "@/lib/dm/conscience-logic";
import { deedVerdict, doneToDelta, SEVERITY_FACTOR, type DeedKind, type DeedSeverity, type DeedVerdict } from "@/lib/dm/companion-values-logic";
import { openLedger, type Subject } from "@/lib/dm/relationship-subject";
import { actAfterBeat, actFaceValue, actRunning, outwardApproval } from "@/lib/dm/scheme-logic";
import {
  addFlag,
  addMemory,
  applyApproval,
  beatAlignment,
  beatDelta,
  beatSpec,
  bystanderShare,
  demoteRomance,
  friendshipTier,
  TIER_LABEL,
  type BeatOutcome,
  type RelationshipBeat,
} from "@/lib/dm/relationship-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// One beat landing on one person who saw it: the approval it moves, weighed
// by their nature (relationship-logic.ts) and, for a lasting companion, by
// what they hold to (companion-values-logic.ts), then what it does to that
// companion's conscience (conscience.ts). relationship_beat lands a beat on
// its subject this way, and a deed on every witness it names.

export type DeedOptions = {
  severity: DeedSeverity;
  // The faction the deed was done to, for a faction loyalty.
  faction: string;
  // What a companion this pushes to an ultimatum demands, and by when.
  demand: string;
  hours?: number;
};

export type Landing = {
  subject: Subject;
  before: Relationship;
  updated: Relationship;
  delta: number;
  // How well it suits their nature, -3..3 (relationship-logic.ts).
  alignment: number;
  values: DeedVerdict | null;
  conscience: ConscienceMove | null;
  // A companion at its breaking point at a Leave or Turn table: what the
  // server had it do (src/lib/dm/departure.ts). A plan it now holds is a
  // storyteller secret, and no note names it.
  departure: DepartureOutcome | null;
};

// Words for what moved a companion, in the DM's line and an ultimatum's
// plain demand: "torture by Kael".
const CAUSE: Partial<Record<RelationshipBeat, string>> = {
  mercy: "mercy shown",
  cruelty: "cruelty",
  betrayal: "a betrayal",
  broke_word: "a broken word",
  murder_helpless: "the killing of someone helpless",
  torture: "torture",
  theft_from_poor: "robbing people with little",
  necromancy: "necromancy",
  desecration: "desecration",
  slaving: "slaving",
  laid_to_rest: "the dead laid to rest",
  freed_captives: "captives set free",
  upheld_law: "a wrongdoer handed to the law",
  kept_word: "a word kept",
  defended: "standing up for someone",
  greed: "profit taken",
  amends: "amends made",
};

export function causeOf(beat: RelationshipBeat, doer: string): string {
  return `${CAUSE[beat] ?? beat.replace(/_/g, " ")} by ${doer}`;
}

// The live lasting companion a subject is, when it is one: the sheet a
// conscience belongs to.
function liveCompanion(subject: Subject): CharacterSheet | null {
  if (subject.kind !== "companion" || !subject.npc) {
    return null;
  }
  const sheet = getSheetById(subject.id);
  return sheet?.isCompanion ? sheet : null;
}

export function landBeat(
  campaign: Campaign,
  sheet: CharacterSheet,
  subject: Subject,
  relationship: Relationship,
  beat: RelationshipBeat,
  outcome: BeatOutcome | null,
  note: string | undefined,
  deed: DeedOptions | null,
): Landing {
  const spec = beatSpec(beat)!;
  const alignment = beatAlignment(spec, subject.personality);
  const weighed = beatDelta(beat, outcome, {
    approval: outwardApproval(relationship),
    repeats: relationship.beats[beat] ?? 0,
    personality: subject.personality,
    hostile: subject.hostile,
  });
  const companion = conscienceOn(campaign) ? liveCompanion(subject) : null;
  const values = companion && subject.npc
    ? deedVerdict(companionValues(subject.npc.id), beat, deed?.severity ?? "serious", deed?.faction ?? "")
    : null;
  const delta = Math.round(weighed * (deed ? SEVERITY_FACTOR[deed.severity] : 1)) + (values?.approval ?? 0);
  const sheets = listSheets(campaign.id);
  // Where they stood before it: a breach steps down from there.
  const worstBefore = companion ? worstApproval(campaign.id, companion.name, sheets) : null;
  const approval = applyApproval(relationship.approval, delta);
  // While an NPC keeps up an act (issue 501), a warm beat lands on the
  // warmth shown at its face value, whatever they truly feel, and a cold one
  // moves both (src/lib/dm/scheme-logic.ts actAfterBeat); a romance the act
  // carries holds by that warmth.
  const running = actRunning(relationship.pretense) ? relationship.pretense : null;
  const act = running ? actAfterBeat(running, actFaceValue(spec.base, relationship.beats[beat] ?? 0), relationship.approval, approval) : null;
  // The beats worth remembering are the ones that changed something.
  const memorable = beat === "intimacy" || beat === "betrayal" || Math.abs(delta) >= 7;
  const updated =
    patchRelationship(relationship.id, {
      approval,
      romance: demoteRomance(relationship.romance, act ? act.shown : approval),
      beats: { ...relationship.beats, [beat]: (relationship.beats[beat] ?? 0) + 1 },
      ...(beat === "intimacy" ? { flags: addFlag(relationship.flags, "intimacy") } : {}),
      ...(act ? { pretense: act } : {}),
      ...(memorable && note?.trim()
        ? { memories: addMemory(relationship.memories, { kind: beat, text: note.trim(), at: new Date().toISOString() }) }
        : {}),
    }) ?? relationship;

  const { conscience, departure } = stepConscience(campaign, sheet, subject, companion, beat, values, deed, worstBefore);
  return { subject, before: relationship, updated, delta, alignment, values, conscience, departure };
}

// What a beat does to a lasting companion's conscience (issue 503): the step
// its values take on the ladder, the rung settled against the standing it
// now has, and at the breaking point what the server has it do. Shared by a
// witness's landing and a victim's.
function stepConscience(
  campaign: Campaign,
  sheet: CharacterSheet,
  subject: Subject,
  companion: CharacterSheet | null,
  beat: RelationshipBeat,
  values: DeedVerdict | null,
  deed: DeedOptions | null,
  worstBefore: number | null,
): { conscience: ConscienceMove | null; departure: DepartureOutcome | null } {
  if (!companion || !subject.npc) {
    return { conscience: null, departure: null };
  }
  const step: LadderStep | null = beat === "amends" ? "honour" : (values?.ladder ?? null);
  const day = clockDay((getCampaignById(campaign.id) ?? campaign).clock.instant);
  const next = stepLadder(companionConscience(subject.npc.id), step, worstBefore, day, causeOf(beat, sheet.name));
  saveConscience(subject.npc.id, next);
  const conscience = settleCompanion(campaign, companion, next, deed ? { demand: deed.demand, hours: deed.hours } : {}, listSheets(campaign.id));
  // At the breaking point the server decides what they do, now (issue 503
  // Phase 2); climbed back off it, any plan they held is dropped.
  const departure = settleBreakingPoint(campaign, getSheetById(companion.id) ?? companion);
  return { conscience, departure };
}

// A deed landing on whoever it was done to (issue 580): the captive harmed,
// the foe spared, the prisoner set free. Their regard moves at face value and
// a step graver than a witness's (companion-values-logic.ts doneToDelta),
// since being harmed or spared is not a matter of taste. A lasting companion
// it was done to still weighs the deed by what it holds to, on its
// conscience, as a witness would (the ladder, an ultimatum's demand); only
// its regard is the victim's. null when it lands on nobody: a deed done to
// the dead.
export function landOnVictim(
  campaign: Campaign,
  sheet: CharacterSheet,
  subject: Subject,
  relationship: Relationship,
  beat: DeedKind,
  note: string | undefined,
  deed: DeedOptions,
): Landing | null {
  const delta = doneToDelta(beat, beatSpec(beat)!.base, deed.severity);
  if (!delta) {
    return null;
  }
  const companion = conscienceOn(campaign) ? liveCompanion(subject) : null;
  const values = companion && subject.npc ? deedVerdict(companionValues(subject.npc.id), beat, deed.severity, deed.faction) : null;
  const worstBefore = companion ? worstApproval(campaign.id, companion.name, listSheets(campaign.id)) : null;
  const approval = applyApproval(relationship.approval, delta);
  const running = actRunning(relationship.pretense) ? relationship.pretense : null;
  const updated =
    patchRelationship(relationship.id, {
      approval,
      romance: demoteRomance(relationship.romance, running ? running.shown : approval),
      beats: { ...relationship.beats, [beat]: (relationship.beats[beat] ?? 0) + 1 },
      ...(note?.trim() ? { memories: addMemory(relationship.memories, { kind: beat, text: note.trim(), at: new Date().toISOString() }) } : {}),
    }) ?? relationship;
  const { conscience, departure } = stepConscience(campaign, sheet, subject, companion, beat, values, deed, worstBefore);
  return { subject, before: relationship, updated, delta, alignment: 0, values, conscience, departure };
}

// The other player characters who stood by while a deed was done (issue
// 563): each bears a smaller share of what it cost with everyone who saw it
// (relationship-logic.ts bystanderShare), on their own bond with that person.
// One who spoke against it or tried to stop it is not a bystander and bears
// none; the caller leaves them out. A deed that won regard shares none of it:
// standing by is no credit. Returns the table's words for each share.
export function landBystanders(campaign: Campaign, landings: readonly Landing[], bystanders: readonly CharacterSheet[]): string[] {
  const lines: string[] = [];
  for (const sheet of bystanders) {
    const moved: string[] = [];
    for (const landing of landings) {
      const share = bystanderShare(landing.delta);
      if (!share) {
        continue;
      }
      const ledger = openLedger(campaign, sheet, landing.subject);
      if (ledger.status === "ended") {
        continue;
      }
      const approval = applyApproval(ledger.approval, share);
      // An act an NPC keeps up shows the same warmth (scheme-logic.ts), so the
      // romance it carries holds by that, as landBeat's does.
      const running = actRunning(ledger.pretense) ? ledger.pretense : null;
      const updated = patchRelationship(ledger.id, { approval, romance: demoteRomance(ledger.romance, running ? running.shown : approval) }) ?? ledger;
      moved.push(`${landing.subject.name} (${TIER_LABEL[friendshipTier(updated.approval)]})`);
    }
    if (moved.length) {
      lines.push(`${sheet.name} stood by and bears a share of it with ${moved.join(", ")}.`);
    }
  }
  return lines;
}

// A deed recorded settles the note the outcome check left when the
// narration showed it unrecorded (src/lib/dm/deed-claims.ts).
export function settleUnrecordedDeeds(campaignId: string, sheet: Pick<CharacterSheet, "name">) {
  const subject = normalizeSubject(unrecordedDeedSubject(sheet.name));
  for (const fact of listActiveFacts(campaignId)) {
    if (fact.subject === subject) {
      setFactStatus(fact.id, "retired");
    }
  }
}

export function unrecordedDeedSubject(name: string): string {
  return `Unrecorded deed: ${name}`;
}

// What the witnesses' landings add to the DM's note: whose conscience moved,
// an ultimatum to voice, a command that ended, a companion who left.
export function conscienceNotes(landings: readonly Landing[]): string[] {
  return landings.flatMap((landing) => {
    const move = landing.conscience;
    if (!move) {
      return [];
    }
    const lines: string[] = [];
    if (move.from !== move.to) {
      lines.push(
        `${move.companion}'s conscience moves from ${RUNG_WORD[move.from]} to ${RUNG_WORD[move.to]}: play it as GAME STATE's conscience line says.`,
      );
    }
    if (move.ultimatum) {
      lines.push(
        `${move.companion} sets an ultimatum: "${move.ultimatum.condition}", by ${move.ultimatum.due} (${move.ultimatum.left}). Voice it in their own words.`,
      );
    }
    if (move.commandEnded) {
      lines.push(`${move.companion} no longer takes ${move.commandEnded}'s orders in a fight; you play their turns now.`);
    }
    return lines;
  }).concat(landings.map((landing) => (landing.departure ? departureNote(landing.departure) : "")).filter(Boolean));
}
