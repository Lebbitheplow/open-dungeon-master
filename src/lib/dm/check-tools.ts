import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { computeSheetDerived, SRD_SKILLS } from "@/lib/srd";
import { dcForDifficulty, difficultyOfDc, normalizeDifficulty } from "@/lib/srd/dc";
import { resolveRollExpression, resolveSheetRef } from "@/lib/dm/rolls";
import type { RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Two exploration-pillar tools that were pure narration before: a group skill
// check resolved by the 5e "half the group succeeds" rule, and a passive
// notice gate that decides who spots a hidden thing from passive scores
// instead of the model simply declaring it. Both lean on the same difficulty
// ladder request_roll now uses (src/lib/srd/dc.ts), so a "hard" lock, a "hard"
// group climb, and a "hard" hidden door all read DC 20.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const CHECK_TOOL_NAMES = ["group_check", "check_notice"] as const;

const DIFFICULTY_ENUM = [
  "very_easy",
  "easy",
  "moderate",
  "hard",
  "very_hard",
  "nearly_impossible",
] as const;

export const checkTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "group_check",
      description:
        "Resolve one skill (or raw ability) check attempted by several characters at once: the party sneaking past a sentry together, everyone fording a river, the whole group searching a room. The server rolls each named character from their real sheet and applies the 5e rule that the GROUP succeeds only if at least half of them succeed, then reports who passed. Call this instead of a string of separate request_roll calls, BEFORE narrating the outcome, and narrate exactly what it reports.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          skill: {
            type: "string",
            enum: SRD_SKILLS.map((skill) => skill.id),
            description: "Which skill everyone rolls. Give this or ability.",
          },
          ability: {
            type: "string",
            enum: ["str", "dex", "con", "int", "wis", "cha"],
            description: "A raw ability check when no skill fits. Give this or skill.",
          },
          characterIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact characterIds taking part. Omit to include the whole party.",
          },
          difficulty: {
            type: "string",
            enum: [...DIFFICULTY_ENUM],
            description: "How hard the shared task is; the server sets the DC. Prefer this over dc.",
          },
          dc: { type: "integer", description: "An exact DC, only when a specific number is needed." },
          reason: { type: "string", description: "Short note on what the group is attempting." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_notice",
      description:
        "Decide who PASSIVELY notices a hidden thing the party is not actively searching for: a trap, a concealed door, an ambusher lying in wait, a lie in an NPC's words. No dice are rolled; the server compares every character's passive score (Perception, Insight, or Investigation) against how hard the thing is to spot and reports who catches it. Call this BEFORE you reveal or withhold the hidden thing, and narrate only what the noticing characters could know. Never just declare that the party does or does not spot something hidden.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          sense: {
            type: "string",
            enum: ["perception", "insight", "investigation"],
            description:
              "Which passive score decides it: perception (traps, ambushers, sounds), insight (a lie, a hidden motive), investigation (a concealed mechanism or clue). Default perception.",
          },
          difficulty: {
            type: "string",
            enum: [...DIFFICULTY_ENUM],
            description: "How hard the thing is to spot; the server sets the DC. Prefer this over dc.",
          },
          dc: { type: "integer", description: "An exact spot DC, only when a specific number is needed." },
          characterIds: {
            type: "array",
            items: { type: "string" },
            description: "Exact characterIds who could notice. Omit to test the whole party.",
          },
          reason: { type: "string", description: "Short note on the hidden thing." },
        },
        required: [],
      },
    },
  },
];

// Turns a difficulty tier and/or explicit dc into a concrete DC, tier label,
// and any error. Shared by both tools; an explicit dc wins over the tier.
function resolveDc(
  difficulty: unknown,
  dc: unknown,
): { dc: number; label: string } | { error: string } {
  const explicit = typeof dc === "number" && Number.isFinite(dc) ? Math.round(dc) : null;
  const tier = normalizeDifficulty(difficulty);
  const value = explicit ?? (tier ? dcForDifficulty(tier) : null);
  if (value === null) {
    return { error: "Pass a difficulty tier (very_easy .. nearly_impossible) or an exact dc." };
  }
  return { dc: value, label: difficultyOfDc(value) };
}

