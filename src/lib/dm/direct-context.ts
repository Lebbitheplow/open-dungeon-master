// What the engine needs to know beyond a card to resolve it itself
// (intent-logic.ts DirectContext), read from the campaign as it stands: the
// fight, how the card's spell resolves, and whether it is an instant blast
// on the battle map, whose squares the engine catches creatures in (issue
// 570). One reader for the turn's direct cards (src/lib/dm/turn.ts) and for
// a human GM's own card (the actions route), so the two cannot drift.
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { spellEngineName, spellMechanicsFor } from "@/lib/content";
import { blastPickOf } from "@/lib/battlemap/area-shape";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import { spellAreaShape } from "@/lib/dm/aoe-shape";
import type { DirectContext, MessageIntent } from "@/lib/dm/intent-logic";

export function directContextFor(campaignId: string, intent: MessageIntent, authors: string[]): DirectContext {
  const encounter = getActiveEncounter(campaignId);
  const spell = intent.card === "spell" || intent.card === "reaction" ? intent.spell : undefined;
  const mech = spell ? (spellMechanicsFor({ spell, userIds: authors })?.mech ?? null) : null;
  // A save or a blast that hits without one fills the area its text prints,
  // whatever the parsed row says: the parser misses a line "100 feet long"
  // and a "10-foot-radius sphere", and Lightning Bolt went to cast_at_enemy
  // at one goblin.
  const rolled = mech?.resolution === "save" || mech?.resolution === "auto";
  const shape = spell && (mech?.area || rolled) ? spellAreaShape(spell, authors) : null;
  const area = Boolean(mech?.area) || Boolean(rolled && shape);
  // A lasting area (a Web) is laid by its zone row and bites when its row
  // says, so only an instant blast on a board is caught at once.
  const blast =
    encounter && spell && shape && rolled && !zoneRowFor({ spell, runsAs: spellEngineName(spell, authors) }) && getBattleMapForEncounter(encounter.id)
      ? blastPickOf(shape)
      : null;
  // How the casting is shared out, when it can be (castShares).
  const shareKind = mech?.darts ? "darts" : mech?.attacks ? "attacks" : mech?.targets && !area ? "targets" : null;
  return {
    inFight: Boolean(encounter),
    resolution: mech?.resolution ?? null,
    area,
    ...(blast ? { blast } : {}),
    ...(shareKind ? { shareKind } : {}),
    ...(mech?.riders?.clusterFeet ? { cluster: true } : {}),
  };
}
