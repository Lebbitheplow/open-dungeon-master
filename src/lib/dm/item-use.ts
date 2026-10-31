// The use_item cases the gear engine owns: an item with charges (a wand, a
// staff, a once-a-day power), which spends charges and stays in the pack.
// mutations.ts asks here first; null means "an ordinary consumable", and
// use_item goes on as before (src/lib/dm/resource-tools.ts computeUseItem).
//
// SRD 5.1: activating a magic item is an action in a fight ("Activating an
// Item": most items that need an action, and the wands and staffs all say
// "you can use an action"), an item that asks for attunement works only for
// someone attuned to it, and a creature at 0 hit points uses nothing. An
// item with no charges that casts a spell at will (a Hat of Disguise) is
// owned here too: its cast spends nothing but the action.

import { readiedReleaseFor } from "@/lib/dm/readied-release";
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { publishWithSeq } from "@/lib/events";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { carriedItemsMatching } from "@/lib/dm/item-logic";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import { rollExpression } from "@/lib/dice";
import { itemSpellCast, itemSpellsOfRow, type ItemSpellCast } from "@/lib/srd/item-spells";
import { recordItemCast } from "@/lib/srd/item-cast-credit";
import {
  chargeMax,
  chargeRuleOf,
  equipmentAfterSpend,
  spendChargesMath,
  writeCharges,
} from "@/lib/dm/item-charges";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { gearDefOfRow } from "@/lib/srd/magic-gear";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { RollResult } from "@/lib/dice";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";

function publishRoll(campaign: Campaign, sheet: CharacterSheet, detail: string, result: RollResult) {
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "custom",
    detail,
    result,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
}

