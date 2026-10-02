// Asks the engine, before a card is posted, whether it may be played at all.
//
// The Hand used to post a card and mark it spent on any 2xx, and the real
// checks (can-act.ts, cast-guard.ts) ran only later, inside the DM's tool
// call: a card from a downed character, off turn, or for a spell not on the
// sheet was accepted, greyed out, and then refused where the player could not
// see why. The same checks now run first, as a dry run that writes nothing,
// and the route answers 409 with the engine's own reason.
//
// Only what the engine can judge from the card alone is asked here: whether
// the character may act, and for a spell the whole cast guard (the spell on
// the sheet, the slot, the casting state, the turn's room for it). Reach,
// the target's AC and everything the dice decide stay with the DM's tool
// call, which the model still makes.
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { canAct, type ActKind } from "@/lib/dm/can-act";
import { freshBudget, spendAction } from "@/lib/dm/action-budget";
import { castSpell } from "@/lib/dm/cast-guard";
import type { MessageIntent } from "@/lib/dm/intent-logic";

const NO_HOOKS = { record: () => {}, publish: () => {} };

function kindOf(intent: MessageIntent): ActKind {
  switch (intent.card) {
    case "attack":
    case "rider":
      return "attack";
    case "spell":
      return "cast";
    case "feature":
      return "free";
    case "basic":
      return intent.action === "end-turn" ? "free" : intent.action === "stand-up" ? "move" : intent.bonus ? "bonus" : "action";
    case "reaction":
      return "reaction";
  }
}

// The engine's reason the card cannot be played now, or null.
export function intentRefusal(
  campaign: Campaign,
  sheet: CharacterSheet,
  intent: MessageIntent,
): string | null {
  // Ending a turn is always allowed; the End Turn route owns it.
  if (intent.card === "basic" && intent.action === "end-turn") {
    return null;
  }
  // A reaction spell (Shield, Hellish Rebuke) is a cast like any other; the
  // guard asks canAct for a reaction, so it is judged off turn too.
  if ((intent.card === "spell" || intent.card === "reaction") && intent.spell) {
    const verdict = castSpell(
      campaign,
      "",
      sheet,
      {
        spell: intent.spell,
        ...(intent.slotLevel ? { level: intent.slotLevel } : {}),
        dryRun: true,
      },
      NO_HOOKS,
    );
    return typeof verdict.error === "string" ? verdict.error : null;
  }
  const encounter = getActiveEncounter(campaign.id);
  const able = canAct({ sheet, encounter, kind: kindOf(intent) });
  if (!able.ok) {
    return able.error;
  }
  // A reaction feature (Uncanny Dodge) needs the reaction the fight still
  // holds for them; the spend function says so in the engine's words.
  if (intent.card === "reaction" && encounter?.reactionsUsed.includes(sheet.id)) {
    const spent = spendAction({ ...freshBudget({ ownerId: sheet.id, round: encounter.round }), reactionUsed: true }, "reaction", intent.feature ?? "The reaction", sheet.name);
    return spent.ok ? null : spent.error;
  }
  return null;
}
