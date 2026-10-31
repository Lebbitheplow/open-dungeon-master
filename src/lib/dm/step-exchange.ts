import { getDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getLatestDmMessage } from "@/lib/db/messages";

// One step per exchange, for each guard that holds a moment to one move: a
// romance step (src/lib/dm/relationship-tools.ts), an NPC's first move
// (src/lib/dm/npc-advance.ts) and an attitude a social check moved
// (src/lib/dm/social-tools.ts). What "the same exchange" means at each kind
// of table.
//
// At an AI table an exchange is one AI turn, so the step's own turn id is
// the whole test. A person's console makes a fresh turn for each call
// (src/lib/dm/invoke.ts humanTurnFor), so the id never matches and a refused
// ask could be run again at once until the die said yes (issue 638). A
// person's stretch of play ends when they post narration, as an agent
// program's does (src/lib/dm/agent-turn.ts): the step holds until the GM's
// next narration, the newest one the reroll offer also reads.
export function stepTakenThisExchange(campaignId: string, stepTurnId: string, turn: DmTurn): boolean {
  if (!stepTurnId) {
    return false;
  }
  if (stepTurnId === turn.id) {
    return true;
  }
  if (turn.actor !== "human_dm") {
    return false;
  }
  const stepped = getDmTurn(stepTurnId);
  if (!stepped || stepped.campaignId !== campaignId) {
    return false;
  }
  // The step turn's last save, which is no earlier than the step: a turn a
  // parked roll kept open may be saved again later, and that only holds the
  // step a little longer, never lets it go early.
  const narration = getLatestDmMessage(campaignId);
  return !narration || narration.createdAt <= stepped.updatedAt;
}

// What a person at the console reads when the guard holds: why, and when
// they can ask again.
export function heldStepError(characterName: string, subjectName: string, turn: DmTurn): string {
  return turn.actor === "human_dm"
    ? `${subjectName} already answered ${characterName} this scene, so a second ask is refused. Post your next narration to move the scene on; then you can ask again.`
    : `${characterName} and ${subjectName} already took a step this exchange. Let the scene breathe before the next one.`;
}

// The same hold on an NPC's first move. The moment between the two was spent
// this scene, by either side's step, so the console names neither as the one
// who answered; the model reads the line it always read.
export function heldMoveError(characterName: string, subjectName: string, turn: DmTurn): string {
  return turn.actor === "human_dm"
    ? `${characterName} and ${subjectName} already had their moment this scene, so another move is refused. Post your next narration to move the scene on; then ${subjectName} can try again.`
    : heldStepError(characterName, subjectName, turn);
}
