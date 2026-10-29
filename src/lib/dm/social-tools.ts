import { z } from "zod";
import { reactionBias } from "@/lib/dm/safety-logic";
import { reputationDcOffset } from "@/lib/dm/faction-logic";
import { getParty } from "@/lib/db/party";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { listActiveFacts } from "@/lib/db/facts";
import { renderWitnessNote } from "@/lib/dm/witness-logic";
import {
  getNpcByName,
  listCastNpcs,
  nearestNpcName,
  patchNpcAgency,
  setNpcAttitude,
  upsertNpc,
  type Attitude,
  type Npc,
} from "@/lib/db/npcs";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { meetNpc } from "@/lib/dm/party-bonds";
import { attractionFromTold, attractionWords, TOLD_ATTRACTION } from "@/lib/attraction";
import { agencyFragment, derivePersonality, driftPersonality, nearestNpcHint } from "@/lib/dm/npc-logic";
import { ensureRelationship, patchRelationship } from "@/lib/db/relationships";
import {
  applyApproval,
  approvalRollModifier,
  friendshipTier,
  SOCIAL_CHECK_SWING,
  TIER_LABEL,
} from "@/lib/dm/relationship-logic";
import { outwardApproval } from "@/lib/dm/scheme-logic";
import { publishRelationshipsUpdated } from "@/lib/dm/relationship-tools";
import type { DmTurn } from "@/lib/db/dm-turns";
import { TOLD_GENDER_HELP, TOLD_GENDERS, toldGender } from "@/lib/gender";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import {
  approachSkill,
  reactionAttitude,
  resolveSocialCheck,
  socialCheckDc,
} from "@/lib/dm/social";
import { resolveRollExpression, resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import type { RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { waypointProperty } from "@/lib/dm/waypoint-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

// The social-interaction engine: NPC disposition was pure narration with no
// state, so a shopkeeper the party bullied yesterday greeted them warmly today
// and a Charisma check "succeeded" whenever the model felt like it. set_npc
// records who an NPC is and how they feel; npc_reaction seeds a first meeting
// from a real 2d6 roll; social_check runs a Persuasion/Deception/Intimidation
// check against a DC set by the current attitude and shifts that attitude on a
// decisive result. This module imports the roll engine and the sheet layer.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const SOCIAL_TOOL_NAMES = ["set_npc", "npc_reaction", "social_check"] as const;

const ATTITUDE_ENUM = ["hostile", "indifferent", "friendly"] as const;

export const socialTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "set_npc",
      description:
        "Register or update a named NPC the party deals with, so the server tracks who they are and their attitude. Call it again when the story itself (not a check) changes how they feel.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...waypointProperty,
          name: { type: "string", description: "The NPC's name, unique within the campaign." },
          attitude: {
            type: "string",
            enum: [...ATTITUDE_ENUM],
            description:
              "How they currently feel about the party. Default: 'indifferent'. On someone already registered it means the party is dealing with them now: they are met, and how they feel about each character is tracked from then on. So give it there only for someone in the scene, never to preset how someone the party has not met feels.",
          },
          trait: {
            type: "string",
            description: "A short note on their personality or bond, for your own recall.",
          },
          location: { type: "string", description: "Where they are usually found." },
          gender: {
            type: "string",
            enum: [...TOLD_GENDERS],
            description: `${TOLD_GENDER_HELP} Give it when you register someone new; omit it on later calls.`,
          },
          drawnTo: {
            type: "array",
            items: { type: "string", enum: TOLD_ATTRACTION },
            description: "Who they could fall for, once the story shows it. The server keeps the first value it is given, so it never changes between characters.",
          },
          goal: {
            type: "string",
            description:
              "What they are working toward right now (a scheme, an errand, a hunt). The server advances it in the background between chapters, so give real NPCs real goals.",
          },
          ambition: {
            type: "string",
            description: "Their long-term defining want, if the story has revealed one.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "npc_reaction",
      description:
        "Roll a first-meeting reaction for a new NPC when it is uncertain how they take the party. The server rolls 2d6 (plus any modifier for the party's approach or reputation) and turns it into a starting attitude (hostile, indifferent, or friendly), registering the NPC with it. Call it instead of simply deciding how a stranger feels. Skip it when the story already fixes the NPC's stance (a sworn enemy, a hired ally). Someone the party has already dealt with, or whose attitude is already set, is not rolled again: the result reports how they feel.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...waypointProperty,
          name: { type: "string", description: "The new NPC's name." },
          modifier: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description:
              "A small +/- for the situation (a good first impression, a fearsome reputation). Usually -2 to +2.",
          },
          trait: { type: "string", description: "Short personality note." },
          location: { type: "string", description: "Where they are found." },
          gender: { type: "string", enum: [...TOLD_GENDERS], description: TOLD_GENDER_HELP },
        },
        required: ["name", "gender"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "social_check",
      description:
        "Resolve one character trying to sway a tracked NPC with words: friendly is easy, hostile is hard, and the attitude shifts at most once per exchange. Call it BEFORE narrating how the NPC responds; narrate exactly what it reports. The NPC must already exist (set_npc or npc_reaction first).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...waypointProperty,
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          npc: { type: "string", description: "The exact name of the tracked NPC." },
          approach: {
            type: "string",
            enum: ["persuade", "deceive", "intimidate"],
            description: "How they try to sway the NPC; picks the skill rolled.",
          },
          reason: { type: "string", description: "Short note on what they want from the NPC." },
        },
        required: ["characterId", "npc", "approach"],
      },
    },
  },
];

