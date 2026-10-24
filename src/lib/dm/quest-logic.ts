// Quests a table can read and a DM can write (docs/vtt-parity-
// implementation-plan.md section 5.7). The story arc still compiles its
// sub-arcs into quests; a human DM adds their own and ticks objectives by
// hand. Pure normalisation and the prompt block; storage is db/quests.ts.

import { textKey } from "../language/text-logic.ts";

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

// Objectives from the wire: objects keep their id and tick, and a string is
// a line of the list. Against the list a quest already has (`previous`), a
// line whose text is one of its objectives is that objective, its id and
// tick kept: the model and the console restate the whole list to add a step
// or reword one, and a restatement used to clear every tick. Any other line
// is a fresh objective, numbered past every id the list holds.
export function normalizeObjectives(raw: unknown, previous: QuestObjective[] = []): QuestObjective[] {
  if (!Array.isArray(raw)) {
    return previous;
  }
  const items = raw.slice(0, QUEST_OBJECTIVES_MAX);
  const taken = new Set<string>(previous.map((objective) => objective.id));
  for (const item of items) {
    const id = item && typeof item === "object" ? (item as Record<string, unknown>).id : undefined;
    if (typeof id === "string" && id) {
      taken.add(id.slice(0, 24));
    }
  }
  let next = previous.length;
  const fresh = () => {
    do {
      next += 1;
    } while (taken.has(`o${next}`));
    taken.add(`o${next}`);
    return `o${next}`;
  };
  const kept = new Set<string>();
  const out: QuestObjective[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const text = item.trim().slice(0, QUEST_OBJECTIVE_MAX);
      if (!text) {
        continue;
      }
      const same = previous.find((objective) => !kept.has(objective.id) && textKey(objective.text) === textKey(text));
      if (same) {
        kept.add(same.id);
        out.push({ id: same.id, text, done: same.done });
      } else {
        out.push({ id: fresh(), text, done: false });
      }
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const text = typeof record.text === "string" ? record.text.trim().slice(0, QUEST_OBJECTIVE_MAX) : "";
      if (!text) {
        continue;
      }
      const id = typeof record.id === "string" && record.id ? record.id.slice(0, 24) : fresh();
      kept.add(id);
      out.push({ id, text, done: record.done === true });
    }
  }
  return out;
}

export function tickObjective(objectives: QuestObjective[], objectiveId: string, done: boolean): QuestObjective[] {
  return objectives.map((objective) => (objective.id === objectiveId ? { ...objective, done } : objective));
}

export const DM_ONLY_MARK = "[DM only] ";

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
    const line = `- ${quest.visibility === "dm" ? DM_ONLY_MARK : ""}${quest.title}${ticks}`;
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
