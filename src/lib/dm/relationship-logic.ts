// Pure relationship logic, kept free of alias imports so node test scripts
// (scripts/test-relationships.mjs) can load it directly.
//
// One approval meter per character-and-subject pair, spanning open hostility
// through devotion, with romance as an explicit ladder gated behind it. This
// replaces three partial records of the same thing: a party-wide attitude
// (which stays, since it is 5e social-interaction RAW), a coarse -3..+3 bond
// buried on the NPC row, and a romance-only meter that had nowhere to put
// "this person cannot stand you".
//
// The part that makes a meter feel like a person rather than a bar: every
// beat names the personality axis that judges it, and the delta is modulated
// by the subject's own axes (src/lib/dm/npc-logic.ts). Sparing a prisoner
// wins over the kind healer and offends the hard-bitten mercenary from the
// same call, for free, with no model involvement.
//
// Everything here is deterministic given its inputs; dice arrive as injected
// rolls.

export const APPROVAL_MIN = -100;
export const APPROVAL_MAX = 100;

// ---- friendship tiers ----

// Tiers are DERIVED from the meter and never stored, so the word and the
// number can never disagree. Worst to best; a tier comparison is an index
// comparison.
export const FRIENDSHIP_TIERS = [
  "hostile",
  "disliked",
  "wary",
  "neutral",
  "cordial",
  "friendly",
  "close",
  "devoted",
] as const;
export type FriendshipTier = (typeof FRIENDSHIP_TIERS)[number];

// The floor of each tier, best first so the first match wins.
const TIER_FLOORS: Array<[FriendshipTier, number]> = [
  ["devoted", 85],
  ["close", 60],
  ["friendly", 30],
  ["cordial", 10],
  ["neutral", -9],
  ["wary", -24],
  ["disliked", -59],
  ["hostile", APPROVAL_MIN],
];

export function friendshipTier(approval: number): FriendshipTier {
  for (const [tier, floor] of TIER_FLOORS) {
    if (approval >= floor) {
      return tier;
    }
  }
  return "hostile";
}

export function tierIndex(tier: FriendshipTier): number {
  const index = FRIENDSHIP_TIERS.indexOf(tier);
  return index === -1 ? 0 : index;
}

export const TIER_LABEL: Record<FriendshipTier, string> = {
  hostile: "hostile, an enemy in all but name",
  disliked: "dislikes them",
  wary: "wary of them",
  neutral: "neutral",
  cordial: "cordial",
  friendly: "friendly",
  close: "close, a trusted friend",
  devoted: "devoted",
};

// ---- the romance ladder ----

export const ROMANCE_STAGES = [
  "none",
  "interested",
  "courting",
  "together",
  "betrothed",
  "married",
] as const;
export type RomanceStage = (typeof ROMANCE_STAGES)[number];

// The approval each rung needs. Nobody is romanced into liking someone: the
// floors sit above the 'friendly' tier on purpose.
export const ROMANCE_THRESHOLD: Record<RomanceStage, number> = {
  none: 0,
  interested: 40,
  courting: 55,
  together: 70,
  betrothed: 85,
  married: 95,
};

// A second, explicit gate so that retuning the floors above can never make a
// disliked character romanceable by arithmetic alone.
export const ROMANCE_MIN_TIER: FriendshipTier = "friendly";

export const ROMANCE_LABEL: Record<RomanceStage, string> = {
  none: "nothing romantic",
  interested: "quietly interested",
  courting: "openly courting",
  together: "partners",
  betrothed: "betrothed",
  married: "married",
};

export const RELATIONSHIP_STATUSES = ["active", "parted", "ended"] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export function romanceIndex(stage: RomanceStage): number {
  const index = ROMANCE_STAGES.indexOf(stage);
  return index === -1 ? 0 : index;
}

export function nextRomanceStage(stage: RomanceStage): RomanceStage | null {
  return ROMANCE_STAGES[romanceIndex(stage) + 1] ?? null;
}

export function previousRomanceStage(stage: RomanceStage): RomanceStage {
  return ROMANCE_STAGES[Math.max(0, romanceIndex(stage) - 1)];
}

export function parseRomance(raw: unknown): RomanceStage {
  return (ROMANCE_STAGES as readonly string[]).includes(String(raw))
    ? (String(raw) as RomanceStage)
    : "none";
}

