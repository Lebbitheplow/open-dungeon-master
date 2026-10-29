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

export const DM_ONLY_MARK = "[GM only] ";

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

// ---- the arc's quests ----
//
// An arc row mirrors a sub-arc of the story arc (db/quests.ts syncArcQuests),
// but the table's word on it stands: a quest someone marked done, failed or
// hidden keeps that mark, and its title keeps the name it was given. Before
// this, the next write of the arc (a waypoint ticked, a beat completed) put
// every arc quest back to active under its first name, so a quest the party
// finished came back on the log (issue 581).

// A sub-arc's status, as arc-logic.ts SubArc has it (kept here so this
// module stays free of the arc's imports).
type SubArcStatus = "pending" | "active" | "resolved" | "abandoned";
type SubArcLike = { id: string; name: string; status: SubArcStatus };

function settled(status: SubArcStatus): boolean {
  return status === "resolved" || status === "abandoned";
}

// The status an arc row takes from its sub-arc. A row the table settled or
// hid keeps its own; an open row follows the arc closing the thread.
export function arcQuestStatus(subArcStatus: SubArcStatus, current: QuestStatus | undefined): QuestStatus {
  if (current && current !== "active") {
    return current;
  }
  return subArcStatus === "resolved" ? "done" : subArcStatus === "abandoned" ? "failed" : "active";
}

// The sub-arc after its quest was edited (set_quest, tick_objective, the
// Quests panel), so the storyteller stops steering toward a thread the table
// closed, and picks it up again when they reopen it. A hidden quest says
// nothing about the story, only about who reads it, and nor does a null
// status.
export function subArcAfterQuestEdit<T extends SubArcLike>(subArc: T, quest: { title: string; status: QuestStatus | null }): T {
  const status: SubArcStatus =
    quest.status === "done"
      ? "resolved"
      : quest.status === "failed"
        ? "abandoned"
        : quest.status === "active" && settled(subArc.status)
          ? "active"
          : subArc.status;
  const name = quest.title.trim() && quest.title !== subArc.name.slice(0, QUEST_TITLE_MAX) ? quest.title : subArc.name;
  return status === subArc.status && name === subArc.name ? subArc : { ...subArc, status, name };
}

// The arc as its quest rows have it: a row settled or renamed while some
// other job held an older copy of the arc (a chapter-close refresh waits on
// the model) wins over that copy, rather than the copy reopening the quest.
// A row still open leaves its sub-arc alone, which is how the arc's own
// refresh closes a thread.
export function reconcileSubArcs<T extends SubArcLike>(subArcs: readonly T[], rows: readonly Quest[]): T[] {
  const byRef = new Map(rows.filter((row) => row.source === "arc").map((row) => [row.sourceRef, row]));
  return subArcs.map((subArc) => {
    const row = byRef.get(subArc.id);
    if (!row) {
      return subArc;
    }
    return subArcAfterQuestEdit(subArc, { title: row.title, status: row.status === "done" || row.status === "failed" ? row.status : null });
  });
}

// ---- the quest, in a line ----

// The next step of a quest: its first objective not yet ticked.
function openStep(quest: Quest): string {
  return quest.objectives.find((objective) => !objective.done)?.text ?? "";
}

// The quest the table's glance shows (CinematicParts.tsx QuestGlance): the
// oldest open quest everyone may read, with its next step. Read from the
// quest log itself, never from a copy: the copy on the campaign row went
// stale and kept a finished quest on screen for good (issue 581).
export function questGlanceOf(quests: readonly Quest[]): { title: string; step: string } | null {
  const quest = quests.find((entry) => entry.status === "active" && entry.visibility === "party");
  return quest ? { title: quest.title, step: openStep(quest) } : null;
}

// The open party quests as "Title: next step" lines, the shape the campaign
// payload's questLog has always had, so an app built before the glance read
// the quest log still shows the live quest.
export function questLogLines(quests: readonly Quest[]): string[] {
  return quests
    .filter((quest) => quest.status === "active" && quest.visibility === "party")
    .slice(0, 20)
    .map((quest) => {
      const step = openStep(quest);
      return step ? `${quest.title}: ${step}` : quest.title;
    });
}

// The party's quests for the exported story: what they took on and how
// each ended. Never a GM-only or hidden one.
export function questLogForExport(quests: readonly Quest[]): string[] {
  return quests
    .filter((quest) => quest.visibility === "party" && quest.status !== "hidden")
    .map((quest) => (quest.status === "done" ? `${quest.title} (done)` : quest.status === "failed" ? `${quest.title} (failed)` : quest.title));
}
