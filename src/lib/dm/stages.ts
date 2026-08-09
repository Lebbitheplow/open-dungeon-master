// The optional stages of a DM turn, and whether each one costs a model call.
//
// The catalogue idea is from NarrativeEngine-P's TIER_BLOCKS
// (src/services/turn/aiTier.ts, MIT, Copyright (c) 2026 Sagesheep), and so is
// the detail that matters most: each entry declares whether it CALLS A MODEL
// or is pure engine logic. An operator on a small local model needs to know
// which switch actually buys back a minute of GPU and which one just changes
// what the prompt says.
//
// Deliberately narrow. ODM already exposes the expensive story systems in
// game-settings (worldSimulation, relationships, romance, companions, TTS,
// maps, inventoryApprovals, narrationGuard); this covers only the stages that
// had no switch at all.
//
// Dependency-free so scripts/test-stages.mjs can import it directly.

export type StageId = "compaction" | "recall" | "retrieval" | "chapterSummary";

export type StageDef = {
  id: StageId;
  label: string;
  // True when turning this off saves a model call. False means it is pure
  // engine work, so disabling it only changes what the DM is told.
  callsModel: boolean;
  description: string;
  // What breaks when it is off, stated plainly. Every one of these is a real
  // loss, which is why they all default to on.
  cost: string;
};

export const STAGES: readonly StageDef[] = [
  {
    id: "compaction",
    label: "History compaction",
    callsModel: true,
    description:
      "Folds the oldest messages into a rolling summary once the transcript passes its threshold.",
    cost: "Off, long campaigns lose their early history entirely once it falls out of the budget.",
  },
  {
    id: "recall",
    label: "Semantic recall",
    callsModel: false,
    description:
      "Lets the DM search sealed chapters and scenes for something the party references.",
    cost: "Off, the DM can only work from what is already in the prompt and will not find old events.",
  },
  {
    id: "retrieval",
    label: "Lore and rules retrieval",
    callsModel: false,
    description:
      "Pulls the house rules and world lore that match this moment into the prompt.",
    cost: "Off, only pinned rules and lore are sent; everything else is invisible to the DM.",
  },
  {
    id: "chapterSummary",
    label: "Chapter summaries",
    callsModel: true,
    description: "Writes the summary and highlights for a chapter when it closes.",
    cost: "Off, closed chapters have no summary, so the story-so-far block and recall both thin out.",
  },
] as const;

export type StageSettings = Partial<Record<StageId, boolean>>;

// Every stage defaults to ON. This catalogue exists to let an operator trade
// quality for speed deliberately, not to change anyone's campaign silently.
export function isStageEnabled(settings: StageSettings | undefined, id: StageId): boolean {
  return settings?.[id] !== false;
}

export function stageById(id: StageId): StageDef | undefined {
  return STAGES.find((stage) => stage.id === id);
}

// The stages worth turning off first on a slow machine: the ones that cost a
// model call.
export function modelCallStages(): StageDef[] {
  return STAGES.filter((stage) => stage.callsModel);
}
