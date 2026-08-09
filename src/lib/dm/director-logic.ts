// Pure logic for the two director controls: a one-shot event injector and an
// absolute command. Both are steering levers the party lead arms before a
// turn; both are consumed by exactly one turn and then cleared. Neither costs
// an extra model call, because arming only stores text that the next turn's
// prompt splices in.
//
// Everything here is dependency-free so scripts/test-director.mjs can import
// it directly.

export type OneShotEventId =
  | "combat"
  | "location"
  | "social"
  | "romance"
  | "mystery"
  | "weird"
  | "windfall";

export const ONE_SHOT_EVENT_IDS: readonly OneShotEventId[] = [
  "combat",
  "location",
  "social",
  "romance",
  "mystery",
  "weird",
  "windfall",
];

// A free-text command competes with the campaign's own system prompt for the
// model's attention, and it rides last in the payload where it carries the
// most weight. Keeping it short keeps it a directive rather than a rewrite of
// the DM's brief.
export const MAX_ABSOLUTE_COMMAND_LENGTH = 600;

// Shared preamble for every one-shot. The failure mode this exists to prevent
// is the model treating "introduce an event" as licence to cut away: a hard
// scene transition throws away whatever the party was in the middle of, which
// is exactly what the lead did NOT ask for by pressing a one-turn button.
const ONE_SHOT_INTRODUCTION_RULES = `How to bring it in: it must grow out of the scene the party is standing in right now, by one of interruption, discovery, summons, or escalation. Never cut away, never skip time, and never move the party somewhere else to make it happen. It arrives as an invitation the party can engage, refuse, or ignore; it does not seize control of anyone's character or decide how they react.`;

// Applies to both levers. The arc is ODM's spine (src/lib/dm/arc-logic.ts):
// exactly one beat is [NOW] and only the complete_beat tool may advance it and
// close a chapter. A one-turn nudge that quietly rewrote arc state would
// desynchronise the story structure from the transcript.
const DIRECTOR_SCOPE_RULES = `Scope: this applies to this turn only. Do not complete a story beat, do not advance or move the [NOW] marker, and do not rewrite the arc because of it. The engine still owns every number: ask for rolls with tools as usual and never decide or state an outcome yourself.`;

const ONE_SHOT_DIRECTIVES: Record<OneShotEventId, { label: string; directive: string }> = {
  combat: {
    label: "Combat",
    directive:
      "Bring a credible physical threat into this scene. Something wants to hurt the party, or is already trying to. Give the party the beat of noticing before blows land, so they can still choose to fight, talk, or run.",
  },
  location: {
    label: "Place",
    directive:
      "Open up somewhere new from where the party already stands: a door that was not obvious, a path revealed, a structure that resolves out of the surroundings. Describe what makes it worth crossing into, and let them decide whether to.",
  },
  social: {
    label: "Social",
    directive:
      "Put a person in front of the party who wants something from them. Give them a want, a reason to approach these particular adventurers now, and a manner. They should complicate the scene by existing, not by attacking.",
  },
  romance: {
    label: "Romance",
    directive:
      "Sharpen an existing bond into a moment of genuine charge: a look held too long, a confession half made, a kindness that costs the giver something. Use an NPC the party already knows where you can. Never decide how a player character feels or responds.",
  },
  mystery: {
    label: "Mystery",
    directive:
      "Surface something that does not add up, and make the party notice it. A detail that contradicts what they were told, an absence where there should be presence, evidence of something that happened here first. Give them a thread to pull, not the answer.",
  },
  weird: {
    label: "Weird",
    directive:
      "Break the ordinary texture of the scene with something the party cannot immediately file away. It should unsettle rather than threaten, and it should feel like the world is larger and stranger than they assumed.",
  },
  windfall: {
    label: "Windfall",
    directive:
      "Let something go right for the party in a way they did not engineer: aid arriving, a resource uncovered, a debt repaid, a door opening. Earn it against something they did earlier if you can. Propose any item or coin through the usual tools rather than narrating it into their packs.",
  },
};

export function oneShotLabel(id: OneShotEventId): string {
  return ONE_SHOT_DIRECTIVES[id].label;
}

export function isOneShotEventId(value: unknown): value is OneShotEventId {
  return typeof value === "string" && (ONE_SHOT_EVENT_IDS as readonly string[]).includes(value);
}

export function clampAbsoluteCommand(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_ABSOLUTE_COMMAND_LENGTH);
}

export function buildOneShotDirective(id: OneShotEventId): string {
  const { directive } = ONE_SHOT_DIRECTIVES[id];
  return [
    "[System] The party lead has asked for one specific thing to happen in this scene.",
    directive,
    ONE_SHOT_INTRODUCTION_RULES,
    DIRECTOR_SCOPE_RULES,
  ].join("\n\n");
}

export function buildAbsoluteCommandDirective(command: string): string {
  const clamped = clampAbsoluteCommand(command);
  if (!clamped) {
    return "";
  }
  return [
    "[System] Direct instruction from the party lead, spoken to you and not to the world. No character hears this and it is not part of the story. It outranks every other steer you have been given for this turn; follow it.",
    clamped,
    DIRECTOR_SCOPE_RULES,
  ].join("\n\n");
}

export type DirectorArm = {
  oneShot: OneShotEventId | null;
  absoluteCommand: string;
};

// An absolute command deliberately suppresses a one-shot rather than stacking
// with it. Both are "this turn only" steers, and two competing directives in
// the same payload produce a turn that half-serves each. The lead's explicit
// words win over the canned event.
export function buildDirectorBlock(arm: DirectorArm | null): string {
  if (!arm) {
    return "";
  }
  const absolute = buildAbsoluteCommandDirective(arm.absoluteCommand);
  if (absolute) {
    return absolute;
  }
  if (arm.oneShot && isOneShotEventId(arm.oneShot)) {
    return buildOneShotDirective(arm.oneShot);
  }
  return "";
}

// True when an arm holds anything worth spending a turn on. An arm row that
// clamps down to nothing (whitespace-only command, no one-shot) is treated as
// disarmed so it cannot sit forever waiting to fire.
export function isArmed(arm: DirectorArm | null): boolean {
  return buildDirectorBlock(arm).length > 0;
}