// The characters a group tool acts on: the named ones, or the whole party
// when none are named. Bad ids are dropped; an all-bad list is an error.
function resolveTargets(
  ids: unknown,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet[] {
  if (!Array.isArray(ids) || !ids.length) {
    return sheets;
  }
  const resolved: CharacterSheet[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const sheet = resolveSheetRef(typeof id === "string" ? id : undefined, sheets, sheetsById);
    if (sheet && !seen.has(sheet.id)) {
      seen.add(sheet.id);
      resolved.push(sheet);
    }
  }
  return resolved;
}

function publishRoll(campaignId: string, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}

// ---- group_check ----

const groupCheckSchema = z.object({
  skill: z.string().optional(),
  ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  characterIds: z.array(z.string()).optional(),
  difficulty: z.unknown().optional(),
  dc: z.unknown().optional(),
  reason: z.string().optional(),
});

export function handleGroupCheck(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof groupCheckSchema>;
  try {
    args = groupCheckSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: group_check needs a skill or ability and a difficulty." };
  }
  if (!args.skill && !args.ability) {
    return { error: "group_check needs a skill (e.g. stealth) or an ability (e.g. str)." };
  }
  const dc = resolveDc(args.difficulty, args.dc);
  if ("error" in dc) {
    return dc;
  }
  const targets = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!targets.length) {
    return { error: "No valid characters for the group check; use characterIds from GAME STATE." };
  }

  const results: Array<{ name: string; total: number; success: boolean }> = [];
  for (const stale of targets) {
    const sheet = getSheetById(stale.id) ?? stale;
    const rollArgs = {
      kind: args.skill ? "skill_check" : "ability_check",
      skill: args.skill,
      ability: args.ability,
    } as unknown as RollArgs;
    const resolved = resolveRollExpression(rollArgs, sheet);
    if ("error" in resolved || "autoFail" in resolved) {
      // An auto-fail (paralysis) or an unresolvable skill counts as a failed
      // participant rather than aborting the whole group's attempt.
      results.push({ name: sheet.name, total: 0, success: false });
      continue;
    }
    const rolled = rollExpression(resolved.expression);
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: args.skill ? "skill_check" : "ability_check",
      detail: `${sheet.name}: group ${args.skill ?? args.ability} check`,
      dc: dc.dc,
      result: rolled,
    });
    publishRoll(campaign.id, roll);
    turn.rollIds.push(roll.id);
    results.push({ name: sheet.name, total: rolled.total, success: rolled.total >= dc.dc });
  }

  const successes = results.filter((entry) => entry.success).length;
  const passed = successes * 2 >= results.length;
  return {
    ok: true,
    check: args.skill ?? args.ability,
    dc: dc.dc,
    difficulty: dc.label,
    successes,
    total: results.length,
    passed,
    results,
    note: passed
      ? `The group succeeds: ${successes} of ${results.length} made it, at least half. Narrate the shared success.`
      : `The group fails: only ${successes} of ${results.length} made it, short of half. Narrate the shared setback.`,
  };
}

// ---- check_notice ----

const checkNoticeSchema = z.object({
  sense: z.enum(["perception", "insight", "investigation"]).optional(),
  difficulty: z.unknown().optional(),
  dc: z.unknown().optional(),
  characterIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

// The passive score a sense reads. Perception carries its feat/feature bonus
// (Observant, keen senses) through the derived value; insight/investigation
// take the plain 10 + skill modifier, which is faithful for all but the rare
// Observant investigator and keeps the gate simple.
function passiveScore(sheet: CharacterSheet, sense: "perception" | "insight" | "investigation") {
  const derived = computeSheetDerived(sheet);
  if (sense === "perception") {
    return derived.passivePerception;
  }
  return 10 + (derived.skills[sense] ?? 0);
}

export function handleCheckNotice(
  _campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof checkNoticeSchema>;
  try {
    args = checkNoticeSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: check_notice needs a difficulty and optionally a sense." };
  }
  const dc = resolveDc(args.difficulty, args.dc);
  if ("error" in dc) {
    return dc;
  }
  const sense = args.sense ?? "perception";
  const targets = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!targets.length) {
    return { error: "No valid characters to test; use characterIds from GAME STATE." };
  }

  const noticedBy: string[] = [];
  const missedBy: string[] = [];
  for (const sheet of targets) {
    const passive = passiveScore(sheet, sense);
    if (passive >= dc.dc) {
      noticedBy.push(sheet.name);
    } else {
      missedBy.push(sheet.name);
    }
  }
  const anyNoticed = noticedBy.length > 0;
  return {
    ok: true,
    sense,
    dc: dc.dc,
    difficulty: dc.label,
    noticedBy,
    missedBy,
    anyNoticed,
    note: anyNoticed
      ? `${noticedBy.join(", ")} notice${noticedBy.length === 1 ? "s" : ""} it (passive ${sense} vs DC ${dc.dc}); ${missedBy.length ? `${missedBy.join(", ")} do not` : "everyone catches it"}. Reveal it only to those who noticed.`
      : `No one notices it: every passive ${sense} is under DC ${dc.dc}. Keep it hidden; do not describe it.`,
  };
}