// The ability check a cast waits on (Amulet of the Planes), rolled as
// request_roll rolls one, on a card the table sees. True on a success.
function rollCastCheck(campaign: Campaign, sheet: CharacterSheet, check: NonNullable<ItemSpellCast["check"]>, detail: string): { total: number; success: boolean } {
  const resolved = resolveRollExpression({ kind: "ability_check", ability: check.ability, dc: check.dc } as unknown as RollArgs, sheet, rollExtrasFor(campaign, sheet, "ability_check"));
  if ("error" in resolved || "autoFail" in resolved) {
    return { total: 0, success: false };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const outcome = rollExpression(resolved.expression);
  const roll = insertRoll({ campaignId: campaign.id, characterId: sheet.id, requestedBy: "dm", kind: "ability_check", detail, dc: check.dc, result: outcome });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  return { total: outcome.total, success: outcome.total >= check.dc };
}

const ABILITY_WORD = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;

// Spends charges from a carried charged item, or casts the at-will spell of
// one with none. Null for an item that is neither, so use_item treats it as
// it always has. With `spell`, the item casts that spell
// (src/lib/srd/item-spells.ts): the table sets the cost and the level, and
// the tool that resolves the spell next spends no slot for it
// (src/lib/srd/item-cast-credit.ts).
export function chargedItemUse(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  itemName: string,
  charges: number | undefined,
  spell?: string,
): ToolResult | null {
  // A name that fits a charged or spell-casting item and something else as
  // well is a guess: "healing" with a Staff of Healing and a potion in the
  // pack. Nothing is spent on a guess.
  const matching = carriedItemsMatching(sheet.equipment, itemName);
  const magicMatches = matching.filter((item) => chargeRuleOf(item) || itemSpellsOfRow(item).length);
  if (magicMatches.length && matching.length > 1) {
    return {
      error: `"${itemName}" could mean ${matching.map((item) => item.name).join(" or ")}; name the item exactly. Nothing was spent.`,
      retry: true,
    };
  }
  const carried = magicMatches[0] ?? null;
  if (!carried) {
    return null;
  }
  const rule = chargeRuleOf(carried);
  // An item with no charges casts at will: the spell named, or the one spell
  // it has (an Elemental Gem's conjure elemental, a Hat of Disguise's
  // disguise self). One that casts several is asked which.
  const atWill = rule ? [] : itemSpellsOfRow(carried);
  const named = spell?.trim() || (atWill.length === 1 ? atWill[0].spell : "");
  if (!rule && !named) {
    return {
      error: `${carried.name} casts ${atWill.map((entry) => entry.spell).join(", ")} at will; name the one cast in spell. Nothing was spent.`,
      retry: true,
    };
  }
  const cast = named ? itemSpellCast(carried, named, charges) : null;
  if (cast && "error" in cast) {
    return { ...toolError(cast), error: `${cast.error} Nothing was spent.` };
  }
  if (!rule && cast && cast.charges > 0) {
    return { error: `${carried.name} holds no charges, and ${cast.spell} from it costs ${cast.charges}. Nothing was spent.`, refused: "rules" };
  }
  const count = cast ? cast.charges : Math.max(1, Math.round(charges ?? 1));
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return {
      error: `${sheet.name} is ${sheet.deathSaves?.dead ? "dead" : "unconscious at 0 hit points"} and cannot use ${carried.name}.`,
      refused: "rules",
    };
  }
  const def = gearDefOfRow(carried);
  if (def?.requiresAttunement && !carried.attuned) {
    return {
      error: `${carried.name} works only for someone attuned to it, and ${sheet.name} is not; attuning takes a short rest with the item. Nothing was spent.`,
      refused: "rules",
    };
  }
  // In a fight, activating the item is the character's action, or the bonus
  // action its text names (Ring of Jumping, a prayer bead).
  const kind = cast?.bonusAction ? "bonus" : "action";
  const encounter = getActiveEncounter(campaign.id);
  let budget: ReturnType<typeof budgetFor> = null;
  // Off their turn, the use of an item they readied: their reaction, and
  // nothing of the acting combatant's turn (readied-release.ts).
  const readied = readiedReleaseFor(sheet, encounter, "item");
  if (readied && "error" in readied) {
    return toolError(readied);
  }
  if (encounter && !readied) {
    const able = canAct({ sheet, encounter, kind });
    if (!able.ok) {
      return toolError(able);
    }
    budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
    if (budget) {
      const spent = spendAction(budget, kind, `using ${carried.name}`, sheet.name);
      if (!spent.ok) {
        return toolError(spent);
      }
      budget = spent.budget;
    }
  }
  // An item with no charges spends none: it is only gone when the cast uses
  // it up.
  const math = rule ? spendChargesMath(carried, rule, count) : { charges: 0, destroyed: Boolean(cast?.usesUp), notes: [] as string[] };
  if ("error" in math) {
    return { ...toolError(math), error: `${math.error} Nothing was spent.` };
  }
  if (encounter && budget) {
    storeBudget(encounter, budget);
  }
  readied?.release();
  if ("initial" in math && math.initial) {
    publishRoll(campaign, sheet, `${carried.name}: charges it holds`, math.initial);
  }
  if ("d20" in math && math.d20) {
    publishRoll(campaign, sheet, `${carried.name}: the last charge`, math.d20);
  }
  if ("regained" in math && math.regained) {
    publishRoll(campaign, sheet, `${carried.name}: charges regained on a 20`, math.regained);
  }
  if ("overuse" in math && math.overuse) {
    publishRoll(campaign, sheet, `${carried.name}: used again before dawn`, math.overuse);
  }
  const destroyed = math.destroyed || Boolean(cast?.usesUp);
  const becomes = "becomes" in math ? math.becomes : undefined;
  if (rule || destroyed) {
    const equipment = equipmentAfterSpend(sheet.equipment, carried, math.charges, destroyed, becomes);
    writeCharges(campaign.id, sheet, equipment, "use_item", rule ? `${carried.name}: ${count} charge${count === 1 ? "" : "s"}` : `${carried.name}: used up`, turnId);
  }
  // The check the cast waits on (Amulet of the Planes); a failure casts
  // nothing, and the item's text says what happens instead.
  const check = cast?.check && !("failed" in math && math.failed) ? rollCastCheck(campaign, sheet, cast.check, `${sheet.name}: ${carried.name}, ${ABILITY_WORD[cast.check.ability]} check`) : null;
  const casts = cast && !("failed" in math && math.failed) && (!check || check.success) ? cast : null;
  if (casts) {
    recordItemCast(sheet.id, {
      spell: casts.spell,
      level: casts.level,
      item: carried.name,
      ...(casts.dc ? { saveDc: casts.dc } : {}),
      ...(casts.attackBonus ? { attackBonus: casts.attackBonus } : {}),
    });
  }
  const most = rule ? chargeMax(rule) : 0;
  const numbers = (entry: ItemSpellCast) => [entry.dc ? `save DC ${entry.dc}` : "", entry.attackBonus ? `spell attack +${entry.attackBonus}` : ""].filter(Boolean).join(", ");
  return {
    ok: true,
    used: carried.name,
    ...(rule
      ? {
          chargesSpent: count,
          chargesLeft: destroyed || becomes ? 0 : math.charges,
          ...(most ? { chargesMax: most } : {}),
        }
      : {}),
    ...(destroyed ? { destroyed: true } : {}),
    ...(becomes ? { becomes } : {}),
    ...(rule?.daily ? { power: rule.daily } : {}),
    ...(casts
      ? { spellCast: casts.spell, spellLevel: casts.level, ...(casts.dc ? { saveDc: casts.dc } : {}), ...(casts.attackBonus ? { attackBonus: casts.attackBonus } : {}) }
      : cast
        ? { spellCast: false }
        : {}),
    note: [
      // A spell the item casts at will (Staff of the Woodlands' pass
      // without trace, a Hat of Disguise) spends no charge.
      !rule
        ? destroyed
          ? `${carried.name} is used up.`
          : `No charge is spent: ${carried.name} casts it at will.`
        : count === 0
          ? `No charge is spent; ${math.charges} left.`
          : `${count} charge${count === 1 ? "" : "s"} spent; ${destroyed ? "the item is gone" : becomes ? `the item is a ${becomes} now` : `${math.charges} left`}${
              rule.regain && !destroyed && !becomes ? (rule.regain === "all" ? `, all back at ${rule.regainAtDusk ? "dusk" : "dawn"}` : `, ${rule.regain} back at ${rule.regainAtDusk ? "dusk" : "dawn"}`) : ""
            }.`,
      ...math.notes,
      check && cast?.check
        ? `${ABILITY_WORD[cast.check.ability]} check ${check.total} against DC ${cast.check.dc}: ${check.success ? "a success" : `a failure, and ${cast.spell} is not cast. Narrate what the item's text says a failure does`}.`
        : "",
      casts
        ? `${sheet.name} casts ${casts.spell} at level ${casts.level} from ${carried.name}${numbers(casts) ? ` (${numbers(casts)})` : ""}. Resolve it now with the spell's own tool (aoe_damage, cast_at_enemy, heal, cast_buff) naming the spell: that cast spends no slot and uses the item's numbers.`
        : cast
          ? ""
          : "No spell slot is spent. Resolve what the item does with the tool for it (aoe_damage, apply_damage, set_condition, heal) and narrate it.",
    ].filter(Boolean).join(" "),
  };
}
