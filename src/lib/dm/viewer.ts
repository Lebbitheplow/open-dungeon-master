// Who is allowed to see and do what, in one place.
//
// ODM has always had per-feature visibility rules: publicEncounter strips
// enemy numbers, the battle-map GET fogs per character, publicCampaign strips
// the secret arc, the arc and context routes sit behind a lead gate. Each of
// those is individually right, and each was written against a table where the
// only non-player was the AI.
//
// Human-DM mode adds a viewer who is *allowed* the secrets, which is exactly
// the shape of change where one forgotten branch leaks the arc to a player or
// hides enemy HP from the person running the fight. So the decision lives
// here, as one pure function over the campaign's seats, and every projection
// asks it rather than testing ids itself.
//
// Pure by design: no "@/" imports and no I/O, so scripts/test-viewer-roles.mjs
// can import it directly.

export type DmMode = "ai" | "human" | "assisted";

// "ai" is not a user; it is the role the server assumes when it assembles the
// DM prompt, so prompt building reads the same rules the UI does.
export type ViewerRole = "player" | "lead" | "dm" | "ai";

// The seats a campaign has. Deliberately a plain record rather than the
// Campaign type, so this module stays free of DB imports.
export type CampaignSeats = {
  ownerUserId: string;
  leadUserId: string;
  // Null in an AI-run campaign.
  humanDmUserId: string | null;
  // A co-DM with the same in-game powers. Null when unused.
  assistantDmUserId: string | null;
  dmMode: DmMode;
};

export type ViewerCaps = {
  role: ViewerRole;
  // The story's secret spine: dmOutline, storyArc, the context trace, and
  // DM-only facts. In an AI campaign the party lead holds this, because the
  // lead is who steers the AI. In a human-DM campaign the lead is just a
  // player and only the DM holds it.
  secretStory: boolean;
  // Real enemy hit points, AC and stat blocks, rather than health words.
  enemyNumbers: boolean;
  // The battle map without fog of war.
  fullMap: boolean;
  // Story authority: floor control, lead directions, arc edits, force-ending
  // an encounter. Follows secretStory for the same reason.
  steersStory: boolean;
  // May post DM narration into the transcript.
  narrates: boolean;
  // May invoke engine adjudications directly (Phase 2's console).
  adjudicates: boolean;
  // The DM runs no character and holds no party slot.
  needsCharacter: boolean;
  countsInParty: boolean;
};

// True when the AI writes the narration. "assisted" still counts: the AI
// narrates the parts the DM delegates, so the turn pipeline stays wired.
export function narratorIsAi(mode: DmMode): boolean {
  return mode !== "human";
}

// True when a person holds the DM seat, so player actions queue for them
// instead of waking a DM turn.
export function hasHumanDm(seats: CampaignSeats): boolean {
  return seats.dmMode !== "ai" && Boolean(seats.humanDmUserId);
}

export function isDmSeat(seats: CampaignSeats, userId: string): boolean {
  if (seats.dmMode === "ai") {
    return false;
  }
  return userId === seats.humanDmUserId || userId === seats.assistantDmUserId;
}

// The DM proper, as distinct from a co-DM. Both hold every in-game power
// (isDmSeat counts them the same), and this is the one thing that separates
// them: handing the game to someone else is the boss's call, not a deputy's.
export function isPrimaryDm(seats: CampaignSeats, userId: string): boolean {
  return seats.dmMode !== "ai" && userId === seats.humanDmUserId;
}

export function viewerRoleFor(seats: CampaignSeats, userId: string): ViewerRole {
  if (isDmSeat(seats, userId)) {
    return "dm";
  }
  return userId === seats.leadUserId ? "lead" : "player";
}

const PLAYER_CAPS = {
  secretStory: false,
  enemyNumbers: false,
  fullMap: false,
  steersStory: false,
  narrates: false,
  adjudicates: false,
  needsCharacter: true,
  countsInParty: true,
} as const;

export function capsForRole(role: ViewerRole, mode: DmMode): ViewerCaps {
  if (role === "ai") {
    return {
      role,
      secretStory: true,
      enemyNumbers: true,
      fullMap: true,
      steersStory: true,
      narrates: true,
      adjudicates: true,
      needsCharacter: false,
      countsInParty: false,
    };
  }
  if (role === "dm") {
    return {
      role,
      secretStory: true,
      enemyNumbers: true,
      fullMap: true,
      steersStory: true,
      narrates: true,
      adjudicates: true,
      needsCharacter: false,
      countsInParty: false,
    };
  }
  if (role === "lead") {
    // The lead steers the AI, so in an AI campaign they hold the story's
    // secrets exactly as they do today. Once a person is running the game the
    // lead is a player again: the secrets are the DM's, and "Direct" (a note
    // aimed at the AI) has nothing to aim at.
    const steers = mode === "ai";
    return { ...PLAYER_CAPS, role, secretStory: steers, steersStory: steers };
  }
  return { ...PLAYER_CAPS, role };
}

export function viewerCaps(seats: CampaignSeats, userId: string): ViewerCaps {
  return capsForRole(viewerRoleFor(seats, userId), seats.dmMode);
}

// The role the server uses when it builds the AI DM's prompt.
export const AI_CAPS: ViewerCaps = capsForRole("ai", "ai");

// How many of a campaign's members occupy a party slot. The DM seats do not,
// so a five-player cap still means five players.
export function partySlotCount(seats: CampaignSeats, memberUserIds: string[]): number {
  return memberUserIds.filter((id) => !isDmSeat(seats, id)).length;
}

// ---- roll visibility ----

// A roll as one seat may see it. Every roll ODM has ever made is "public",
// and that stays the default; the other modes exist because a person running
// a table has always had a screen to roll behind, and taking that away is
// not "enforcing the rules", it is losing a tool.
//
// `blind` is the interesting one: the table SEES that a roll happened and
// what it was for, which is the tension a hidden roll is for, and does not
// see the number. Redacting rather than withholding is deliberate, because a
// roll that simply vanished would read as a bug.
export type RollView = {
  visibility: "public" | "dm" | "blind" | "self";
  characterId: string | null;
};

export type RollAccess = "full" | "redacted" | "hidden";

export function rollAccessFor(
  roll: RollView,
  caps: Pick<ViewerCaps, "adjudicates" | "steersStory">,
  // The sheets this viewer owns; a "self" roll is theirs to see.
  ownedCharacterIds: string[] = [],
): RollAccess {
  if (roll.visibility === "public") {
    return "full";
  }
  // Whoever is adjudicating rolled it, or asked for it: they see everything.
  if (caps.adjudicates || caps.steersStory) {
    return "full";
  }
  if (roll.visibility === "blind") {
    return "redacted";
  }
  if (roll.visibility === "self") {
    return roll.characterId && ownedCharacterIds.includes(roll.characterId)
      ? "full"
      : "hidden";
  }
  return "hidden";
}

// The projection a player receives. A redacted roll keeps everything that
// says a roll happened and drops everything that says how it went.
export function redactRoll<
  T extends RollView & {
    total: number;
    success: boolean | null;
    breakdown: unknown;
    dc: number | null;
  },
>(roll: T): Omit<T, "total" | "success" | "breakdown" | "dc"> & {
  total: null;
  success: null;
  breakdown: null;
  dc: null;
  hidden: true;
} {
  return { ...roll, total: null, success: null, breakdown: null, dc: null, hidden: true };
}
