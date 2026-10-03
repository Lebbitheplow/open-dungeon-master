import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq, setFloor } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  listEnemies,
  orderEntryId,
  setEnemyInitiative,
  saveEncounter,
  type Encounter,
} from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { setInitiativeFloor, stepTurnForward } from "@/lib/dm/encounter-tools";
import { d20Expression } from "@/lib/dice";
import { dmRoll } from "@/lib/dm/roll-card";
import {
  applyInitiativeEdit,
  NPC_ENTRY_PREFIX,
  type InitiativeEdit,
} from "@/lib/dm/initiative-edit";

// The DM's hands on the initiative tracker. The editing itself is pure
// (src/lib/dm/initiative-edit.ts); this is the part that has to touch the
// world: save the encounter, move the floor with the pointer, and say out
// loud what changed.
//
// It says it out loud on purpose. Everything else that moves the pointer
// posts a table note, and an order that silently rearranged itself would be
// the one thing at the table nobody could check.

export type InitiativeResult = { ok: true; note: string } | { error: string };

function announce(campaign: Campaign, note: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content: note,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// A fresh id for an NPC slot. The prefix is what tells every reader that
// there is no sheet and no stat block behind this entry.
export function newNpcEntryId(): string {
  return `${NPC_ENTRY_PREFIX}${crypto.randomUUID()}`;
}

export function editInitiative(campaign: Campaign, edit: InitiativeEdit): InitiativeResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No fight is running." };
  }
  if (!encounter.orderReady) {
    return { error: "The initiative order is still being collected." };
  }
  // On a turn is a turn ending, not a correction: it goes through the turn
  // engine End Turn uses, so conditions tick, reactions and movement come
  // back, a downed character rolls their death save, the round turns over,
  // and at a person's table the enemies passed are held for the DM. The
  // pure editor below only moved the pointer, which left a DM's round 2
  // with nobody able to move and every condition frozen.
  if (edit.op === "step" && edit.direction === "forward") {
    const leaving = encounter.order[encounter.turnIndex]?.name;
    const error = stepTurnForward(campaign);
    if (error) {
      return { error };
    }
    const now = getActiveEncounter(campaign.id);
    const next = now?.order[now.turnIndex]?.name;
    const note = `The DM moved the turn on${leaving ? ` from ${leaving}` : ""}.${next ? ` It is now ${next}'s turn.` : ""}`;
    announce(campaign, note);
    return { ok: true, note };
  }
  const outcome = applyInitiativeEdit(
    { order: encounter.order, turnIndex: encounter.turnIndex, round: encounter.round },
    edit,
  );
  if ("error" in outcome) {
    return outcome;
  }
  const moved =
    outcome.state.turnIndex !== encounter.turnIndex || outcome.state.round !== encounter.round;
  encounter.order = outcome.state.order;
  encounter.turnIndex = outcome.state.turnIndex;
  encounter.round = outcome.state.round;
  if (moved) {
    // The turn changed hands, so the combatant who was acting no longer owns
    // an action, a bonus action or a reaction (src/lib/dm/action-budget.ts).
    encounter.turnBudget = null;
  }
  saveEncounter(encounter);
  if (moved) {
    setInitiativeFloor(campaign, encounter);
  }
  publishEncounter(campaign.id);
  announce(campaign, outcome.note);
  return { ok: true, note: outcome.note };
}

// Tear the order down and collect it again: everybody rolls, including the
// monsters, which is what a DM means by "reset initiative". The fight, the
// enemies and the board all survive; only the order and the pointer go.
export function resetInitiative(campaign: Campaign): InitiativeResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No fight is running." };
  }
  // The monsters roll again too, quietly, as they did when the fight began.
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status === "alive") {
      setEnemyInitiative(
        enemy.id,
        dmRoll(campaign.id, null, "initiative", `${enemy.displayName}: initiative`, d20Expression(enemy.stats.dexMod)).total,
      );
    }
  }
  encounter.order = [];
  encounter.orderReady = false;
  encounter.turnIndex = 0;
  encounter.round = 1;
  encounter.turnBudget = null;
  encounter.surprisedIds = [];
  saveEncounter(encounter);
  // The initiative floor named an order that no longer exists, so the table
  // goes back to open until the new one locks.
  setFloor(campaign.id, { mode: "open" });
  publishPersisted(campaign.id, "floor_changed", { floor: { mode: "open" } });
  publishEncounter(campaign.id);
  const note = "The DM reset the initiative. Roll again.";
  announce(campaign, note);
  return { ok: true, note };
}

// Who the DM may point at, with the ids the edit operations take.
export function initiativeRoster(encounter: Encounter) {
  return encounter.order.map((entry, index) => ({
    id: orderEntryId(entry),
    kind: entry.kind,
    name: entry.name,
    initiative: entry.initiative,
    current: index === encounter.turnIndex,
  }));
}