function publishRoll(campaignId: string, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}

// ---- agency bootstrap shared by set_npc and npc_reaction ----

// Fills in what registration can derive for free: a deterministic starting
// personality, the session goal / ambition the model supplied, and a link
// to the story arc's planned cast when the name matches (which also seeds
// the ambition from the cast agenda the arc pass wrote).
function bootstrapAgency(
  campaign: Campaign,
  npc: Npc,
  supplied: { goal?: string; ambition?: string },
): Npc {
  const patch: Parameters<typeof patchNpcAgency>[1] = {};
  if (!npc.agency.personality) {
    patch.personality = derivePersonality(npc.name, npc.attitude, npc.trait);
  }
  const cast = !npc.arcCastId
    ? campaign.storyArc?.cast?.find(
        (entry) =>
          entry.status !== "gone" &&
          textKey(entry.name) === textKey(npc.name),
      )
    : undefined;
  if (cast) {
    patch.arcCastId = cast.id;
  }
  const goals = { ...npc.agency.goals };
  let goalsChanged = false;
  if (supplied.goal?.trim()) {
    const text = supplied.goal.trim().slice(0, 200);
    if (goals.session?.text !== text) {
      goals.session = { text, progress: 0, target: 3 };
      goalsChanged = true;
    }
  }
  const ambition = supplied.ambition?.trim() || (!goals.ambition ? cast?.agenda?.trim() : "");
  if (ambition && goals.ambition !== ambition) {
    goals.ambition = ambition.slice(0, 300);
    goalsChanged = true;
  }
  if (goalsChanged) {
    patch.goals = goals;
  }
  if (!Object.keys(patch).length) {
    return npc;
  }
  return patchNpcAgency(npc.id, patch) ?? npc;
}

// ---- set_npc ----

const setNpcSchema = z.object({
  name: z.string().min(1).max(80),
  attitude: z.enum(["hostile", "indifferent", "friendly"]).optional(),
  trait: z.string().max(300).optional(),
  location: z.string().max(120).optional(),
  gender: z.enum(TOLD_GENDERS).optional(),
  drawnTo: z.array(z.string().max(40)).max(6).optional(),
  goal: z.string().max(300).optional(),
  ambition: z.string().max(300).optional(),
});

export function handleSetNpc(campaign: Campaign, rawArguments: string): ToolResult {
  let args: z.infer<typeof setNpcSchema>;
  try {
    args = setNpcSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: set_npc needs at least a name.", retry: true };
  }
  // gender is optional so an update need not restate it, which leaves a
  // registration free to forget it: the result then asks, never refuses.
  const before = getNpcByName(campaign.id, args.name);
  const untold = !args.gender && !before;
  const registered = bootstrapAgency(
    campaign,
    upsertNpc({
      campaignId: campaign.id,
      name: args.name,
      attitude: args.attitude,
      trait: args.trait,
      location: args.location,
      gender: toldGender(args.gender),
      // Written once (upsertNpc): the first answer is who they are.
      attraction: attractionFromTold(args.drawnTo),
    }),
    { goal: args.goal, ambition: args.ambition },
  );
  // The story bringing someone already registered into the party's dealings
  // (issue 580): an attitude it shifts, or one given for someone the party
  // has not met yet (the patron a bundle prepared as friendly, now
  // travelling with them). That is meeting them: marked met, as Npc.metAt
  // always said an attitude the story shifted would, and every character's
  // bond with them opens. Never on the first registration, which is also how
  // the GM notes a villain or a patron the party has only heard of.
  const shifted = Boolean(before && args.attitude && (args.attitude !== before.attitude || !before.metAt));
  const met = shifted ? meetNpc(campaign, registered, true) : { npc: registered, opened: 0 };
  if (met.opened) {
    publishRelationshipsUpdated(campaign.id);
  }
  const npc = met.npc;
  return {
    ok: true,
    npc: npc.name,
    attitude: npc.attitude,
    ...(npc.agency.goals.session ? { goal: npc.agency.goals.session.text } : {}),
    note: `${npc.name} is tracked as ${npc.attitude}. Their attitude persists until the story or a social_check changes it.${
      shifted ? ` The party has met them now, and how ${npc.name} feels about each character is tracked from here.` : ""
    }${untold ? " Their gender is not recorded: pass gender on a set_npc for them (Unknown if the story has not shown it)." : ""}`,
  };
}

