// Quests a table can read and a DM can write (docs/vtt-parity-
// implementation-plan.md section 5.7). The story arc still compiles its
// sub-arcs into quests; a human DM adds their own and ticks objectives by
// hand. Pure normalisation and the prompt block; storage is db/quests.ts.

export const QUEST_STATUSES = ["active", "done", "failed", "hidden"] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export type QuestObjective = { id: string; text: string; done: boolean };

export type Quest = {
  id: string;
  campaignId: string;
  title: string;
  status: QuestStatus;
  objectives: QuestObjective[];
  // "arc" rows mirror a sub-arc and follow it; "dm" rows are hand-written.
  source: "arc" | "dm";
  // The sub-arc id for arc rows, so a re-compile finds its own.
  sourceRef: string;
  // "party" for the quest log everyone reads, "dm" for the DM's own list.
  visibility: "party" | "dm";
  createdAt: string;
  updatedAt: string;
};

export const QUEST_TITLE_MAX = 120;
export const QUEST_OBJECTIVE_MAX = 240;
export const QUEST_OBJECTIVES_MAX = 12;

export function normalizeQuestStatus(raw: unknown): QuestStatus {
  return QUEST_STATUSES.includes(raw as QuestStatus) ? (raw as QuestStatus) : "active";
}

// Objectives from the wire: strings become fresh objectives, objects keep
// their id and tick. Ids are the caller's when given, else positional.
export function normalizeObjectives(raw: unknown, previous: QuestObjective[] = []): QuestObjective[] {
  if (!Array.isArray(raw)) {
    return previous;
  }
  const out: QuestObjective[] = [];
  let next = previous.length;
  for (const item of raw.slice(0, QUEST_OBJECTIVES_MAX)) {
    if (typeof item === "string") {
      const text = item.trim().slice(0, QUEST_OBJECTIVE_MAX);
      if (text) {
        next += 1;
        out.push({ id: `o${next}`, text, done: false });
      }
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const text = typeof record.text === "string" ? record.text.trim().slice(0, QUEST_OBJECTIVE_MAX) : "";
      if (!text) {
        continue;
      }
      const id = typeof record.id === "string" && record.id ? record.id.slice(0, 24) : `o${(next += 1)}`;
      out.push({ id, text, done: record.done === true });
    }
  }
  return out;
}

export function tickObjective(objectives: QuestObjective[], objectiveId: string, done: boolean): QuestObjective[] {
  return objectives.map((objective) => (objective.id === objectiveId ? { ...objective, done } : objective));
}

// The quest block the model reads: active party quests with their ticks,
// then the DM's own with a mark. Bounded so it never crowds the turn.
export function renderQuestsForPrompt(quests: Quest[], budget = 1_200): string {
  const lines: string[] = [];
  let used = 0;
  for (const quest of quests) {
    if (quest.status !== "active") {
      continue;
    }
    const ticks = quest.objectives.length
      ? ` (${quest.objectives.map((objective) => `${objective.done ? "[x]" : "[ ]"} ${objective.text}`).join("; ")})`
      : "";
    const line = `- ${quest.visibility === "dm" ? "[DM only] " : ""}${quest.title}${ticks}`;
    if (used + line.length > budget) {
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.length ? `Quests (the party's log; a ticked objective is done):\n${lines.join("\n")}` : "";
}

// What a player's quest log holds: party quests, never the DM's own.
export function questsVisibleTo(quests: Quest[], steersStory: boolean): Quest[] {
  return steersStory ? quests : quests.filter((quest) => quest.visibility === "party" && quest.status !== "hidden");
}
