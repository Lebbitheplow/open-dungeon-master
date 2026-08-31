import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSceneTracker, setSceneTracker } from "@/lib/db/scene-tracker";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { dcForDifficulty, DIFFICULTY_TIERS, type DifficultyTier } from "@/lib/srd/dc";
import { rollEffectExtras } from "@/lib/dm/effect-tools";
import { resolveSheetRef } from "@/lib/dm/rolls";
import {
  abandonTracker,
  advanceRound,
  checkTracker,
  describeTracker,
  recordCheck,
  TRACKER_KINDS,
  type SceneTracker,
} from "@/lib/dm/scene-tracker-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Running a structured non-combat scene: the DB and dice rim around
// scene-tracker-logic.ts.
//
// One tracker at a time per campaign, for the same reason there is one active
// encounter: two clocks running at once is a state a table cannot hold in
// their heads, and the DM can always end one and start the other.

export const SCENE_TOOL_NAMES = ["start_scene", "scene_check", "end_scene"] as const;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const sceneTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "start_scene",
      description:
        "Begin a structured non-combat scene with a clock: a chase, a negotiation, crossing something dangerous, a ritual under pressure. The party needs N successes before M failures, one check per character per round. Use this when a scene has real stakes and will take several exchanges; do not use it for a single check.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: [...TRACKER_KINDS] },
          title: { type: "string", description: "What the scene is, e.g. 'Talking the reeve round'." },
          successesNeeded: { type: "integer", minimum: 1, maximum: 12 },
          failuresAllowed: { type: "integer", minimum: 1, maximum: 12 },
          onSuccess: { type: "string", description: "What happens if they win it." },
          onFailure: { type: "string", description: "What happens if they lose it." },
          characterIds: { type: "array", items: { type: "string" } },
        },
        required: ["kind", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scene_check",
      description:
        "One character's attempt in the running scene. The server rolls their check and moves the clock. Ask for the skill their stated approach actually calls for, not the same skill every round.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string" },
          skill: { type: "string", description: "Skill name, e.g. 'persuasion'." },
          ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
          difficulty: {
            type: "string",
            enum: [...DIFFICULTY_TIERS],
            description: "Or send an exact dc.",
          },
          dc: { type: "integer", minimum: 1, maximum: 30 },
          approach: { type: "string", description: "What they tried, in a few words." },
          endRound: { type: "boolean", description: "True when this was the last character to act this round." },
        },
        required: ["characterId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_scene",
      description:
        "Call off the running structured scene without it resolving: the party walked away, or it stopped mattering. A scene that reaches its success or failure count ends on its own.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { reason: { type: "string" } },
      },
    },
  },
];

const startSchema = z.object({
  kind: z.string(),
  title: z.string(),
  successesNeeded: z.coerce.number().optional(),
  failuresAllowed: z.coerce.number().optional(),
  onSuccess: z.string().optional(),
  onFailure: z.string().optional(),
  characterIds: z.array(z.string()).optional(),
});

const checkSchema = z.object({
  characterId: z.string(),
  skill: z.string().optional(),
  ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  difficulty: z.enum(DIFFICULTY_TIERS).optional(),
  dc: z.coerce.number().optional(),
  approach: z.string().optional(),
  endRound: z.coerce.boolean().optional(),
});

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

function publish(campaignId: string, tracker: SceneTracker | null) {
  publishPersisted(campaignId, "scene_tracker", { tracker });
}

export function handleStartScene(
  campaign: Campaign,
  rawArguments: string,
): Record<string, unknown> {
  let args: z.infer<typeof startSchema>;
  try {
    args = startSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: start_scene needs a kind and a title." };
  }
  const running = getSceneTracker(campaign.id);
  if (running && running.status === "running") {
    return {
      error: `"${running.title}" is already running. End it before starting another.`,
    };
  }
  const checked = checkTracker(args);
  if ("error" in checked) {
    return checked;
  }
  const tracker: SceneTracker = {
    id: crypto.randomUUID(),
    campaignId: campaign.id,
    createdAt: new Date().toISOString(),
    ...checked.tracker,
  };
  setSceneTracker(campaign.id, tracker);
  publish(campaign.id, tracker);
  tableNote(campaign, describeTracker(tracker));
  return {
    ok: true,
    scene: tracker.title,
    needs: `${tracker.successesNeeded} successes before ${tracker.failuresAllowed} failures`,
  };
}

