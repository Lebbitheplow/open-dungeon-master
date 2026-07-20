import type { Attitude } from "@/lib/db/npcs";

// Pure 5e social-interaction math: how hard a Charisma check is against an
// NPC's current attitude, when a check nudges that attitude, and how a first-
// meeting reaction roll seeds it. Kept dependency-light and table-driven so
// scripts/test-social.mjs can exercise it without a database.

// Worst to best, so a step is just an index move.
export const ATTITUDE_ORDER: readonly Attitude[] = ["hostile", "indifferent", "friendly"];

// The base DC to get an NPC to do what the party asks, set by how it already
// feels about them: a friendly NPC needs little convincing, a hostile one a
// great deal. Mirrors the DMG social-interaction guidance.
const ATTITUDE_DC: Record<Attitude, number> = {
  friendly: 10,
  indifferent: 15,
  hostile: 20,
};

export function socialCheckDc(attitude: Attitude): number {
  return ATTITUDE_DC[attitude];
}

// One step toward friendly (or hostile), clamped at the ends.
export function shiftAttitude(current: Attitude, direction: "up" | "down"): Attitude {
  const index = ATTITUDE_ORDER.indexOf(current);
  const next = direction === "up" ? index + 1 : index - 1;
  return ATTITUDE_ORDER[Math.max(0, Math.min(ATTITUDE_ORDER.length - 1, next))];
}

export type SocialOutcome = {
  success: boolean;
  // The attitude after this check, and whether it moved.
  attitude: Attitude;
  shifted: boolean;
  direction: "up" | "down" | null;
};

// Resolve a social check total against an attitude: meeting the DC succeeds,
// and a decisive result (beating it by 5, or missing by 5) nudges the NPC's
// attitude one step. A shift is only proposed here; the caller enforces the
// one-shift-per-exchange guard before committing it.
export function resolveSocialCheck(total: number, attitude: Attitude): SocialOutcome {
  const dc = socialCheckDc(attitude);
  const success = total >= dc;
  let direction: "up" | "down" | null = null;
  if (total >= dc + 5) {
    direction = "up";
  } else if (total <= dc - 5) {
    direction = "down";
  }
  const shifted = direction !== null && shiftAttitude(attitude, direction) !== attitude;
  return {
    success,
    attitude: direction ? shiftAttitude(attitude, direction) : attitude,
    shifted,
    direction: shifted ? direction : null,
  };
}

// First-meeting reaction from a 2d6 (+ modifier) roll: 5 or less is hostile,
// 9 or more is friendly, the middle is indifferent. A cleaned-up reading of
// the classic reaction table.
export function reactionAttitude(rollTotal: number): Attitude {
  if (rollTotal <= 5) {
    return "hostile";
  }
  if (rollTotal >= 9) {
    return "friendly";
  }
  return "indifferent";
}

// The social skill each approach rolls.
export const APPROACH_SKILL: Record<string, "persuasion" | "deception" | "intimidation"> = {
  persuade: "persuasion",
  persuasion: "persuasion",
  deceive: "deception",
  deception: "deception",
  lie: "deception",
  intimidate: "intimidation",
  intimidation: "intimidation",
  threaten: "intimidation",
};

export function approachSkill(approach: string): "persuasion" | "deception" | "intimidation" | null {
  return APPROACH_SKILL[approach.trim().toLowerCase()] ?? null;
}
