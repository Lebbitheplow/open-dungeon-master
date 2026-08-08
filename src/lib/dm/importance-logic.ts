// Pure scene-importance scoring, kept free of alias imports so node test
// scripts (scripts/test-importance.mjs) can load it directly.
//
// Recall used to treat every span of transcript as equally worth
// remembering, so a shopping trip competed with a character's death on
// cosine similarity alone. This rates each span 1-5 and feeds that in as a
// third ranking, so what mattered surfaces first among equally-similar
// candidates.
//
// It costs zero model calls, deliberately. NarrativeEngine-P rates scenes
// with an LLM because prose is all it has; this server already RECORDED what
// happened. A death is a sheet_audit row, a milestone is a character_events
// row, a chapter beat closing is a chapters row. Reading the record beats
// asking a model to infer it from the text, and it cannot hallucinate.

export const MIN_IMPORTANCE = 1;
export const MAX_IMPORTANCE = 5;
export const DEFAULT_IMPORTANCE = 3;

// Server-recorded events overlapping one scene's seq range. Every field is
// what the caller counted in that window, so this stays pure.
export type SceneSignals = {
  // A character hit 0 HP, died, or was stabilized.
  deaths?: number;
  // record_event milestones, weighted by kind.
  storyEvents?: number;
  otherEvents?: number;
  // complete_beat closed a chapter beat inside this span.
  beatCompleted?: boolean;
  // An encounter started or ended here.
  encounters?: number;
  // Relationship tier crossings and romance ladder moves.
  relationshipShifts?: number;
  // Natural 20s and natural 1s.
  crits?: number;
  // First on-screen appearance of a tracked NPC.
  npcIntroductions?: number;
  levelUps?: number;
  // Gold or magic items changing hands in quantity.
  majorLoot?: number;
};

// Weights are additive on top of the default. They are ordered by how
// reliably the signal predicts "a player would still remember this a month
// later", which is the only thing importance is for.
const WEIGHTS: Array<[keyof SceneSignals, number]> = [
  ["deaths", 2],
  ["beatCompleted", 1.5],
  ["storyEvents", 1],
  ["levelUps", 1],
  ["relationshipShifts", 0.75],
  ["encounters", 0.5],
  ["npcIntroductions", 0.5],
  ["majorLoot", 0.5],
  ["otherEvents", 0.25],
  ["crits", 0.25],
];

export function clampImportance(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_IMPORTANCE;
  }
  return Math.max(MIN_IMPORTANCE, Math.min(MAX_IMPORTANCE, Math.round(value)));
}

// Scores one scene. A span with no recorded events sits at the default, so
// ordinary play is neither promoted nor buried; signals only ever push up.
export function scoreSceneImportance(signals: SceneSignals): number {
  let score = DEFAULT_IMPORTANCE;
  for (const [key, weight] of WEIGHTS) {
    const raw = signals[key];
    if (raw === undefined || raw === false) {
      continue;
    }
    const count = raw === true ? 1 : raw;
    if (count <= 0) {
      continue;
    }
    // Saturating: two deaths in one span is not twice as memorable as one,
    // and this keeps a single busy combat from pinning everything at 5.
    score += weight * (1 + Math.log2(count));
  }
  return clampImportance(score);
}

// Importance as a ranking for rank fusion: scene ids ordered most important
// first. Ties keep the incoming order, which is the fused relevance order,
// so importance breaks ties rather than overriding relevance.
export function importanceRanking(
  scenes: Array<{ id: string; importance: number }>,
): string[] {
  return scenes
    .map((scene, index) => ({ ...scene, index }))
    .sort((a, b) => b.importance - a.importance || a.index - b.index)
    .map((scene) => scene.id);
}

// Whether a span should resist being summarized away by compaction. The
// moments a table would actually want quoted back stay verbatim longest.
export const COMPACTION_PROTECT_AT = 5;

export function shouldProtectFromCompaction(importance: number): boolean {
  return importance >= COMPACTION_PROTECT_AT;
}
