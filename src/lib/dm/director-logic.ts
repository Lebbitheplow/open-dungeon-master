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

// Shared preamble for every one-shot, adapted from NE-P's
// SHARED_INTRODUCTION_RULES (src/services/oneshot/oneShotEvents.ts, MIT).
// The failure mode it prevents is the model treating "introduce an event" as
// licence to cut away, which throws out whatever the party was in the middle
// of. The "even cliché is fine" clause is theirs and is load-bearing: without
// it models reach for novelty and produce a bizarre entrance rather than a
// natural one. The genre clause stops a fantasy table getting sci-fi
// furniture because the model liked the idea.
const ONE_SHOT_INTRODUCTION_RULES = `Introduction rules, binding:
- The event must emerge from the CURRENT scene. Do not cut away, teleport the party, or restart the scene. Bridge into it with one of: an interruption (something breaks into the current beat), a discovery (something nearby only now noticed), a summons (someone or something pulls the party toward it), or an escalation (a detail already present sharpens into the hook). A familiar, even cliche entrance is fine; flowing naturally beats being original.
- Express the event entirely in this world's established genre, technology level, and tone. Never import furniture from another setting.
- The event INVITES; it does not hijack. End the introduction at the hook. The party may pursue, delay, or refuse it. Never narrate a player character's reaction or decision for them.`;

// Applies to both levers. The arc is ODM's spine (src/lib/dm/arc-logic.ts):
// exactly one beat is [NOW] and only the complete_beat tool may advance it and
// close a chapter. A one-turn nudge that quietly rewrote arc state would
// desynchronise the story structure from the transcript.
const DIRECTOR_SCOPE_RULES = `Scope: this applies to this turn only. Do not complete a story beat, do not advance or move the [NOW] marker, and do not rewrite the arc because of it. The engine still owns every number: ask for rolls with tools as usual and never decide or state an outcome yourself.`;

// Directives adapted from NE-P's ONE_SHOT_EVENT_TYPES registry
// (src/services/oneshot/oneShotEvents.ts, MIT). The instructions that carry
// the most weight are the ones about what the DM decides PRIVATELY: mystery's
// hidden true answer and windfall's undisclosed catch are what make those two
// produce a thread the campaign can pull on later, rather than a one-turn
// flourish that evaporates.
//
// `blurb` is NE-P's one-line dropdown description, kept because a bare label
// does not tell a lead what "weird" is actually going to do to their scene.
const ONE_SHOT_DIRECTIVES: Record<
  OneShotEventId,
  { label: string; blurb: string; directive: string }
> = {
  combat: {
    label: "Combat",
    blurb: "An immediate physical threat, here and now.",
    directive:
      "Introduce an immediate physical threat that engages the party within this scene. Scale it to the party's current means: dangerous enough to demand a response, resolvable within one to three scenes. Make the stakes clear up front, so it is obvious what winning, losing, or fleeing would each cost.",
  },
  location: {
    label: "Place",
    blurb: "A place to delve: layered, guarded, holding a prize.",
    directive:
      "Introduce a bounded site the party can enter now: a contained place with interior layers, a force or hazard that holds it, and something worth taking or learning at its heart. Resolvable within a few scenes of exploration.",
  },
  social: {
    label: "Social",
    blurb: "A predicament that cannot be solved by force.",
    directive:
      "Introduce a charged social predicament: a negotiation, an accusation, a plea, or a rivalry that pulls the party in and cannot be resolved by force. Someone wants something from them, or they have become entangled in something not of their making.",
  },
  romance: {
    label: "Romance",
    blurb: "Chemistry with a complication.",
    directive:
      "Introduce a charged romantic beat: someone whose interest in a party member carries a complication, whether rank, rivalry, a secret, or bad timing. Strongly prefer an NPC already established in the story over inventing a stranger. Chemistry plus obstacle; never instant devotion, and never decide how a player character feels in return.",
  },
  mystery: {
    label: "Mystery",
    blurb: "Something inexplicable, with a hidden true answer.",
    directive:
      "Introduce a small mystery: something inexplicable the party notices or stumbles into, such as an object out of place, a person acting impossibly, or a detail that contradicts what is known. Decide internally what the true explanation is and keep it hidden. Narrate only the surface evidence, and stay consistent with your hidden answer in future scenes.",
  },
  weird: {
    label: "Weird",
    blurb: "An absurd little obligation. Played straight.",
    directive:
      "Introduce a small absurd incident that saddles the party with an unwanted, comically mundane obligation. No real danger, no lasting stakes: a comedy of responsibility. Play it completely straight; the world does not acknowledge that it is funny.",
  },
  windfall: {
    label: "Windfall",
    blurb: "A gift with a string attached, not visible yet.",
    directive:
      "Introduce an unexpected opportunity, gift, or stroke of luck landing in the party's lap, with exactly one attached complication, condition, or string that is not immediately visible. Decide internally what the catch is and let it surface later or upon acceptance. Propose any item or coin through the usual tools rather than narrating it into their packs.",
  },
};

export function oneShotBlurb(id: OneShotEventId): string {
  return ONE_SHOT_DIRECTIVES[id].blurb;
}

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
