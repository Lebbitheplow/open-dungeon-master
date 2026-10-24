// NPCs who make the first move (issue 501), the pure half: when the server
// rolls for an advance, who may make it, toward whom, and what the DM and
// the table are told. No DB access and no "@/" imports, so
// scripts/test-advances.mjs loads it directly; the rim is
// src/lib/dm/advance-tick.ts (the roll after an AI turn) and
// src/lib/dm/npc-advance.ts (the move and the answer).
//
// The shape of it: the server decides WHEN (an occasional roll per
// opted-in character, raised by their Charisma), the server decides WHO (an
// NPC or companion in the scene who already likes them enough to court, and
// whose attraction fits both ways), the DM plays the moment through
// romance_advance with initiator "npc", and the PLAYER answers through an
// offer only they can settle. Nobody is courted who did not ask to be.

import type { RomanceStage, RelationshipStatus } from "./relationship-logic.ts";
import { friendshipTier, romanceIndex, ROMANCE_THRESHOLD, tierIndex } from "./relationship-logic.ts";
import { attractionFits, type Attraction } from "../attraction.ts";
import type { Gender } from "../gender.ts";
import { compareNames, containsPhrase, textKey } from "../language/text-logic.ts";

// ---- tunables ----

// A roll for each opted-in character every this many AI turns.
export const ADVANCE_EVERY = 8;
// AI turns a success leaves open for the DM to play the move.
export const ADVANCE_WINDOW = 3;
// AI turns an advance waits for its answer before it lapses into "no answer"
// (the offer's own 24-hour expiry still applies).
export const ADVANCE_ANSWER_TURNS = 6;
// AI turns before the same pair can roll again after a decline, or after an
// advance nobody answered.
export const DECLINE_COOLDOWN = 24;
export const LAPSE_COOLDOWN = 24;
// The d100 chance: 10 + 5 per point of Charisma modifier, clamped.
export const ADVANCE_CHANCE_BASE = 10;
export const ADVANCE_CHANCE_PER_CHA = 5;
export const ADVANCE_CHANCE_MIN = 5;
export const ADVANCE_CHANCE_MAX = 35;
// "Interested" is an unspoken feeling, so the real move is the open step.
export const ADVANCE_TARGET: RomanceStage = "courting";
export const ADVANCE_TOOL = "romance_advance";

export function advanceChance(charismaModifier: number): number {
  const raw = ADVANCE_CHANCE_BASE + ADVANCE_CHANCE_PER_CHA * Math.trunc(charismaModifier || 0);
  return Math.max(ADVANCE_CHANCE_MIN, Math.min(ADVANCE_CHANCE_MAX, raw));
}

export function advanceRollSucceeds(d100: number, charismaModifier: number): boolean {
  return d100 <= advanceChance(charismaModifier);
}

// Whether this finished AI turn is a rolling turn for a pair.
export function rollDue(aiTurns: number, cooldownUntil: number): boolean {
  return aiTurns > 0 && aiTurns % ADVANCE_EVERY === 0 && aiTurns >= cooldownUntil;
}

// The window is open for the turn after `aiTurns` finished turns while that
// turn is within it. 0 means none was ever opened.
export function windowOpen(readyUntil: number, aiTurns: number): boolean {
  return readyUntil > 0 && aiTurns < readyUntil;
}

export function windowTurnsLeft(readyUntil: number, aiTurns: number): number {
  return windowOpen(readyUntil, aiTurns) ? readyUntil - aiTurns : 0;
}

// ---- the table's own limits ----

// One word list for lines and veils, matched as the start of a word so
// "romances" and "flirting" count and "aromantic" does not.
const ROMANCE_WORDS = /(^|[^\p{L}])(romanc|romantic|flirt|seduc|love interest)/iu;

export function namesRomance(text: string): boolean {
  return ROMANCE_WORDS.test(text);
}

export type SafetyLike = { boundaries?: string; lines?: string[]; veils?: string[] };

