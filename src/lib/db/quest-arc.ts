import { getCampaignById, setStoryArc } from "@/lib/db/campaigns";
import { getQuest, updateQuest } from "@/lib/db/quests";
import { subArcAfterQuestEdit, type Quest } from "@/lib/dm/quest-logic";

// A quest edit that also reaches the story arc when the quest mirrors one of
// its sub-arcs (issue 581). Marked done or failed, the thread closes in the
// arc the storyteller steers by; reopened, it opens again; renamed, the arc
// calls it that too. Before this the edit stopped at the quest row, and the
// next write of the arc put the quest back the way the arc still had it.
// Every edit comes here: the Quests panel, set_quest and tick_objective.
//
// Not queued behind the turn the way an arc edit is: a quest edit must not
// wait out a long reply. A job holding an older copy of the arc that writes
// it later loses nothing, since setStoryArc takes a settled or renamed row's
// word over its copy (quest-logic.ts reconcileSubArcs).
export function editQuest(questId: string, patch: Parameters<typeof updateQuest>[1]): Quest | null {
  const updated = updateQuest(questId, patch);
  if (!updated || updated.source !== "arc") {
    return updated;
  }
  const arc = getCampaignById(updated.campaignId)?.storyArc;
  if (!arc) {
    return updated;
  }
  let touched = false;
  const subArcs = arc.subArcs.map((subArc) => {
    if (subArc.id !== updated.sourceRef) {
      return subArc;
    }
    const next = subArcAfterQuestEdit(subArc, updated);
    touched = next !== subArc;
    return next;
  });
  if (touched) {
    setStoryArc(updated.campaignId, { ...arc, subArcs });
  }
  return getQuest(questId) ?? updated;
}
