// Scheming NPCs (issue 501), the pure half: an NPC who only pretends to care
// for a character, for a motive of their own. No DB access and no "@/"
// imports, so scripts/test-schemes.mjs loads it directly; the rim is
// src/lib/dm/scheme-tools.ts (relationship_scheme, the Insight that sees
// through an act, the reveal).
//
// The shape of it. The act lives on the relationship row as a pretense: the
// motive, the approval the NPC SHOWS, when it began, who has seen through
// it, and whether it came out. It starts where they truly stand, so starting
// one changes nothing anyone at the table sees; the warmth has to be played,
// beat by beat, as a genuine bond is built. While it runs a warm beat lands
// on the warmth shown at its face value (an act always lands), the true
// meter moving as their nature takes it, and a cold beat moves both alike.
// Every outward rule reads the shown value (the romance ladder, the first
// move, a charm's DC, the standing a social check leans on), so an act is
// mechanically indistinguishable from the real thing; the true meter keeps
// moving underneath, because the AI has to play it. Who may see what is the
// storyteller tier (src/lib/dm/viewer.ts): the motive and the true value are
// the storyteller's alone, never the party lead's.
//
// Only a character whose player opened them to advances can be the mark, and
// only by someone they are drawn to, both ways: the same consent and fit an
// honest first move needs (src/lib/dm/advance-logic.ts). That is what makes a
// honey trap possible at all, and what keeps it from reaching a player who
// never asked to be courted.

import { APPROVAL_MAX, APPROVAL_MIN, friendshipTier, REPEAT_FACTOR, TIER_LABEL, type FriendshipTier } from "./relationship-logic.ts";
import { attractionFits, type Attraction } from "../attraction.ts";
import type { Gender } from "../gender.ts";

// ---- the pretense ----

export type Pretense = {
  // What they really want from the character ("the vault key").
  motive: string;
  // The approval they show. Moves with every change to the true meter, so
  // the act reacts to a gift or a slight exactly as the real feeling would.
  shown: number;
  // When the act began (ISO).
  started: string;
  // The characters who have seen through it (an Insight that beat the act),
  // by sheet id: their players were told, nobody else was.
  exposedTo: string[];
  // The truth came out to the whole table.
  revealed: boolean;
};

export const MOTIVE_MAX = 160;

const clampApproval = (value: number) => Math.max(APPROVAL_MIN, Math.min(APPROVAL_MAX, Math.round(value)));

export function parsePretense(raw: string | null | undefined): Pretense | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Pretense> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.motive !== "string" || typeof parsed.shown !== "number") {
      return null;
    }
    return {
      motive: parsed.motive.slice(0, MOTIVE_MAX),
      shown: clampApproval(parsed.shown),
      started: typeof parsed.started === "string" ? parsed.started : "",
      exposedTo: Array.isArray(parsed.exposedTo) ? [...new Set(parsed.exposedTo.map(String).filter(Boolean))] : [],
      revealed: parsed.revealed === true,
    };
  } catch {
    return null;
  }
}

export function serializePretense(pretense: Pretense | null): string {
  return pretense ? JSON.stringify(pretense) : "";
}

// An act still being kept up: there is one, and it has not come out.
export function actRunning(pretense: Pretense | null | undefined): pretense is Pretense {
  return Boolean(pretense && !pretense.revealed);
}

// The approval every outward rule reads: the act's while it runs, else the
// true meter.
export function outwardApproval(relationship: { approval: number; pretense?: Pretense | null }): number {
  return actRunning(relationship.pretense) ? relationship.pretense.shown : relationship.approval;
}

// An act begins where they truly stand: nothing the table sees changes until
// it is played.
export function startPretense(motive: string, trueApproval: number, at: string): Pretense {
  return {
    motive: motive.trim().replace(/\s+/g, " ").slice(0, MOTIVE_MAX),
    shown: clampApproval(trueApproval),
    started: at,
    exposedTo: [],
    revealed: false,
  };
}

// The true meter moved from `before` to `after`: the act shows the same
// change, so the gap between them holds.
export function followTrueMeter(pretense: Pretense, before: number, after: number): Pretense {
  if (!actRunning(pretense) || before === after) {
    return pretense;
  }
  return { ...pretense, shown: clampApproval(pretense.shown + (after - before)) };
}