// Why advances are off at this table, or null. A family table never has
// them, and a line or veil naming romance is the table saying so.
export function romanceSafetyBlock(safety: SafetyLike | null | undefined): string | null {
  if (!safety) {
    return null;
  }
  if (safety.boundaries === "family") {
    return "This is a family table, so no NPC makes a romantic advance.";
  }
  const line = (safety.lines ?? []).find(namesRomance);
  if (line) {
    return `The table drew a line at "${line}", so no NPC makes a romantic advance.`;
  }
  const veil = (safety.veils ?? []).find(namesRomance);
  if (veil) {
    return `The table veiled "${veil}", so no NPC makes a romantic advance.`;
  }
  return null;
}

// The player characters the DM is told are open to advances: none at a
// table without romance, or whose safety tools rule advances out.
export function openToAdvanceNames(
  campaign: { gameSettings: { relationships?: string; romance?: string; safety?: SafetyLike } },
  sheets: ReadonlyArray<{ name: string; isCompanion: boolean; openToAdvances?: boolean; summon?: unknown }>,
): string[] {
  const settings = campaign.gameSettings;
  if (settings.relationships === "off" || settings.romance === "off" || romanceSafetyBlock(settings.safety)) {
    return [];
  }
  return sheets.filter((sheet) => !sheet.isCompanion && !sheet.summon && sheet.openToAdvances).map((sheet) => sheet.name);
}

// ---- presence ----

// Whether an NPC is in the scene: at the party's place (one name inside the
// other, as whole words: "the Gilded Goose, Highmoor" is in Highmoor), or
// named in the narration the table was just told.
export function presentInScene(npc: { name: string; location: string }, partyLocation: string, narration: string): boolean {
  const here = textKey(partyLocation);
  const there = textKey(npc.location);
  if (here && there && (here === there || containsPhrase(npc.location, partyLocation) || containsPhrase(partyLocation, npc.location))) {
    return true;
  }
  return Boolean(narration.trim()) && containsPhrase(narration, npc.name);
}

// ---- who may make the move ----

export type Suitor = {
  name: string;
  kind: "npc" | "companion";
  // A companion's kind: guests never court.
  companionKind?: "party" | "guest" | null;
  present: boolean;
  status: RelationshipStatus;
  approval: number;
  romance: RomanceStage;
  warmth: number;
  gender: Gender;
  attraction: Attraction | null;
  // Together, betrothed or married to someone else.
  committedElsewhere: boolean;
  // An open window or an unanswered advance with anyone.
  pendingAdvance: boolean;
};

export type AdvanceTarget = {
  name: string;
  gender: Gender;
  attraction: Attraction | null;
  open: boolean;
  isCompanion: boolean;
  // Someone else's advance toward them is open or waiting on an answer.
  awaiting?: boolean;
};

// Why this suitor cannot court this character now, or null when they can.
// The same rules the roll picks by and the tool checks the move against.
export function suitorProblem(suitor: Suitor, target: AdvanceTarget): string | null {
  if (target.isCompanion) {
    return `${target.name} is a companion; no player answers for them, so nobody courts them first.`;
  }
  if (!target.open) {
    return `${target.name}'s player has not opened ${target.name} to advances from NPCs. Romance with ${target.name} starts with the player.`;
  }
  if (target.awaiting) {
    return `${target.name} already has an advance waiting on an answer.`;
  }
  if (suitor.kind === "companion" && suitor.companionKind === "guest") {
    return `${suitor.name} is a guest ally for one scene and does not court anyone.`;
  }
  if (suitor.status !== "active") {
    return `${suitor.name} is not with the party right now.`;
  }
  if (!suitor.present) {
    return `${suitor.name} is not in this scene.`;
  }
  if (romanceIndex(suitor.romance) > romanceIndex("interested")) {
    return `${suitor.name} and ${target.name} are already past the first move.`;
  }
  if (tierIndex(friendshipTier(suitor.approval)) < tierIndex("friendly") || suitor.approval < ROMANCE_THRESHOLD[ADVANCE_TARGET]) {
    return `${suitor.name} does not feel enough for ${target.name} to court them (approval ${suitor.approval}; courting needs ${ROMANCE_THRESHOLD[ADVANCE_TARGET]}).`;
  }
  if (suitor.committedElsewhere) {
    return `${suitor.name} is already with someone else.`;
  }
  if (suitor.pendingAdvance) {
    return `${suitor.name} already has an advance waiting on an answer.`;
  }
  if (!attractionFits(suitor, target)) {
    return `${suitor.name} and ${target.name} are not drawn to each other's gender, so this is not that kind of moment.`;
  }
  return null;
}

