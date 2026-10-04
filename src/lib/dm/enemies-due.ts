import { campaignSeats, getFloor, setFloor, type Campaign, type Floor } from "@/lib/db/campaigns";
import { listEnemies, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { canEnemyAct } from "@/lib/dm/can-act";
import { coverInEffect } from "@/lib/dm/delegation";
import { hasHumanDm } from "@/lib/dm/viewer";
import { publishPersisted } from "@/lib/events";

// The enemies' turns between two characters' turns.
//
// The pointer rests only on player characters; the enemies between two of
// them act "inside the DM's turn" as the pointer walks past (advanceOrder).
// A person has no turn that follows. Before this, the next player was
// handed the floor the moment the last one ended their turn, nothing told
// the DM the goblins in between were due, and nothing ever played them. The
// AI's turn follows its own end_turn at once (the model plays them, the
// backstop the ones it left), but not a pass made outside it (a player's
// End Turn, the lead's skip, someone leaving): there an enemy after the
// last character was refused to the model once the round wrapped, and
// played by nobody.
//
// So the pointer passing enemies who can act holds the floor (the fight's
// floor is kept under the hold, as a lead's hold keeps it), and the fight
// remembers who is due; the next player waits for them, End Turn included.
// A person plays them from the console or has the server play them, then
// hands the turn on; the AI's next turn may play them and its end plays the
// rest (src/lib/dm/encounter-tools.ts advanceAfterTurn). Releasing the hold
// any other way hands it on too (src/lib/dm/initiative.ts).

// Whether a person is playing the monsters right now: a human DM in the seat
// and no AI cover stretch answering for them.
export function personRunsTable(campaign: Campaign): boolean {
  if (!hasHumanDm(campaignSeats(campaign))) {
    return false;
  }
  return !coverInEffect(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, campaign.dmCover);
}

// Called once the pointer has moved (or the order has locked). Records the
// enemies due before the player now up and holds the floor for them.
// Returns the ids recorded.
export function holdForEnemies(campaign: Campaign | null, encounter: Encounter, enemyIds: string[]): string[] {
  if (!campaign) {
    return [];
  }
  const enemies = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const due = [...new Set(enemyIds)].filter((id) => {
    const enemy = enemies.get(id);
    return Boolean(enemy && canEnemyAct({ enemy, encounter, kind: "action" }).ok);
  });
  // Added to, never replaced: the enemies an earlier pass left due are owed
  // their turns still (a pass that goes on from someone who left as their
  // turn began holds both legs).
  const owed = [...new Set([...enemiesDue(encounter), ...due])];
  if (owed.length) {
    encounter.legendary.due = owed;
  }
  saveEncounter(encounter);
  if (!due.length) {
    return due;
  }
  const floor = getFloor(campaign.id);
  if (floor.mode === "initiative") {
    const held: Floor = { mode: "hold", next: floor };
    setFloor(campaign.id, held);
    publishPersisted(campaign.id, "floor_changed", { floor: held });
  }
  return due;
}

export function enemiesDue(encounter: Encounter): string[] {
  return encounter.legendary.due ?? [];
}

// The enemies due that still have their action this round (the round's
// ledger, whoever played them): no character's turn ends before theirs,
// whether End Turn or end_turn ends it.
export function enemiesOwedTurn(encounter: Encounter): EncounterEnemy[] {
  const enemies = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  return enemiesDue(encounter).flatMap((id) => {
    const enemy = enemies.get(id);
    return enemy && canEnemyAct({ enemy, encounter, kind: "action" }).ok ? [enemy] : [];
  });
}
