// Spending hit dice at the end of a short rest: the server rolls them, each
// die heals its face plus the Constitution modifier (never below 0 for that
// die), and the healing stops at the character's maximum. Shared by the rest
// tool (the DM's take_rest) and the player's own choice after it
// (POST /api/campaigns/[campaignId]/sheet/hit-dice).
//
// SRD 5.1, Short Rest: "A character can spend one or more Hit Dice at the end
// of a short rest ... For each Hit Die spent in this way, the player rolls
// the die and adds the character's Constitution modifier to it. The player
// can decide to spend an additional Hit Die after each roll." The player
// decides; the server's own choice (spend toward half HP) stands in only for
// a character with no player at the table.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { onlineUserIds, publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { songOfRestDieFor } from "@/lib/srd/feature-effects";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { healMath } from "@/lib/dm/mutation-math";
import { hitDiceHealing, hitDicePlanExpression, shortRestDicePlan } from "@/lib/dm/rest-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { hitDiceHealingFactor } from "@/lib/dm/afflictions";

export type HitDiceOutcome =
  | { error: string }
  | { name: string; diceSpent: number; healed: number; hp: string; rollId: string };

// Rolls `requested` hit dice for one character (as many as they have left),
// heals them, and writes the spend with an audit entry the lead can undo.
export function spendHitDice(input: {
  campaign: Campaign;
  turnId: string | null;
  sheetId: string;
  requested: number;
  songDie: string | null;
  reason: string;
  requestedBy: "dm" | "player";
}): HitDiceOutcome {
  const { campaign } = input;
  const sheet = getSheetById(input.sheetId);
  if (!sheet) {
    return { error: "Character not found." };
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is dead and spends no hit dice.` };
  }
  if (sheet.currentHp <= 0) {
    return {
      error: `${sheet.name} is unconscious at 0 hit points; hit dice cannot be spent until they are healed or stable and awake.`,
    };
  }
  const available = Math.max(0, sheet.hitDice.total - sheet.hitDice.spent);
  const count = Math.min(input.requested, available);
  if (count < 1) {
    return { error: `${sheet.name} has no hit dice left; they come back with a long rest.` };
  }
  const conMod = computeSheetDerived(sheet).abilityMods.con;
  // Multiclass sheets draw from their per-class pools, biggest die first
  // (the same order patchSheet reconciles the spent counter in).
  const expression = `${hitDicePlanExpression(shortRestDicePlan(sheet, count), conMod)}${
    input.songDie ? `+1${input.songDie}` : ""
  }`;
  const outcome = rollExpression(expression);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: input.requestedBy,
    kind: "custom",
    detail: `short rest: ${count} hit ${count === 1 ? "die" : "dice"}${
      input.songDie ? ` + Song of Rest ${input.songDie}` : ""
    }`,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  // Each die is floored at 0 on its own; the total is not what is floored.
  // Sewer plague: hit dice heal half the normal number (afflictions.ts).
  const healed = Math.floor(hitDiceHealing(outcome, conMod, Boolean(input.songDie)) * hitDiceHealingFactor(sheet));
  const ceiling = effectiveMaxHp(sheet);
  const math = healMath(Math.min(sheet.currentHp, ceiling), ceiling, healed);
  const patch = {
    currentHp: math.currentHp,
    hitDice: { ...sheet.hitDice, spent: sheet.hitDice.spent + count },
  };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId: input.turnId,
    ...(input.requestedBy === "player" ? { actor: "player" } : {}),
    kind: "rest_short",
    delta: patch,
    reason: input.reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return {
    name: sheet.name,
    diceSpent: count,
    healed: math.currentHp - sheet.currentHp,
    hp: `${math.currentHp}/${ceiling}`,
    rollId: roll.id,
  };
}

// Whether a player at the table chooses this character's hit dice: its owner
// is connected to the campaign right now. The server spends for anyone else.
export function playerChoosesHitDice(campaignId: string, sheet: Pick<CharacterSheet, "userId">): boolean {
  return Boolean(sheet.userId) && onlineUserIds(campaignId).includes(sheet.userId);
}

// The best Song of Rest die anyone conscious in the party brings. Not a
// limited resource: it applies at every short rest, so there is no counter
// to spend, and one die goes to each creature that spent a Hit Die.
export function partySongOfRestDie(sheets: Array<Pick<CharacterSheet, "id">>): string | null {
  let best: string | null = null;
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id);
    if (!sheet || sheet.currentHp <= 0 || sheet.deathSaves?.dead) {
      continue;
    }
    const die = songOfRestDieFor(sheet);
    if (die && (!best || Number(die.slice(1)) > Number(best.slice(1)))) {
      best = die;
    }
  }
  return best;
}