// ---- npc_reaction ----

const reactionSchema = z.object({
  name: z.string().min(1).max(80),
  modifier: z.coerce.number().int().min(-10).max(10).optional(),
  trait: z.string().max(300).optional(),
  location: z.string().max(120).optional(),
  gender: z.enum(TOLD_GENDERS),
});

export function handleNpcReaction(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
): ToolResult {
  let args: z.infer<typeof reactionSchema>;
  try {
    args = reactionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: npc_reaction needs a name and a gender (Female, Male, Nonbinary or Unknown).", retry: true };
  }
  // A reaction roll decides how a stranger takes the party, once. Someone
  // the party has dealt with keeps the attitude play gave them, and so does
  // someone whose attitude was set before they were met (the story's
  // villain, the author's patron, a friendly keeper): only a stranger whose
  // attitude is still the default is rolled. A known name is answered with
  // how they feel, not refused, since the model asked how to play them.
  const known = getNpcByName(campaign.id, args.name);
  if (known && (known.metAt || known.attitude !== "indifferent")) {
    const met = meetNpc(
      campaign,
      upsertNpc({ campaignId: campaign.id, name: args.name, trait: args.trait, location: args.location, gender: toldGender(args.gender) }),
    );
    if (met.opened) {
      publishRelationshipsUpdated(campaign.id);
    }
    const npc = met.npc;
    return {
      ok: true,
      npc: npc.name,
      attitude: npc.attitude,
      rolled: false,
      note: known.metAt
        ? `${npc.name} already knows the party and is ${npc.attitude}; a first impression is not rolled twice. Narrate them true to it: a social_check, or set_npc when the story itself changes how they feel, moves it.`
        : `${npc.name}'s attitude was already set before this meeting: ${npc.attitude}. Narrate the greeting in that light: a social_check, or set_npc when the story itself changes how they feel, moves it.`,
    };
  }
  const modifier = args.modifier ?? 0;
  // A penalty is written as 2d6-3, never 2d6+-3, which no dice parser reads.
  const outcome = rollExpression(modifier ? `2d6${modifier < 0 ? "-" : "+"}${Math.abs(modifier)}` : "2d6");
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: null,
    requestedBy: "dm",
    kind: "custom",
    detail: `Reaction roll for ${args.name}`,
    result: outcome,
  });
  publishRoll(campaign.id, roll);
  turn.rollIds.push(roll.id);
  // Strictness leans the stranger a step (docs/vtt-parity-implementation-
  // plan.md 9.2): warmer when lenient, warier when harsh.
  const attitude = shiftAttitude(reactionAttitude(outcome.total), reactionBias(campaign.gameSettings.gm?.strictness ?? "standard"));
  const registered = upsertNpc({
    campaignId: campaign.id,
    name: args.name,
    attitude,
    trait: args.trait,
    location: args.location,
    gender: toldGender(args.gender),
  });
  // The roll is the meeting, and every character's bond with them opens.
  const met = meetNpc(campaign, registered);
  if (met.opened) {
    publishRelationshipsUpdated(campaign.id);
  }
  const npc = bootstrapAgency(campaign, met.npc, {});
  return {
    ok: true,
    npc: npc.name,
    roll: outcome.total,
    attitude,
    note: `${npc.name} reacts as ${attitude} (2d6${modifier ? ` with ${modifier >= 0 ? "+" : ""}${modifier}` : ""} = ${outcome.total}). Narrate the greeting in that light.`,
  };
}