// What a warm beat is worth to an act: its clean landing before anyone's
// nature or a missed roll weighs on it. Repeating the same move still pays
// less each time, as it does with anyone: an act that kept climbing on the
// fourth identical gift would be its own tell. A cold beat is worth nothing
// here; it moves the act as it moves the truth.
export function actFaceValue(base: number, repeats: number): number {
  if (base <= 0) {
    return 0;
  }
  const factor = REPEAT_FACTOR[Math.min(Math.max(repeats, 0), REPEAT_FACTOR.length - 1)];
  return Math.max(0, Math.round(base * factor));
}

// The act after one relationship_beat that moved the true meter from
// `before` to `after`: a warm beat lands on the warmth shown at its face
// value, whatever they truly feel; a cold one moves both alike.
export function actAfterBeat(pretense: Pretense, faceValue: number, before: number, after: number): Pretense {
  if (!actRunning(pretense)) {
    return pretense;
  }
  if (faceValue > 0) {
    return { ...pretense, shown: clampApproval(pretense.shown + faceValue) };
  }
  return followTrueMeter(pretense, before, after);
}

export function exposeTo(pretense: Pretense, characterIds: readonly string[]): Pretense {
  return { ...pretense, exposedTo: [...new Set([...pretense.exposedTo, ...characterIds])] };
}

export function revealPretense(pretense: Pretense): Pretense {
  return { ...pretense, revealed: true };
}

// ---- who may run an act on whom ----

export type Schemer = {
  name: string;
  kind: "npc" | "companion";
  status: "active" | "parted" | "ended";
  gender: Gender;
  attraction: Attraction | null;
  // An act this NPC is already keeping up, toward this character or another
  // (that character's name), or null.
  actToward: string | null;
};

export type Mark = {
  name: string;
  gender: Gender;
  attraction: Attraction | null;
  open: boolean;
  isCompanion: boolean;
};

// Why this NPC cannot begin an act toward this character, or null. `safety`
// is the reason the table's safety tools rule romance out, as an honest
// advance reads it (advance-logic.ts romanceSafetyBlock).
export function schemeStartProblem(schemer: Schemer, mark: Mark, safety: string | null): string | null {
  if (safety) {
    return `${safety} An act of romance is ruled out with it.`;
  }
  if (schemer.kind !== "npc") {
    return `${schemer.name} travels with the party; only an NPC keeps up an act like this.`;
  }
  if (mark.isCompanion) {
    return `${mark.name} is a companion; no player answers for them, so nobody plays at romance with them.`;
  }
  if (!mark.open) {
    return `${mark.name}'s player has not opened ${mark.name} to advances from NPCs, so no NPC plays at romance with ${mark.name}, honestly or not.`;
  }
  if (schemer.status === "ended") {
    return `${schemer.name} and ${mark.name} are finished; there is nothing left to pretend.`;
  }
  if (schemer.status === "parted") {
    return `${schemer.name} is not with the party right now.`;
  }
  if (schemer.actToward) {
    return `${schemer.name} is already keeping up an act toward ${schemer.actToward}. One at a time: reveal that one first.`;
  }
  if (!attractionFits(schemer, mark)) {
    return `${schemer.name} and ${mark.name} are not drawn to each other's gender, so a romantic act would not fit either of them.`;
  }
  return null;
}

export function schemeRevealProblem(subjectName: string, characterName: string, pretense: Pretense | null): string | null {
  if (!pretense) {
    return `${subjectName} keeps up no act toward ${characterName}; nothing to reveal.`;
  }
  if (pretense.revealed) {
    return `${subjectName}'s act toward ${characterName} has already come out.`;
  }
  return null;
}

// ---- seeing through it ----

// An NPC's Deception when no stat block gives one: from who they are, so the
// same person always lies equally well. Composure keeps a straight face,
// drive wants the lie to work, empathy makes it harder to tell. -3..+3 axes
// give +0 to +7, around +2 for an unremarkable person (a noble's +5 and a
// spy's +5 are the SRD's own).
export type NatureAxes = { drive: number; empathy: number; composure: number };