// The best suitor: the one who feels most, then the warmest person, then by
// name so the same table always picks the same one.
export function pickSuitor(suitors: readonly Suitor[], target: AdvanceTarget): Suitor | null {
  const ahead = (a: Suitor, b: Suitor) => b.approval - a.approval || b.warmth - a.warmth || compareNames(a.name, b.name);
  return suitors
    .filter((suitor) => suitorProblem(suitor, target) === null)
    .reduce<Suitor | null>((best, suitor) => (!best || ahead(suitor, best) < 0 ? suitor : best), null);
}

// ---- the move ----

export type AdvanceCheck = {
  // The move needs an open window, except from a person at a human-run table.
  windowOpen: boolean;
  fromConsole: boolean;
  safety: string | null;
  to: RomanceStage | undefined;
};

// Why a call of romance_advance with initiator "npc" is refused, or null.
export function npcAdvanceProblem(suitor: Suitor, target: AdvanceTarget, check: AdvanceCheck): string | null {
  if (check.safety) {
    return check.safety;
  }
  if (check.to && check.to !== ADVANCE_TARGET) {
    return `An NPC's first move is always the open step to courting; leave "to" as courting.`;
  }
  const problem = suitorProblem(suitor, target);
  if (problem) {
    return problem;
  }
  if (!check.windowOpen && !check.fromConsole) {
    return `${suitor.name} is not ready to make a move toward ${target.name}: only the server opens that moment, and it has not. Play their warmth without a romantic step; ${target.name}'s player may still make one.`;
  }
  return null;
}

// Who settles an advance: its answer is the character's own player's alone
// (an offer's lead may otherwise answer for a player, proposal-logic.ts
// canResolveProposal); the lead may only withdraw it.
export function canResolveAdvance(action: "approve" | "decline" | "cancel", actorIsOwner: boolean, actorIsLead: boolean): boolean {
  return action === "cancel" ? actorIsLead : actorIsOwner;
}

// ---- what the DM, the table and the card say ----

// The DM-only director note while a window is open. `undecided`: who the
// suitor is drawn to was never set, so the DM is asked to settle it, once.
export function advanceCue(suitorName: string, characterName: string, turnsLeft: number, undecided = false): string {
  return `${suitorName} is ready to make a romantic move toward ${characterName} if this scene allows it: play the moment, then romance_advance with initiator npc (subject ${suitorName}, their own words in note). Never decide how ${characterName} feels; ${characterName}'s player answers. ${turnsLeft === 1 ? "This is the last reply it stays open." : `It stays open for ${turnsLeft} more replies.`}${undecided ? ` Who ${suitorName} is drawn to is not settled yet: settle it with set_npc drawnTo, and it stays.` : ""}`;
}

export function advanceSummary(suitorName: string, characterName: string): string {
  return `${suitorName} asks to court ${characterName}`;
}

export type AdvanceResolution = "approved" | "declined" | "cancelled" | "expired";

// The table note an answer leaves, after OFFER_NOTE_PREFIX. The DM reads it
// as the answer, so it never infers one.
export function advanceResolutionNote(status: AdvanceResolution, suitorName: string, characterName: string): string {
  switch (status) {
    case "approved":
      return `${characterName} said yes to ${suitorName}: they are now openly courting.`;
    case "declined":
      return `${characterName} turned ${suitorName} down. ${suitorName} does not ask again for now.`;
    case "cancelled":
      return `${suitorName}'s advance toward ${characterName} was withdrawn. Nothing changed between them.`;
    case "expired":
      return `${characterName} gave ${suitorName} no answer, and the moment passed. Nothing changed between them.`;
  }
}

// The relationship rules' line, only while somebody at the table is open.
export function advanceRulesLine(openNames: readonly string[]): string {
  if (!openNames.length) {
    return "";
  }
  return `- One exception to the player leading: ${openNames.join(", ")} ${openNames.length === 1 ? "is" : "are"} open to advances from NPCs. Even then an NPC or companion makes a first move ONLY when a director note says one is ready, toward that character, and only through romance_advance with initiator npc (their words in note). Narrate the approach; never narrate the answer. The player answers on their screen and the table note tells you how.`;
}
