import { getCampaignById } from "@/lib/db/campaigns";
import {
  getDmTurn,
  getLatestAiTurnId,
  listOrphanedParkedTurns,
  listRunningAiTurns,
  saveDmTurn,
} from "@/lib/db/dm-turns";
import { failPendingLocationMaps } from "@/lib/db/locations";
import { isAgentTurn } from "@/lib/dm/agent-turn";
import { enqueueDmJob } from "@/lib/dm/queue";
import { restoreXCardPauses } from "@/lib/dm/safety";
import { haltDmTurn, resumeDmTurn } from "@/lib/dm/turn";

// What a restart leaves wrong in the DM's state, put right once when a
// server process starts (src/instrumentation.ts), before it answers its
// first request. The queue, the status line and the X-card's pause live in
// memory and die with a process; the turns and the safety events are in the
// database and outlive it, so the database is read for what the memory
// held.
//
// Running once a process, before any request, is what keeps this off a
// turn a live process owns: this process has started none yet, and one
// server per database is already what the in-memory queue assumes (a
// second process on the same file would run two turns at once regardless).
// Under `next dev` the flag on globalThis keeps a reloaded module from
// running it again.

declare global {
  var __odmDmRecovered: boolean | undefined;
}

// What the table reads in the notice of a turn a restart cut short.
export const RESTART_HALT = "The server restarted while the Dungeon Master was working on this turn.";

// What a place's map placeholder reads when a restart dropped its render.
export const RESTART_MAP_FAILED = "The server restarted before this map was drawn.";

export type RestartRecovery = {
  // Tables whose raised X-card was raised again.
  xCards: number;
  // Turns the last process was running, now failed with a Retry notice.
  halted: number;
  // Parked turns whose last roll was in, resumed through the queue.
  resumed: number;
  // Parked turns with every roll in that the story has moved past, or with
  // no model to hand the rolls to, closed.
  closed: number;
  // Map renders the last process had queued or running, now failed.
  maps: number;
};

export function recoverDmAfterRestart(): RestartRecovery | null {
  if (globalThis.__odmDmRecovered) {
    return null;
  }
  globalThis.__odmDmRecovered = true;
  // First, so anything queued below waits at the gate the table left up.
  const xCards = restoreXCardPauses().length;
  const halted = haltInterruptedTurns();
  const { resumed, closed } = resumeOrphanedParkedTurns();
  // The map queue was in memory too: a place still waiting on a render
  // would chart forever under the narration that introduced it.
  const maps = failPendingLocationMaps(RESTART_MAP_FAILED);
  const recovery = { xCards, halted, resumed, closed, maps };
  const done = [
    xCards ? `${xCards} raised X-card(s) raised again` : "",
    halted ? `${halted} interrupted turn(s) halted for Retry` : "",
    resumed ? `${resumed} parked turn(s) resumed with the rolls already in` : "",
    closed ? `${closed} parked turn(s) the story has moved past closed` : "",
    maps ? `${maps} interrupted map render(s) marked failed` : "",
  ].filter(Boolean);
  if (done.length) {
    console.log(`[dm] after the restart: ${done.join("; ")}`);
  }
  return recovery;
}

// No process owns a 'running' AI turn once the one running it has stopped:
// its model call and its queue job died with it. Left alone, such a turn
// refuses Retry as already being worked on, and the next player action
// reaps it ten minutes on (failStaleRunningTurns), silently and behind a
// newer turn, so Retry is refused again as the story having moved on, and a
// physical roll it was resuming with is never narrated. So the
// storyteller's turn gets the notice finalize writes for a turn that
// failed, with the link that offers the lead Retry, and the retry answers
// any roll call left dangling from the rolls already in
// (src/lib/dm/retry-turn.ts).
//
// A turn with no conversation (a monster pass a person delegated) has
// nothing to retry and is closed as failed without a notice, as is a turn
// at a table no longer playing. An agent program's turn is left alone: the
// program outlives the restart and its next call carries on with it.
function haltInterruptedTurns(): number {
  let halted = 0;
  for (const turn of listRunningAiTurns()) {
    if (isAgentTurn(turn)) {
      continue;
    }
    const storyteller = turn.conversation[0]?.role === "system";
    if (storyteller && getCampaignById(turn.campaignId)?.status === "active") {
      haltDmTurn(turn.campaignId, turn, RESTART_HALT);
      halted += 1;
      continue;
    }
    turn.status = "failed";
    saveDmTurn(turn);
  }
  return halted;
}

// The resume a table's last roll queued lived in the queue's memory, so a
// restart before it ran (another job held the queue, or the X-card was up)
// left the turn parked with every roll in and nothing left to enter:
// submitting again is refused as already resolved, and Retry as waiting on
// dice. The table's newest AI turn is resumed now, as the roll would have
// resumed it, behind any X-card restored above; resumeDmTurn's own checks
// make a second run a no-op. An older one the story has moved past (a newer
// AI turn narrated since) is failed instead, with no model call and no
// notice, the same "moved on" a retry is refused with: its roll was
// published and applied when it was entered, and narrating it now would
// land in a later scene. That also stops the row reading as a table waiting
// on dice, which held the player-webhook state and the rollback warning.
//
// A turn with no conversation (a monster pass a person delegated) has no
// model to hand its rolls to: they already applied what they apply, so it
// closes as done, as resumeDmTurn closes a turn at a table a person runs.
function resumeOrphanedParkedTurns(): { resumed: number; closed: number } {
  let resumed = 0;
  let closed = 0;
  for (const orphan of listOrphanedParkedTurns()) {
    const turn = getDmTurn(orphan.id);
    if (!turn) {
      continue;
    }
    if (turn.conversation.length && getLatestAiTurnId(orphan.campaignId) === orphan.id) {
      enqueueDmJob(orphan.campaignId, () => resumeDmTurn(orphan.campaignId, orphan.id), { kind: "turn" });
      resumed += 1;
      continue;
    }
    turn.status = turn.conversation.length ? "failed" : "done";
    saveDmTurn(turn);
    closed += 1;
  }
  return { resumed, closed };
}
