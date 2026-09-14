import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getLoreEntry } from "@/lib/db/lore";
import { getQuest, insertQuest, listQuests, updateQuest } from "@/lib/db/quests";
import { normalizeObjectives, tickObjective, type QuestStatus } from "@/lib/dm/quest-logic";
import { dismissHandout, publishHandout } from "@/lib/dm/scene-state";
import { isUploadedImagePath } from "@/lib/uploads";

// The binder's tools (docs/vtt-parity-implementation-plan.md sections 5.2
// and 5.7): put a handout in front of the table and take it away again,
// and write or tick the quest log. Both callers reach these: the model
// through its tool list, a person through the console catalog.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const BINDER_TOOL_NAMES = ["show_handout", "dismiss_handout", "set_quest", "tick_objective"] as const;

export const binderTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "show_handout",
      description:
        "Put a handout on every player's screen: a lore entry by id (only one the party may read), or an uploaded picture. Use when the party finds a letter, a notice, a map, a page. It stays up until dismissed.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          loreId: { type: "string", description: "The lore entry to show." },
          imagePath: { type: "string", description: "An uploaded picture (/uploads/...) instead of an entry." },
          caption: { type: "string", description: "A line under it, optional." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dismiss_handout",
      description: "Take the current handout off every screen.",
      parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_quest",
      description:
        "Write or update a quest in the party's log: a title, its objectives as short lines, and a status. Pass questId to change one that exists; leave it out to add one. Use when the party takes on a task the arc did not already list.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          questId: { type: "string", description: "The quest to change; omit to add one." },
          title: { type: "string", description: "What the quest is called." },
          objectives: { type: "array", items: { type: "string" }, description: "The steps, one line each. Replaces the list." },
          status: { type: "string", enum: ["active", "done", "failed"], description: "Defaults to active." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tick_objective",
      description: "Mark one objective of a quest done (or undone). Use when the party completes a step.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          questId: { type: "string" },
          objectiveId: { type: "string" },
          done: { type: "boolean", description: "Defaults to true." },
        },
        required: ["questId", "objectiveId"],
      },
    },
  },
];

const handoutSchema = z.object({
  loreId: z.string().trim().min(1).optional(),
  imagePath: z.string().trim().optional(),
  caption: z.string().trim().max(200).optional(),
});

// A person may show anything they can read; the model may show only what
// the party may read, so a secret never lands on the table by mistake.
export function handleShowHandout(campaign: Campaign, turn: DmTurn | null, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof handoutSchema>;
  try {
    args = handoutSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: show_handout needs a loreId or an imagePath." };
  }
  const human = turn?.actor === "human_dm";
  if (args.loreId) {
    const entry = getLoreEntry(args.loreId);
    if (!entry || entry.campaignId !== campaign.id) {
      return { error: "No lore entry by that id." };
    }
    if (entry.visibility === "dm" && !human) {
      return { error: "That entry is the DM's secret; it cannot be shown to the table." };
    }
    const handout = publishHandout(campaign.id, {
      loreId: entry.id,
      ...(entry.imagePath ? { imagePath: entry.imagePath } : {}),
      title: entry.title,
      ...(args.caption ? { caption: args.caption } : {}),
      style: entry.style === "plain" ? (entry.imagePath && !entry.body.trim() ? "image" : "parchment") : entry.style,
      audience: entry.visibility === "dm" ? [] : entry.audience,
    });
    return { ok: true, shown: entry.title, handoutId: handout.id };
  }
  if (args.imagePath) {
    if (!isUploadedImagePath(args.imagePath)) {
      return { error: "Not an uploaded picture." };
    }
    const handout = publishHandout(campaign.id, {
      imagePath: args.imagePath,
      title: args.caption || "A handout",
      ...(args.caption ? { caption: args.caption } : {}),
      style: "image",
      audience: null,
    });
    return { ok: true, shown: handout.title, handoutId: handout.id };
  }
  return { error: "show_handout needs a loreId or an imagePath." };
}

export function handleDismissHandout(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let id = "";
  try {
    const parsed = JSON.parse(rawArguments || "{}") as { handoutId?: unknown };
    id = typeof parsed.handoutId === "string" ? parsed.handoutId : "";
  } catch {
    // No id means the current one.
  }
  dismissHandout(campaign.id, id || "*");
  return { ok: true };
}

const questSchema = z.object({
  questId: z.string().trim().optional(),
  title: z.string().trim().max(120).optional(),
  // The console sends the objectives as lines; the model sends a list.
  objectives: z
    .union([z.array(z.string().trim().max(240)).max(12), z.string().max(3_000)])
    .transform((value) => (typeof value === "string" ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 12) : value))
    .optional(),
  status: z.enum(["active", "done", "failed", "hidden"]).optional(),
  visibility: z.enum(["party", "dm"]).optional(),
});

export function handleSetQuest(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof questSchema>;
  try {
    args = questSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: set_quest takes a title, objectives and a status." };
  }
  if (args.questId) {
    const quest = getQuest(args.questId);
    if (!quest || quest.campaignId !== campaign.id) {
      return { error: "No quest by that id." };
    }
    const updated = updateQuest(quest.id, {
      ...(args.title ? { title: args.title } : {}),
      ...(args.objectives ? { objectives: normalizeObjectives(args.objectives) } : {}),
      ...(args.status ? { status: args.status as QuestStatus } : {}),
      ...(args.visibility ? { visibility: args.visibility } : {}),
    });
    return { ok: true, quest: updated };
  }
  if (!args.title) {
    return { error: "A new quest needs a title." };
  }
  if (listQuests(campaign.id).filter((quest) => quest.status === "active").length >= 40) {
    return { error: "The quest log is full; finish or fail some first." };
  }
  const quest = insertQuest({
    campaignId: campaign.id,
    title: args.title,
    objectives: normalizeObjectives(args.objectives ?? []),
    status: (args.status as QuestStatus) ?? "active",
    visibility: args.visibility ?? "party",
    source: "dm",
  });
  return { ok: true, quest };
}

const tickSchema = z.object({
  questId: z.string().trim().min(1),
  objectiveId: z.string().trim().min(1),
  done: z.boolean().optional(),
});

export function handleTickObjective(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof tickSchema>;
  try {
    args = tickSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: tick_objective needs a questId and an objectiveId." };
  }
  const quest = getQuest(args.questId);
  if (!quest || quest.campaignId !== campaign.id) {
    return { error: "No quest by that id." };
  }
  if (!quest.objectives.some((objective) => objective.id === args.objectiveId)) {
    return { error: "No objective by that id on that quest." };
  }
  const objectives = tickObjective(quest.objectives, args.objectiveId, args.done ?? true);
  const allDone = objectives.length > 0 && objectives.every((objective) => objective.done);
  const updated = updateQuest(quest.id, { objectives, ...(allDone ? { status: "done" as const } : {}) });
  return { ok: true, quest: updated, complete: allDone };
}
