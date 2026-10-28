import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getLoreEntry, listLoreEntries } from "@/lib/db/lore";
import { getQuest, insertQuest, listQuests, updateQuest } from "@/lib/db/quests";
import { DM_ONLY_MARK, normalizeObjectives, tickObjective, type Quest, type QuestObjective, type QuestStatus } from "@/lib/dm/quest-logic";
import { dismissHandout, publishHandout } from "@/lib/dm/scene-state";
import { isUploadedImagePath } from "@/lib/uploads";
import type { WorldLoreEntry } from "@/lib/dm/world-lore-logic";
import { noneNamed, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
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
          lore: { type: "string", description: "Its title, as search_lore gives it." },
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
          quest: { type: "string", description: "The quest to change, by its title in GAME STATE; omit to add one." },
          title: { type: "string", description: "What the quest is called; a new quest needs it." },
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
          quest: { type: "string", description: "Its title in GAME STATE." },
          objective: { type: "string", description: "Its text in GAME STATE." },
          done: { type: "boolean", description: "Default: true." },
        },
        required: ["quest", "objective"],
      },
    },
  },
];

// The model names a lore entry by its title (search_lore gives it as
// "category: title"); the binder's Show this now button sends its id.
const handoutSchema = z.object({
  lore: z.string().trim().min(1).optional(),
  imagePath: z.string().trim().optional(),
  caption: z.string().trim().max(200).optional(),
});

function loreEntryFor(campaignId: string, args: z.infer<typeof handoutSchema>): WorldLoreEntry | ToolError | null {
  if (!args.lore) {
    return null;
  }
  const byId = getLoreEntry(args.lore);
  if (byId?.campaignId === campaignId) {
    return byId;
  }
  const wanted = textKey(args.lore);
  const entries = listLoreEntries(campaignId);
  return (
    entries.find((entry) => textKey(entry.title) === wanted || textKey(`${entry.category}: ${entry.title}`) === wanted) ??
    noneNamed("No lore entry is titled", args.lore, entries.filter((entry) => entry.visibility !== "dm" && !entry.unpublished).map((entry) => entry.title))
  );
}

// A person may show anything they can read; the model may show only what
// the party may read, so a secret never lands on the table by mistake.
export function handleShowHandout(campaign: Campaign, turn: DmTurn | null, rawArguments: string): ToolResult {
  let args: z.infer<typeof handoutSchema>;
  try {
    args = handoutSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: show_handout needs lore: the lore entry's title.", retry: true };
  }
  const human = turn?.actor === "human_dm";
  const entry = loreEntryFor(campaign.id, args);
  if (entry) {
    if ("error" in entry) {
      return entry;
    }
    if (entry.visibility === "dm" && !human) {
      return { error: "That entry is the GM's secret; it cannot be shown to the table.", retry: true };
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
  return { error: "show_handout needs lore: the lore entry's title.", retry: true };
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
// their ids, so the model names them that way; an older console sends ids.
function questFor(campaignId: string, ref: { quest?: string }): Quest | ToolError | null {
  if (!ref.quest) {
    return null;
  }
  const byId = getQuest(ref.quest);
  if (byId?.campaignId === campaignId) {
    return byId;
  }
  const quests = listQuests(campaignId);
  // GAME STATE marks the DM's own quests (renderQuestsForPrompt), and the
  // model copies the line it reads.
  const title = textKey(ref.quest.startsWith(DM_ONLY_MARK) ? ref.quest.slice(DM_ONLY_MARK.length) : ref.quest);
  const named = quests.filter((quest) => textKey(quest.title) === title);
  return named.find((quest) => quest.status === "active") ?? named[0] ?? noneNamed("No quest is titled", ref.quest, quests.map((quest) => quest.title));
}

const questSchema = z.object({
  quest: z.string().trim().optional(),
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
  const quest = questFor(campaign.id, args);
  if (quest) {
    if ("error" in quest) {
      return quest;
    }
    return { ok: true, quest: update(quest, true) };
  }
  if (!args.title) {
    return { error: "A new quest needs a title.", retry: true };
  }
  // A title the log already holds, on a quest still open, is that quest: the
  // model restates a quest by its title in title as often as it names it in quest,
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
  const added = insertQuest({
    campaignId: campaign.id,
    title: args.title,
    objectives: normalizeObjectives(args.objectives ?? []),
    status: (args.status as QuestStatus) ?? "active",
    visibility: args.visibility ?? "party",
    source: "dm",
  });
  return { ok: true, quest: added };
}

const tickSchema = z.object({
  quest: z.string().trim().min(1).optional(),
  objective: z.string().trim().min(1).optional(),
  done: z.boolean().optional(),
});

function objectiveFor(campaignId: string, args: z.infer<typeof tickSchema>): { quest: Quest; objective: QuestObjective } | ToolError {
  const needs: ToolError = { error: "tick_objective needs a quest, by its title, and an objective, by its text.", retry: true };
  const quest = questFor(campaignId, args);
  if (!quest) {
    return needs;
  }
  if ("error" in quest) {
    return quest;
  }
  if (!args.objective) {
    return needs;
  }
  const wanted = textKey(args.objective);
  const objective = quest.objectives.find((entry) => entry.id === args.objective || textKey(entry.text) === wanted);
  return objective ? { quest, objective } : noneNamed(`"${quest.title}" has no objective`, args.objective, quest.objectives.map((entry) => entry.text));
}

// The waypoint check reads a tick as the tool does, so a quest named by its
// title ticks its waypoint too.
export function tickedObjective(campaignId: string, rawArguments: string): { quest: Quest; objective: QuestObjective } | null {
  const parsed = tickSchema.safeParse(JSON.parse(rawArguments || "{}"));
  const found = parsed.success ? objectiveFor(campaignId, parsed.data) : null;
  return found && !("error" in found) ? found : null;
}

export function handleTickObjective(campaign: Campaign, rawArguments: string): ToolResult {
  let args: z.infer<typeof tickSchema>;
  try {
    args = tickSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: tick_objective needs a quest and an objective.", retry: true };
  }
  const found = objectiveFor(campaign.id, args);
  if ("error" in found) {
    return found;
  }
  const { quest, objective } = found;
  const objectives = tickObjective(quest.objectives, objective.id, args.done ?? true);
  const allDone = objectives.length > 0 && objectives.every((objective) => objective.done);
  const updated = updateQuest(quest.id, { objectives, ...(allDone ? { status: "done" as const } : {}) });
  return { ok: true, quest: updated, complete: allDone };
}