export function deceptionFromNature(axes: NatureAxes | null | undefined): number {
  if (!axes) {
    return 2;
  }
  const raw = 2 + axes.composure + Math.round((axes.drive - axes.empathy) / 2);
  return Math.max(0, Math.min(7, raw));
}

// ---- who sees what ----

export type BondViewer = {
  // The storyteller's tier (viewer.ts storytellerSees): the true meter, the
  // motive, everything.
  storyteller: boolean;
  // The viewer's own characters: an act one of them saw through is shown to
  // this viewer as the truth.
  ownedCharacterIds: readonly string[];
};

export type BondTruth = {
  // The meter this viewer reads.
  approval: number;
  // This viewer's character saw through the act: they read the truth.
  seenThrough: boolean;
  // The truth came out to everyone.
  unmasked: boolean;
  // The storyteller's own view of a running or past act.
  act: { motive: string; shown: number; shownTier: FriendshipTier; seenThroughBy: string[]; revealed: boolean } | null;
};

export function bondTruthFor(
  viewer: BondViewer,
  relationship: { approval: number; pretense?: Pretense | null },
): BondTruth {
  const pretense = relationship.pretense ?? null;
  if (!pretense) {
    return { approval: relationship.approval, seenThrough: false, unmasked: false, act: null };
  }
  const seenThrough = !pretense.revealed && pretense.exposedTo.some((id) => viewer.ownedCharacterIds.includes(id));
  const truth = viewer.storyteller || pretense.revealed || seenThrough;
  return {
    approval: truth ? relationship.approval : pretense.shown,
    seenThrough,
    unmasked: pretense.revealed,
    act: viewer.storyteller
      ? {
          motive: pretense.motive,
          shown: pretense.shown,
          shownTier: friendshipTier(pretense.shown),
          seenThroughBy: pretense.exposedTo,
          revealed: pretense.revealed,
        }
      : null,
  };
}

// ---- what the DM is told ----

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

// The storyteller-secret line for one running act, in the DM's game state.
export function actLine(subjectName: string, characterName: string, pretense: Pretense, seenThroughBy: readonly string[]): string {
  const seen = seenThroughBy.length ? ` Seen through by ${seenThroughBy.join(", ")} (told privately; the rest of the table does not know).` : "";
  return `${subjectName}'s warmth toward ${characterName} is an ACT: the table sees ${TIER_LABEL[friendshipTier(pretense.shown)]} (${signed(pretense.shown)}); the standing line above is the truth. Motive: ${pretense.motive}.${seen}`;
}

// The rules for playing an act, said only while one runs.
export const SCHEME_RULES = [
  "Acts (storyteller secrets: never say aloud, in narration, a note or out of character, that an act is an act, or what it is for):",
  "- An act starts where they truly stand, and the table sees nothing change until you play it. Build it as a real bond is built: give the character chances to earn warmth (a favour asked of them, a confidence, a flirt) and record each with relationship_beat. While an act runs, every warm beat lands on the warmth the table sees at its face value, whatever they truly feel, and the true standing moves as their nature takes it; a cold beat moves both. A first move (romance_advance with initiator npc) waits, as anyone's does, for the warmth shown to reach courting.",
  "- Play the warmth the table sees, in every word and deed, and let the motive show only in what the schemer does off-screen or asks for.",
  "- A character may see through it: check_notice with sense insight and againstMonster set to the schemer's name. The server rolls the schemer's Deception and tells whoever beats it, privately.",
  "- The truth comes out to everyone through relationship_scheme with action reveal; a betrayal that ends the bond is relationship_end with reason betrayal and by npc.",
].join("\n");

// What a tool result adds while an act runs, so the AI never mistakes the
// shown warmth for the real thing, or the real thing for what to play.
export function actNote(subjectName: string, characterName: string, pretense: Pretense): string {
  return `${subjectName}'s warmth toward ${characterName} is an act: the table sees ${TIER_LABEL[friendshipTier(pretense.shown)]} (${signed(pretense.shown)}). Play that; the approval above is the truth, for you alone.`;
}

// The private line to a player whose character saw through it. `markName`
// is the character the act is aimed at, who may be this one.
export function seenThroughWhisper(characterName: string, subjectName: string, markName: string): string {
  return `${characterName} sees through ${subjectName}: the warmth ${subjectName} shows ${markName} is an act. Only you know.`;
}