export function parseStatus(raw: unknown): RelationshipStatus {
  return (RELATIONSHIP_STATUSES as readonly string[]).includes(String(raw))
    ? (String(raw) as RelationshipStatus)
    : "active";
}

// ---- beats ----

export type PersonalityAxis =
  | "drive"
  | "diligence"
  | "boldness"
  | "warmth"
  | "empathy"
  | "composure";

export type BeatSpec = {
  // Approval at a clean landing, before personality. Negative for the
  // things that cost you.
  base: number;
  // The axis that judges this deed, and how it reads it: +1 means people
  // high in that axis approve, -1 means they are the ones who mind. A beat
  // with no axis is one nobody is indifferent to (a betrayal, an insult).
  axis?: PersonalityAxis;
  axisSign?: 1 | -1;
  // Checked beats are attempts to charm and roll a real skill; a deed has
  // already happened and simply counts.
  skill?: "persuasion" | "performance";
  track: "social" | "romantic";
  // Refused below this rung of the romance ladder.
  minRomance?: RomanceStage;
  label: string;
};

export const RELATIONSHIP_BEATS = {
  // Things that earn regard.
  helped: { base: 6, axis: "empathy", axisSign: 1, track: "social", label: "helped" },
  kept_word: { base: 7, axis: "diligence", axisSign: 1, track: "social", label: "kept their word to" },
  generosity: { base: 5, axis: "warmth", axisSign: 1, track: "social", label: "was generous to" },
  mercy: { base: 6, axis: "empathy", axisSign: 1, track: "social", label: "showed mercy in front of" },
  courage: { base: 7, axis: "boldness", axisSign: 1, track: "social", label: "showed courage beside" },
  honesty: { base: 5, axis: "diligence", axisSign: 1, track: "social", label: "was straight with" },
  defended: { base: 9, axis: "warmth", axisSign: 1, track: "social", label: "stood up for" },
  shared_peril: { base: 5, axis: "boldness", axisSign: 1, track: "social", label: "came through danger with" },
  confided: { base: 5, axis: "empathy", axisSign: 1, track: "social", label: "confided in" },
  gift: { base: 5, axis: "warmth", axisSign: 1, skill: "persuasion", track: "social", label: "gave a gift to" },
  // Things that cost you.
  broke_word: { base: -9, axis: "diligence", axisSign: -1, track: "social", label: "broke their word to" },
  cruelty: { base: -10, axis: "empathy", axisSign: -1, track: "social", label: "was cruel in front of" },
  greed: { base: -6, axis: "warmth", axisSign: -1, track: "social", label: "put profit above" },
  deceit: { base: -7, axis: "diligence", axisSign: -1, track: "social", label: "was caught deceiving" },
  cowardice: { base: -6, axis: "boldness", axisSign: -1, track: "social", label: "left the hard part to" },
  // A bold companion minds far less that you dragged them into danger.
  endangered: { base: -8, axis: "boldness", axisSign: 1, track: "social", label: "put in danger" },
  ignored: { base: -4, track: "social", label: "brushed off" },
  insult: { base: -8, track: "social", label: "wounded the feelings of" },
  betrayal: { base: -25, track: "social", label: "betrayed" },
  // Romance. flirt is how the romantic track opens; the rest need it open.
  flirt: { base: 4, skill: "persuasion", track: "romantic", label: "flirted with" },
  compliment: {
    base: 3,
    axis: "warmth",
    axisSign: 1,
    skill: "persuasion",
    track: "romantic",
    minRomance: "interested",
    label: "complimented",
  },
  grand_gesture: {
    base: 9,
    skill: "performance",
    track: "romantic",
    minRomance: "interested",
    label: "made a grand gesture for",
  },
  intimacy: { base: 8, track: "romantic", minRomance: "together", label: "spent the night with" },
} as const satisfies Record<string, BeatSpec>;

export type RelationshipBeat = keyof typeof RELATIONSHIP_BEATS;

export const RELATIONSHIP_BEAT_NAMES = Object.keys(RELATIONSHIP_BEATS) as RelationshipBeat[];

export function beatSpec(beat: string): BeatSpec | null {
  return (RELATIONSHIP_BEATS as Record<string, BeatSpec>)[beat] ?? null;
}

