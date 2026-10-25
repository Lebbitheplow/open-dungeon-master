import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getLoreEntry, listLoreEntries } from "@/lib/db/lore";
import { getQuest, insertQuest, listQuests, updateQuest } from "@/lib/db/quests";
import { DM_ONLY_MARK, normalizeObjectives, tickObjective, type Quest, type QuestStatus } from "@/lib/dm/quest-logic";
import { dismissHandout, publishHandout } from "@/lib/dm/scene-state";
import { isUploadedImagePath } from "@/lib/uploads";
import type { WorldLoreEntry } from "@/lib/dm/world-lore-logic";
import { unknownRef, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

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
        "Put a lore entry on every player's screen as a handout, by its title (only one the party may read). Call it when the party finds a letter, a notice, a map, a page. It stays up until dismissed.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          loreId: { type: "string", description: "The lore entry to show, by its title as search_lore gives it." },
          caption: { type: "string", description: "A line under it." },
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
        "Write or update a quest in the party's log: a title, its objectives as short lines, and a status. Call it when the party takes on a task the arc did not already list.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          questId: { type: "string", description: "The quest to change, by its title in GAME STATE; omit to add one." },
          title: { type: "string", description: "What the quest is called." },
          objectives: {
            type: "array",
            items: { type: "string" },
            description: "The steps, one line each. Replaces the list; a step restated word for word keeps its tick.",
          },
          status: { type: "string", enum: ["active", "done", "failed"], description: "Default: 'active'." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tick_objective",
      description: "Mark one objective of a quest done (or undone). Call it when the party completes a step.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          questId: { type: "string", description: "The quest, by its title in GAME STATE." },
          objectiveId: { type: "string", description: "The objective, by its text in GAME STATE." },
          done: { type: "boolean", description: "Default: true." },
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

// The model reads a lore entry by its title (search_lore gives it as
// "category: title"), never its id; a person's console sends the id.
function loreByRef(campaignId: string, ref: string): WorldLoreEntry | ToolError {
  const byId = getLoreEntry(ref);
  if (byId?.campaignId === campaignId) {
    return byId;
  }
  const entries = listLoreEntries(campaignId);
  return (
    entries.find((entry) => textKey(entry.title) === textKey(ref) || textKey(`${entry.category}: ${entry.title}`) === textKey(ref)) ??
    unknownRef("loreId", ref, entries.filter((entry) => entry.visibility !== "dm" && !entry.unpublished).map((entry) => ({ id: entry.id, name: entry.title })))
  );
}

// A person may show anything they can read; the model may show only what
// the party may read, so a secret never lands on the table by mistake.
export function handleShowHandout(campaign: Campaign, turn: DmTurn | null, rawArguments: string): ToolResult {
  let args: z.infer<typeof handoutSchema>;
  try {
    args = handoutSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: show_handout needs a loreId, the lore entry's title.", retry: true };
  }
  const human = turn?.actor === "human_dm";
  if (args.loreId) {
    const entry = loreByRef(campaign.id, args.loreId);
    if ("error" in entry) {
      return entry;
    }
    if (entry.visibility === "dm" && !human) {
      return { error: "That entry is the DM's secret; it cannot be shown to the table.", retry: true };
    }
    if (entry.unpublished && !human) {
      return { error: "That entry is not canon yet; it cannot be shown to the table.", retry: true };
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
      return { error: "Not an uploaded picture.", retry: true };
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
  return { error: "show_handout needs a loreId, the lore entry's title.", retry: true };
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

// GAME STATE lists a quest by its title and an objective by its text, never
// their ids, so either stands for the id (as resolveSheetRef takes a name).
function questByRef(campaignId: string, ref: string): Quest | ToolError {
  const byId = getQuest(ref);
  if (byId?.campaignId === campaignId) {
    return byId;
  }
  const quests = listQuests(campaignId);
  // GAME STATE marks the DM's own quests (renderQuestsForPrompt), and the
  // model copies the line it reads.
  const title = textKey(ref.startsWith(DM_ONLY_MARK) ? ref.slice(DM_ONLY_MARK.length) : ref);
  const named = quests.filter((quest) => textKey(quest.title) === title);
  return (
    named.find((quest) => quest.status === "active") ??
    named[0] ??
    unknownRef("questId", ref, quests.map((quest) => ({ id: quest.id, name: quest.title })))
  );
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

export function handleSetQuest(campaign: Campaign, rawArguments: string): ToolResult {
  let args: z.infer<typeof questSchema>;
  try {
    args = questSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: set_quest takes a title, objectives and a status.", retry: true };
  }
  const update = (quest: Quest, retitle: boolean) =>
    updateQuest(quest.id, {
      ...(args.title && retitle ? { title: args.title } : {}),
      // The steps already ticked stay ticked when the list is restated.
      ...(args.objectives ? { objectives: normalizeObjectives(args.objectives, quest.objectives) } : {}),
      ...(args.status ? { status: args.status as QuestStatus } : {}),
      ...(args.visibility ? { visibility: args.visibility } : {}),
    });
  if (args.questId) {
    const quest = questByRef(campaign.id, args.questId);
    if ("error" in quest) {
      return quest;
    }
    return { ok: true, quest: update(quest, true) };
  }
  if (!args.title) {
    return { error: "A new quest needs a title.", retry: true };
  }
  // A title the log already holds, on a quest still open, is that quest: the
  // model restates a quest by its title as often as it names it in questId,
  // and a second row of the same quest splits its ticks. A quest the party
  // finished or failed can be taken up again as a new one.
  const open = listQuests(campaign.id).find(
    (quest) => (quest.status === "active" || quest.status === "hidden") && textKey(quest.title) === textKey(args.title ?? ""),
  );
  if (open) {
    return {
      ok: true,
      quest: update(open, false),
      note: `"${open.title}" was already in the log, so it was updated rather than added again.`,
    };
  }
  if (listQuests(campaign.id).filter((quest) => quest.status === "active").length >= 40) {
    return { error: "The quest log is full; finish or fail some first.", retry: true };
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

export function handleTickObjective(campaign: Campaign, rawArguments: string): ToolResult {
  let args: z.infer<typeof tickSchema>;
  try {
    args = tickSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: tick_objective needs a questId and an objectiveId.", retry: true };
  }
  const quest = questByRef(campaign.id, args.questId);
  if ("error" in quest) {
    return quest;
  }
  const objective = quest.objectives.find((entry) => entry.id === args.objectiveId || textKey(entry.text) === textKey(args.objectiveId));
  if (!objective) {
    return unknownRef("objectiveId", args.objectiveId, quest.objectives.map((entry) => ({ id: entry.id, name: entry.text })));
  }
  const objectives = tickObjective(quest.objectives, objective.id, args.done ?? true);
  const allDone = objectives.length > 0 && objectives.every((objective) => objective.done);
  const updated = updateQuest(quest.id, { objectives, ...(allDone ? { status: "done" as const } : {}) });
  return { ok: true, quest: updated, complete: allDone };
}
