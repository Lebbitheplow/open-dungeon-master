import { campaignSeats, getFloor, setFloor, type Campaign, type Floor } from "@/lib/db/campaigns";
import { listEnemies, saveEncounter, type Encounter } from "@/lib/db/encounters";
import { canEnemyAct } from "@/lib/dm/can-act";
import { coverInEffect } from "@/lib/dm/delegation";
import { hasHumanDm } from "@/lib/dm/viewer";
import { publishPersisted } from "@/lib/events";

// The enemies' turns when a person runs the fight.
//
// The pointer rests only on player characters; the enemies between two of
// them act "inside the DM's turn" as the pointer walks past (advanceOrder).
// With the AI in the seat that turn follows at once: the model plays them,
// and the server's backstop plays any it left (advanceAfterTurn). A person
// has no turn that follows. Before this, the next player was handed the
// floor the moment the last one ended their turn, nothing told the DM the
// goblins in between were due, and nothing ever played them.
//
// So at a person's table the pointer passing enemies who can act holds the
// floor (the fight's floor is kept under the hold, as a lead's hold keeps
// it), and the fight remembers who is due. The DM plays them from the
// console or has the server play them, then hands the turn on; releasing
// the hold any other way hands it on too (src/lib/dm/initiative.ts).

// Whether a person is playing the monsters right now: a human DM in the seat
// and no AI cover stretch answering for them.
export function personRunsFight(campaign: Campaign): boolean {
  if (!hasHumanDm(campaignSeats(campaign))) {
    return false;
  }
  return !coverInEffect(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, campaign.dmCover);
}

// Called once the pointer has moved (or the order has locked). Records the
// enemies due before the player now up and holds the floor for them.
// Returns the ids recorded.
export function holdForEnemies(campaign: Campaign | null, encounter: Encounter, enemyIds: string[]): string[] {
  if (!campaign || !personRunsFight(campaign)) {
    return [];
  }
  const enemies = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const due = [...new Set(enemyIds)].filter((id) => {
    const enemy = enemies.get(id);
    return Boolean(enemy && canEnemyAct({ enemy, encounter, kind: "action" }).ok);
  });
  if (due.length) {
    encounter.legendary.due = due;
  } else {
    delete encounter.legendary.due;
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