export type BeatOutcome = "strong" | "good" | "weak" | "miss";

// The more they already think of you, the easier a charming word lands.
export function beatDc(approval: number): number {
  return Math.max(8, Math.min(20, 15 - Math.round(approval / 12)));
}

export function beatOutcome(total: number, dc: number): BeatOutcome {
  if (total >= dc + 5) {
    return "strong";
  }
  if (total >= dc) {
    return "good";
  }
  if (total >= dc - 5) {
    return "weak";
  }
  return "miss";
}

export type Personality = Record<PersonalityAxis, number> | null;

// How well a deed suits the person judging it, -3..3. Positive means it is
// the sort of thing they like; negative means it grates.
export function beatAlignment(spec: BeatSpec, personality: Personality): number {
  if (!spec.axis || !personality) {
    return 0;
  }
  const value = personality[spec.axis] ?? 0;
  return Math.max(-3, Math.min(3, value * (spec.axisSign ?? 1)));
}

// Repeating the same move stops working: the second identical gift is worth
// well under half the first and the fourth is worth nothing. Counts halve at
// each chapter close, so a friendship built across a story keeps full weight
// while a burst of flattery in one scene does not.
const REPEAT_FACTOR = [1, 0.6, 0.3, 0];

export type BeatContext = {
  approval: number;
  // How many times this same beat already landed since the last decay.
  repeats: number;
  personality: Personality;
  // Their standing toward the whole party; a hostile NPC discounts kindness.
  hostile: boolean;
};

// The approval a beat moves.
export function beatDelta(
  beat: RelationshipBeat,
  outcome: BeatOutcome | null,
  context: BeatContext,
): number {
  const spec = RELATIONSHIP_BEATS[beat] as BeatSpec;
  let value = spec.base;
  if (spec.base > 0) {
    if (outcome === "strong") {
      value = spec.base + 2;
    } else if (outcome === "weak") {
      value = Math.ceil(spec.base / 2);
    } else if (outcome === "miss") {
      // A clumsy pass costs a little, and nothing softens or worsens that.
      return -1;
    }
  }

  // Personality: a deed strongly against someone's grain flips a kindness
  // into an irritation, and a transgression they secretly share loses half
  // its sting. Anything milder just nudges by the axis value.
  const alignment = beatAlignment(spec, context.personality);
  if (value > 0) {
    value = alignment <= -2 ? -Math.ceil(value / 2) : value + alignment;
  } else {
    value = alignment >= 2 ? Math.ceil(value / 2) : value + alignment;
  }

  if (value <= 0) {
    return value;
  }
  if (context.hostile) {
    value = Math.floor(value / 2);
  }
  const factor = REPEAT_FACTOR[Math.min(Math.max(context.repeats, 0), REPEAT_FACTOR.length - 1)];
  return Math.max(0, Math.round(value * factor));
}

export function applyApproval(approval: number, delta: number): number {
  return Math.max(APPROVAL_MIN, Math.min(APPROVAL_MAX, Math.round(approval + delta)));
}

// The old per-character NPC bond was a -3..+3 score; this is the conversion
// the one-time backfill uses so an existing grudge or friendship arrives on
// the new meter at the tier it always meant (src/lib/db/core.ts).
export function approvalFromBond(score: number): number {
  return Math.max(APPROVAL_MIN, Math.min(APPROVAL_MAX, Math.round(score) * 15));
}

// A romance the meter no longer supports slips back, but only the rungs that
// are still just feeling: a betrothal or a marriage is a promise, and a
// promise ends through the story (relationship_end), never by arithmetic.
// The 10-point grace keeps one bad scene from demoting anyone.
export function demoteRomance(stage: RomanceStage, approval: number): RomanceStage {
  if (romanceIndex(stage) >= romanceIndex("betrothed")) {
    return stage;
  }
  let current = stage;
  while (current !== "none" && approval < ROMANCE_THRESHOLD[current] - 10) {
    current = previousRomanceStage(current);
  }
  return current;
}

// ---- advancing the romance ladder ----

export type AdvanceCheck = { ok: true; target: RomanceStage } | { ok: false; reason: string };

