import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import {
  getNpcByName,
  listNpcs,
  setNpcAttitude,
  upsertNpc,
  type Attitude,
} from "@/lib/db/npcs";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import {
  approachSkill,
  reactionAttitude,
  resolveSocialCheck,
  socialCheckDc,
} from "@/lib/dm/social";
import { resolveRollExpression, resolveSheetRef } from "@/lib/dm/rolls";
import type { RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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
        "Register or update a named NPC the party is dealing with, so the server tracks who they are and how they feel about the party across the whole campaign. Call this the first time a NpC matters to a scene (a quest-giver, a guard, a merchant), and again when the story itself (not a check) changes how they feel. attitude is the 5e scale: hostile, indifferent, or friendly. Do NOT use this to record an attitude change won by a Charisma check; social_check does that.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "The NPC's name, unique within the campaign." },
          attitude: {
            type: "string",
            enum: [...ATTITUDE_ENUM],
            description: "How they currently feel about the party. Defaults to indifferent.",
          },
          trait: {
            type: "string",
            description: "A short note on their personality, bond, or goal, for your own recall.",
          },
          location: { type: "string", description: "Where they are usually found." },
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
        "Roll a first-meeting reaction for a new NPC when it is genuinely uncertain how they take the party. The server rolls 2d6 (plus any modifier for the party's approach or reputation) and turns it into a starting attitude (hostile, indifferent, or friendly), registering the NPC with it. Use this instead of simply deciding how a stranger feels. Skip it when the story already fixes the NPC's stance (a sworn enemy, a hired ally).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "The new NPC's name." },
          modifier: {
            type: "integer",
            description:
              "A small +/- for the situation (a good first impression, a fearsome reputation). Usually -2 to +2.",
          },
          trait: { type: "string", description: "Optional short personality note." },
          location: { type: "string", description: "Optional where they are found." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "social_check",
      description:
        "Resolve one character trying to sway a tracked NPC with words. The server rolls that character's Persuasion, Deception, or Intimidation from their real sheet against a DC set by the NPC's current attitude (friendly is easy, hostile is hard), reports success or failure, and shifts the NPC one step friendlier or more hostile on a decisive result, at most once per exchange. Call this BEFORE narrating how the NPC responds, and narrate exactly what it reports. The NPC must already exist (set_npc or npc_reaction first).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The character making the appeal." },
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

// ---- set_npc ----

const setNpcSchema = z.object({
  name: z.string().min(1).max(80),
  attitude: z.enum(["hostile", "indifferent", "friendly"]).optional(),
  trait: z.string().max(300).optional(),
  location: z.string().max(120).optional(),
});

export function handleSetNpc(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof setNpcSchema>;
  try {
    args = setNpcSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: set_npc needs at least a name." };
  }
  const npc = upsertNpc({
    campaignId: campaign.id,
    name: args.name,
    attitude: args.attitude,
    trait: args.trait,
    location: args.location,
  });
  return {
    ok: true,
    npc: npc.name,
    attitude: npc.attitude,
    note: `${npc.name} is tracked as ${npc.attitude}. Their attitude persists until the story or a social_check changes it.`,
  };
}

// ---- npc_reaction ----

const reactionSchema = z.object({
  name: z.string().min(1).max(80),
  modifier: z.coerce.number().int().min(-10).max(10).optional(),
  trait: z.string().max(300).optional(),
  location: z.string().max(120).optional(),
});

export function handleNpcReaction(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
): Record<string, unknown> {
  let args: z.infer<typeof reactionSchema>;
  try {
    args = reactionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: npc_reaction needs a name." };
  }
  const modifier = args.modifier ?? 0;
  const outcome = rollExpression(modifier ? `2d6+${modifier}` : "2d6");
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
  const attitude = reactionAttitude(outcome.total);
  const npc = upsertNpc({
    campaignId: campaign.id,
    name: args.name,
    attitude,
    trait: args.trait,
    location: args.location,
  });
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
): Record<string, unknown> {
  let args: z.infer<typeof socialCheckSchema>;
  try {
    args = socialCheckSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: social_check needs characterId, npc, and approach." };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? getSheetById(stale.id) ?? stale : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const npc = getNpcByName(campaign.id, args.npc);
  if (!npc) {
    return {
      error: `No tracked NPC named "${args.npc}". Register them with set_npc or npc_reaction first.`,
    };
  }
  const skill = approachSkill(args.approach);
  if (!skill) {
    return { error: "approach must be persuade, deceive, or intimidate." };
  }

  const resolved = resolveRollExpression(
    { kind: "skill_check", skill } as unknown as RollArgs,
    sheet,
  );
  if ("error" in resolved || "autoFail" in resolved) {
    return { error: "error" in resolved ? resolved.error : `${sheet.name} cannot make that check.` };
  }
  const dc = socialCheckDc(npc.attitude);
  const rolled = rollExpression(resolved.expression);
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

  const outcome = resolveSocialCheck(rolled.total, npc.attitude);
  // The one-shift-per-exchange guard: an attitude that already moved this
  // turn does not move again, so the model cannot ratchet a hostile NPC to
  // friendly with a burst of checks in a single reply.
  const alreadyShifted = npc.lastShiftTurn === turn.id;
  let finalAttitude = npc.attitude;
  let shifted = false;
  if (outcome.shifted && !alreadyShifted) {
    const updated = setNpcAttitude(npc.id, outcome.attitude, turn.id);
    if (updated) {
      finalAttitude = updated.attitude;
      shifted = true;
    }
  }

  return {
    ok: true,
    npc: npc.name,
    character: sheet.name,
    skill,
    roll: rolled.total,
    dc,
    success: outcome.success,
    startingAttitude: npc.attitude,
    attitude: finalAttitude,
    attitudeShifted: shifted ? outcome.direction : null,
    note: buildSocialNote(sheet.name, npc.name, outcome.success, shifted, finalAttitude, outcome.direction, alreadyShifted && outcome.shifted),
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
): string {
  const base = success
    ? `${character} gets through to ${npc}: the check beats the DC. Narrate ${npc} yielding as far as ${attitude} disposition allows.`
    : `${character} fails to sway ${npc}. Narrate the refusal or the words falling flat.`;
  if (shifted) {
    return `${base} ${npc} is now ${attitude} (${direction === "up" ? "warmer" : "more hostile"}).`;
  }
  if (guarded) {
    return `${base} ${npc}'s attitude already moved this exchange, so it holds at ${attitude}.`;
  }
  return base;
}

// A compact roster for the GAME STATE block: tracked NPCs and their attitude.
export function npcRosterForPrompt(campaignId: string): Array<{
  name: string;
  attitude: Attitude;
  trait: string;
  location: string;
}> {
  return listNpcs(campaignId).map((npc) => ({
    name: npc.name,
    attitude: npc.attitude,
    trait: npc.trait,
    location: npc.location,
  }));
}