export function handleSceneCheck(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof checkSchema>;
  try {
    args = checkSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: scene_check needs a characterId." };
  }
  const tracker = getSceneTracker(campaign.id);
  if (!tracker || tracker.status !== "running") {
    return { error: "No structured scene is running; start_scene first." };
  }
  const sheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }

  const derived = computeSheetDerived(sheet);
  const skill = (args.skill ?? "").trim().toLowerCase();
  // The skill's own modifier when it is one the sheet knows, otherwise the
  // bare ability. Falling back rather than refusing keeps a scene moving when
  // the model asks for something the skill list does not name.
  const skillMod = skill ? derived.skills[skill as keyof typeof derived.skills] : undefined;
  const ability = args.ability ?? "wis";
  const modifier = typeof skillMod === "number" ? skillMod : derived.abilityMods[ability];
  const dc =
    typeof args.dc === "number" && args.dc > 0
      ? Math.min(30, Math.max(1, Math.round(args.dc)))
      : dcForDifficulty((args.difficulty ?? "moderate") as DifficultyTier);

  // Active effects ride a scene check exactly as they ride any other check.
  const extras = rollEffectExtras(campaign.id, sheet.id, "skill_check");
  const outcome = rollExpression(
    d20Expression(
      modifier + (extras.effectBonus ?? 0),
      extras.effectAdvantage ? "advantage" : extras.effectDisadvantage ? "disadvantage" : "none",
    ),
  );
  const success = outcome.total >= dc;
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "skill_check",
    detail: `${tracker.title}: ${skill || ability}${args.approach ? ` (${args.approach})` : ""}`,
    dc,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });

  const advanced = recordCheck(tracker, {
    characterId: sheet.id,
    characterName: sheet.name,
    approach: (args.approach ?? "").slice(0, 120),
    skill: skill || ability,
    dc,
    total: outcome.total,
    success,
  });
  if ("error" in advanced) {
    return advanced;
  }
  const next = args.endRound ? advanceRound(advanced.tracker) : advanced.tracker;
  setSceneTracker(campaign.id, next);
  publish(campaign.id, next);
  if (advanced.resolved) {
    tableNote(campaign, describeTracker(next));
  }
  return {
    ok: true,
    rolled: outcome.total,
    dc,
    success,
    successes: `${next.successes}/${next.successesNeeded}`,
    failures: `${next.failures}/${next.failuresAllowed}`,
    ...(advanced.resolved
      ? {
          resolved: advanced.outcome,
          note:
            advanced.outcome === "won"
              ? `The scene is won. ${next.onSuccess || "Narrate what that means."}`
              : `The scene is lost. ${next.onFailure || "Narrate what that costs them."}`,
        }
      : { note: "Narrate this exchange and keep the scene moving." }),
  };
}

export function handleEndScene(
  campaign: Campaign,
  rawArguments: string,
): Record<string, unknown> {
  const tracker = getSceneTracker(campaign.id);
  if (!tracker || tracker.status !== "running") {
    return { error: "No structured scene is running." };
  }
  let reason = "";
  try {
    reason = String((JSON.parse(rawArguments || "{}") as { reason?: string }).reason ?? "");
  } catch {
    reason = "";
  }
  const next = abandonTracker(tracker);
  setSceneTracker(campaign.id, next);
  publish(campaign.id, next);
  tableNote(campaign, `"${tracker.title}" is called off${reason ? `: ${reason}` : ""}.`);
  return { ok: true, ended: tracker.title };
}