// ---- social_check ----

const socialCheckSchema = z.object({
  characterId: z.string(),
  npc: z.string().min(1),
  approach: z.enum(["persuade", "deceive", "intimidate"]),
  reason: z.string().optional(),
});

export function handleSocialCheck(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof socialCheckSchema>;
  try {
    args = socialCheckSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: social_check needs characterId, npc, and approach.", retry: true };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? getSheetById(stale.id) ?? stale : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  // A lasting companion is reached through the row behind their sheet
  // (#503 Phase 0.1), so a companion can be talked round like anyone else.
  const companion = sheets.find((entry) => entry.isCompanion && textKey(entry.name) === textKey(args.npc));
  const npc = (companion ? companionNpcFor(companion) : null) ?? getNpcByName(campaign.id, args.npc);
  if (!npc) {
    return {
      error: `No tracked NPC named "${args.npc}".${nearestNpcHint(nearestNpcName(campaign.id, args.npc))} Register them with set_npc or npc_reaction first.`,
      retry: true,
    };
  }
  const skill = approachSkill(args.approach);
  if (!skill) {
    return { error: "approach must be persuade, deceive, or intimidate.", retry: true };
  }

  // Held carriers (Bardic Inspiration, Help, Guidance) and lasting effects
  // ride this check like any other, and the carrier is spent by it.
  const resolved = resolveRollExpression(
    { kind: "skill_check", skill } as unknown as RollArgs,
    sheet,
    rollExtrasFor(campaign, sheet, "skill_check"),
  );
  if ("error" in resolved || "autoFail" in resolved) {
    return "error" in resolved ? resolved : { error: `${sheet.name} cannot make that check.`, refused: "rules" };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  // A faction's member leans on the party's standing with that faction
  // (docs/vtt-parity-implementation-plan.md section 6).
  const factionOffset = npc.factionId ? reputationDcOffset(getParty(campaign.id).reputation[npc.factionId] ?? 0) : 0;
  const dc = Math.max(5, socialCheckDc(npc.attitude) + factionOffset);
  // Attitude is how this NPC feels about the PARTY; the approval meter is how
  // they feel about THIS character. Standing with someone makes them easier
  // to sway, bounded to +/-4 so a friendship never trivializes a hard ask.
  const relationship = ensureRelationship({
    campaignId: campaign.id,
    characterId: sheet.id,
    characterName: sheet.name,
    subjectKind: npc.companionSheetId ? "companion" : "npc",
    subjectName: npc.name,
    subjectId: companion?.id ?? npc.id,
  });
  // An NPC keeping up an act is swayed as the warmth they show would be
  // (src/lib/dm/scheme-logic.ts): the roll's modifier is on the table.
  const standingModifier = approvalRollModifier(outwardApproval(relationship));
  const rolled = rollExpression(
    standingModifier === 0
      ? resolved.expression
      : `${resolved.expression}${standingModifier > 0 ? "+" : ""}${standingModifier}`,
  );
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "skill_check",
    detail: `${sheet.name}: ${skill} on ${npc.name}`,
    dc,
    result: rolled,
  });
  publishRoll(campaign.id, roll);
  turn.rollIds.push(roll.id);
  // Talking someone round, or failing to, is dealing with them; the first
  // time opens every character's bond with them, not only this one's.
  if (meetNpc(campaign, npc).opened) {
    publishRelationshipsUpdated(campaign.id);
  }

  const outcome = resolveSocialCheck(rolled.total, npc.attitude);
  // The one-shift-per-exchange guard: an attitude that already moved this
  // turn does not move again, so the model cannot ratchet a hostile NPC to
  // friendly with a burst of checks in a single reply.
  const alreadyShifted = npc.lastShiftTurn === turn.id;
  let finalAttitude = npc.attitude;
  let shifted = false;
  let approval = relationship.approval;
  if (outcome.shifted && !alreadyShifted) {
    const updated = setNpcAttitude(npc.id, outcome.attitude, turn.id);
    if (updated) {
      finalAttitude = updated.attitude;
      shifted = true;
      // A decisive exchange moves this character's own standing with them and
      // drifts the NPC's personality, under the same per-exchange guard.
      // Being talked around warms someone; being bullied or caught out does
      // the opposite, and the meter is where that is remembered.
      approval = applyApproval(
        approval,
        outcome.direction === "down" ? -SOCIAL_CHECK_SWING : SOCIAL_CHECK_SWING,
      );
      patchRelationship(relationship.id, { approval });
      publishRelationshipsUpdated(campaign.id);
      const personality =
        npc.agency.personality ?? derivePersonality(npc.name, npc.attitude, npc.trait);
      patchNpcAgency(npc.id, {
        personality: driftPersonality(personality, args.approach, outcome.direction ?? "up"),
      });
    }
  }

  return {
    ok: true,
    npc: npc.name,
    character: sheet.name,
    skill,
    roll: rolled.total,
    ...(standingModifier !== 0 ? { standingModifier } : {}),
    dc,
    success: outcome.success,
    startingAttitude: npc.attitude,
    attitude: finalAttitude,
    attitudeShifted: shifted ? outcome.direction : null,
    standing: friendshipTier(approval),
    note: buildSocialNote(sheet.name, npc.name, outcome.success, shifted, finalAttitude, outcome.direction, alreadyShifted && outcome.shifted, approval),
  };
}