export function canAdvanceRomance(
  stage: RomanceStage,
  target: RomanceStage,
  approval: number,
  status: RelationshipStatus,
): AdvanceCheck {
  if (status === "ended") {
    return { ok: false, reason: "That relationship is over; it cannot be advanced." };
  }
  const expected = nextRomanceStage(stage);
  if (!expected) {
    return { ok: false, reason: "They are already married; there is no further step." };
  }
  if (target !== expected) {
    return {
      ok: false,
      reason: `Romance moves one step at a time: from ${stage} the only next step is ${expected}.`,
    };
  }
  const tier = friendshipTier(approval);
  if (tierIndex(tier) < tierIndex(ROMANCE_MIN_TIER)) {
    return {
      ok: false,
      reason: `${tier === "hostile" || tier === "disliked" ? "They do not even like them" : "They barely know them"} (${TIER_LABEL[tier]}). Nobody is courted into liking someone: build the friendship first.`,
    };
  }
  const needed = ROMANCE_THRESHOLD[target];
  if (approval < needed) {
    return {
      ok: false,
      reason: `Not enough between them yet: ${target} needs approval ${needed}, and it stands at ${approval}. Play out more between them first.`,
    };
  }
  return { ok: true, target };
}

export type ConsentResult = {
  accepted: boolean;
  // True when the feeling was so far past the bar that no roll was needed.
  automatic: boolean;
  total: number;
  dc: number;
};

export const CONSENT_DC = 12;
// Approval this far past the rung's threshold makes the answer a certainty.
const CONSENT_CERTAIN = 10;

// Whether the subject says yes. Comfortably past the threshold they simply
// do; right at it, it is a real question, weighted by how much they feel and
// how warm a person they are.
export function consentCheck(
  approval: number,
  target: RomanceStage,
  warmth: number,
  d20: number,
): ConsentResult {
  const needed = ROMANCE_THRESHOLD[target];
  if (approval >= needed + CONSENT_CERTAIN) {
    return { accepted: true, automatic: true, total: 0, dc: CONSENT_DC };
  }
  const total = d20 + Math.floor((approval - needed) / 2) + warmth;
  return { accepted: total >= CONSENT_DC, automatic: false, total, dc: CONSENT_DC };
}

// Being turned down stings without undoing the friendship.
export const REFUSAL_COST = -3;

// What a decisive social_check is worth on the meter, so persuading or
// bullying someone moves the same number every other interaction moves
// (src/lib/dm/social-tools.ts).
export const SOCIAL_CHECK_SWING = 8;

// Standing cuts both ways: someone who thinks well of a character is easier
// for that character to sway. Bounded to +/-4 so a friendship never trivializes
// a hard ask.
export function approvalRollModifier(approval: number): number {
  return Math.max(-4, Math.min(4, Math.round(approval / 25)));
}

// ---- beat counters (diminishing returns) ----

export type BeatCounts = Record<string, number>;

export function parseBeatCounts(raw: string): BeatCounts {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const counts: BeatCounts = {};
    for (const [key, value] of Object.entries(parsed ?? {})) {
      if (beatSpec(key)) {
        const count = Math.max(0, Math.floor(Number(value) || 0));
        if (count > 0) {
          counts[key] = Math.min(count, 9);
        }
      }
    }
    return counts;
  } catch {
    return {};
  }
}

export function bumpBeatCount(counts: BeatCounts, beat: string): BeatCounts {
  return { ...counts, [beat]: Math.min((counts[beat] ?? 0) + 1, 9) };
}

export function decayBeatCounts(counts: BeatCounts): BeatCounts {
  const next: BeatCounts = {};
  for (const [key, value] of Object.entries(counts)) {
    const decayed = Math.floor(value / 2);
    if (decayed > 0) {
      next[key] = decayed;
    }
  }
  return next;
}

// ---- memories and flags ----

export type RelationshipMemory = { kind: string; text: string; at: string };

export const MEMORY_LIMIT = 8;
const MEMORY_CHARS = 160;

export function parseMemories(raw: string): RelationshipMemory[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => entry && typeof entry.text === "string" && entry.text.trim())
      .slice(-MEMORY_LIMIT)
      .map((entry) => ({
        kind: typeof entry.kind === "string" ? entry.kind.slice(0, 40) : "moment",
        text: String(entry.text).trim().slice(0, MEMORY_CHARS),
        at: typeof entry.at === "string" ? entry.at : "",
      }));
  } catch {
    return [];
  }
}

