import { getFloor, setFloor, type Campaign, type Floor, type InitiativeFloor } from "@/lib/db/campaigns";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { getSheetById, setCompanionCommander } from "@/lib/db/sheets";
import { turnUserId } from "@/lib/dm/companion-command";
import { intentOpensNow } from "@/lib/dm/departure-opening";
import { wakeDm } from "@/lib/dm/wake";
import { publishPersisted } from "@/lib/events";

// Whose move the floor says it is while the initiative pointer rests on a
// player character, and the two ways a companion's turn changes hands
// (issue 503). Moved out of src/lib/dm/encounter-tools.ts, which re-exports
// it, so the conscience (src/lib/dm/conscience.ts) can hand a turn to the DM
// without importing the turn machinery that imports it.
//
// Must not import encounter-tools.ts, turn.ts, loop.ts or conscience.ts.

// Exported for src/lib/dm/initiative.ts: a DM editing the order moves the
// pointer without going through advancePointer, and the floor has to follow
// it or the banner and the permission check disagree about whose turn it is.
export function setInitiativeFloor(campaign: Campaign | null, encounter: Encounter) {
  if (!campaign) {
    return;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc") {
    return;
  }
  releaseForOpening(campaign, current.characterId);
  // A companion a player commands puts its turn in that player's hands
  // (src/lib/dm/companion-command.ts).
  const floor: InitiativeFloor = {
    mode: "initiative",
    encounterId: encounter.id,
    userIds: [turnUserId(campaign, current)],
    currentName: current.name,
    round: encounter.round,
  };
  // A hold (held responses) stays a hold: the pointer moved underneath it,
  // and the lead's release opens into the new turn rather than the old one.
  const next: Floor = getFloor(campaign.id).mode === "hold" ? { mode: "hold", next: floor } : floor;
  setFloor(campaign.id, next);
  publishPersisted(campaign.id, "floor_changed", { floor: next });
}

// A companion whose held plan (issue 503 Phase 2: slipping away, or biding
// to strike when the odds turn) finds its opening on its own turn takes
// that turn back from whoever commanded it: the DM plays it, and the turn
// opens with the companion acting on the plan (src/lib/dm/departure.ts
// departureOpenings). Nothing is said: the table learns of it as it goes.
function releaseForOpening(campaign: Campaign, characterId: string) {
  const sheet = getSheetById(characterId);
  if (!sheet?.isCompanion || !sheet.commandedBy || !intentOpensNow(campaign, sheet)) {
    return;
  }
  const updated = setCompanionCommander(sheet.id, null);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// A player's command over a companion ended (a Turn table at a warning,
// src/lib/dm/conscience.ts) on the companion's own turn: the floor follows
// at once and the DM is woken to play it, as the companion's card does when
// whoever runs the story hands it back (PATCH /companions/[characterId]).
// Whether the turn was the companion's.
export function handTurnToDm(campaign: Campaign, characterId: string): boolean {
  const encounter = getActiveEncounter(campaign.id);
  const current = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  if (!encounter || current?.kind !== "pc" || current.characterId !== characterId) {
    return false;
  }
  setInitiativeFloor(campaign, encounter);
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  wakeDm(campaign.id);
  return true;
}