function buildSocialNote(
  character: string,
  npc: string,
  success: boolean,
  shifted: boolean,
  attitude: Attitude,
  direction: "up" | "down" | null,
  guarded: boolean,
  approval: number,
): string {
  const base = success
    ? `${character} gets through to ${npc}: the check beats the DC. Narrate ${npc} yielding as far as ${attitude} disposition allows.`
    : `${character} fails to sway ${npc}. Narrate the refusal or the words falling flat.`;
  const standing = ` ${npc} stands ${TIER_LABEL[friendshipTier(approval)]} toward ${character} personally.`;
  if (shifted) {
    return `${base} ${npc} is now ${attitude} toward the party (${direction === "up" ? "warmer" : "more hostile"}).${standing}`;
  }
  if (guarded) {
    return `${base} ${npc}'s attitude already moved this exchange, so it holds at ${attitude}.${standing}`;
  }
  return `${base}${standing}`;
}

// A compact roster for the GAME STATE block: tracked NPCs, their attitude
// toward the party, and a bounded agency fragment (personality leans, goals,
// pressure). How they feel about individual characters is the approval meter
// and renders in its own section.
// `romance`: who they are drawn to rides only at a romance table.
export function npcRosterForPrompt(campaignId: string, options: { romance?: boolean } = {}): Array<{
  name: string;
  attitude: Attitude;
  trait: string;
  location: string;
  agency: string;
  aliases: string[];
  witnessNote: string;
  statBlock: string;
  identity: string;
}> {
  // Facts are read once for the whole roster; witness notes are per-NPC.
  const facts = listActiveFacts(campaignId).map((fact) => ({
    category: fact.category as string,
    subject: fact.subject,
    fact: fact.fact,
    witnessedBy: fact.witnessedBy,
  }));
  // Archived NPCs stay out of the prompt until someone names them again
  // (src/lib/dm/npc-archive-logic.ts). They are never deleted. A companion
  // in the party is in the Party block, not here.
  return listCastNpcs(campaignId)
    .filter((npc) => !npc.archived)
    .map((npc) => ({
    name: npc.name,
    attitude: npc.attitude,
    trait: npc.trait,
    location: npc.location,
    agency: agencyFragment(npc.agency),
    // Other spellings this NPC has answered to, so the model knows the
    // short form in the transcript and the full name here are one person.
    aliases: npc.aliases,
    // What this NPC has no on-screen reason to know (witness-logic.ts).
    witnessNote: renderWitnessNote(npc.name, facts),
    // The stat block they fight with (start_encounter takes their name).
    statBlock: npc.statBlock,
    // Their gender, and at a romance table who they are drawn to (issue
    // 501), so romance follows who people are. Blank says nothing.
    identity: npcIdentity(npc, options.romance ?? false),
  }));
}

function npcIdentity(npc: Npc, romance: boolean): string {
  const drawn = romance ? attractionWords(npc.attraction) : "";
  return [npc.gender, drawn ? `drawn to ${drawn}` : ""].filter(Boolean).join(", ");
}

const ATTITUDE_LADDER = ["hostile", "indifferent", "friendly"] as const;

function shiftAttitude(attitude: (typeof ATTITUDE_LADDER)[number], steps: number): (typeof ATTITUDE_LADDER)[number] {
  const index = Math.max(0, Math.min(ATTITUDE_LADDER.length - 1, ATTITUDE_LADDER.indexOf(attitude) + steps));
  return ATTITUDE_LADDER[index];
}