export function addMemory(
  memories: RelationshipMemory[],
  memory: RelationshipMemory,
): RelationshipMemory[] {
  return [...memories, { ...memory, text: memory.text.trim().slice(0, MEMORY_CHARS) }].slice(
    -MEMORY_LIMIT,
  );
}

export function parseFlags(raw: string): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return [
      ...new Set(
        parsed
          .filter((entry) => typeof entry === "string" && entry.trim())
          .map((entry) => String(entry).trim().slice(0, 40)),
      ),
    ].slice(0, 12);
  } catch {
    return [];
  }
}

export function addFlag(flags: string[], flag: string): string[] {
  return flags.includes(flag) ? flags : [...flags, flag].slice(0, 12);
}

// ---- absence ----

// Chapters apart before someone who cares starts pulling on the story. The
// point of the counter is the reappearance: a person who loves a character
// does not simply stay off-screen forever.
export const REAPPEAR_AFTER = 3;

export function longingNote(
  subjectName: string,
  characterName: string,
  apartChapters: number,
  approval: number,
  romance: RomanceStage,
): string | null {
  if (apartChapters < REAPPEAR_AFTER) {
    return null;
  }
  // Only a bond with some weight behind it reaches across the map.
  const close = tierIndex(friendshipTier(approval)) >= tierIndex("close");
  const courting = romanceIndex(romance) >= romanceIndex("courting");
  if (!close && !courting) {
    return null;
  }
  return `Off-screen, ${subjectName} has gone ${apartChapters} chapters without seeing ${characterName} and feels the distance. Let them act on it: a letter, a messenger, word of where they have gone, or simply being there when the party next arrives somewhere they could plausibly be.`;
}

// ---- rendering ----

export type RelationshipLike = {
  characterName: string;
  subjectName: string;
  subjectKind: "npc" | "companion";
  approval: number;
  romance: RomanceStage;
  status: RelationshipStatus;
  apartChapters: number;
  memories: RelationshipMemory[];
};

// The instruction a soured bond earns in GAME STATE. A companion who cannot
// stand someone is a story problem the DM should be playing, so it says so
// outright; the server never removes a party member on its own.
export function souredNote(
  tier: FriendshipTier,
  subjectKind: "npc" | "companion",
  subjectName: string,
): string | null {
  if (tierIndex(tier) > tierIndex("disliked")) {
    return null;
  }
  if (subjectKind === "companion") {
    return `${subjectName} travels with people they cannot stand: have them argue, refuse favors, and say plainly they are close to walking. If it comes to that, use dismiss_companion`;
  }
  return `${subjectName} wants nothing to do with them and will not do them favors`;
}

// One bounded GAME STATE line per relationship. Capped so a large cast
// cannot crowd the block out.
export function relationshipFragment(relationship: RelationshipLike): string {
  const tier = friendshipTier(relationship.approval);
  const parts = [
    `${relationship.characterName} and ${relationship.subjectName} (${relationship.subjectKind})`,
    `${TIER_LABEL[tier]} (${relationship.approval > 0 ? "+" : ""}${relationship.approval})`,
  ];
  if (relationship.romance !== "none") {
    parts.push(`romance: ${ROMANCE_LABEL[relationship.romance]}`);
  }
  if (relationship.status === "parted") {
    parts.push(
      relationship.apartChapters > 0
        ? `apart from the party for ${relationship.apartChapters} chapter${relationship.apartChapters === 1 ? "" : "s"}`
        : "apart from the party",
    );
  } else if (relationship.status === "ended") {
    parts.push("ended");
  } else if (relationship.apartChapters >= REAPPEAR_AFTER) {
    parts.push(`not seen for ${relationship.apartChapters} chapters`);
  }
  const soured = souredNote(tier, relationship.subjectKind, relationship.subjectName);
  if (soured) {
    parts.push(soured);
  }
  const history = relationship.memories.slice(-3).map((memory) => memory.text);
  if (history.length) {
    parts.push(`history: ${history.join("; ")}`);
  }
  return parts.join(" | ").slice(0, 420);
}
