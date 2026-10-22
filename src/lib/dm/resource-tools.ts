import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { breakConcentration } from "@/lib/dm/concentration";
import { aoeSpendFor } from "@/lib/srd/aoe-spend";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { ELEMENTAL_WILD_SHAPE_COST, elementalWildShape, wildShapeUse, type WildShapeAsk } from "@/lib/dm/wild-shape-use";
import { isUnlimited, matchResource, RAGING, recoveringPrefix, resourceLevel, type ResourceDef } from "@/lib/srd/class-resources";
import { effectiveMaxHp, incapacitatedBy, wearsHeavyArmor } from "@/lib/dm/condition-logic";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { consumableEffect, findCarriedItem, notCarried } from "@/lib/dm/item-logic";
import { kiTechnique, spendKiTechnique, spendQuickenedSpell } from "@/lib/dm/bonus-actions";
import { removeItemMath } from "@/lib/dm/mutation-math";
import { textKey } from "@/lib/language/text-logic";
import { optionsOfKind } from "@/lib/srd/options";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { holdsMote } from "@/lib/srd/authored-effects-more";
import { noneNamed, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { isConditionNamed, nameChoice } from "@/lib/srd/feature-names";
import { isTableGearName } from "@/lib/db/homebrew";
import { spentSlotRefusal } from "@/lib/dm/cast-rules";

export { computePurchase } from "@/lib/dm/purchase-math";

// Handlers for the resource-engine mutation tools: use_item (atomic
// consumable use), purchase (atomic gold + item trade), and use_resource
// (limited-use class features). Dispatched from applyDmMutation, which owns
// the sheet resolution, audit, and publish plumbing; these helpers compute
// the patch + result so mutations.ts only grows dispatch lines. Must not
// import mutations.ts (the import points the other way).

export type Outcome = {
  patch: FullPatchSheetInput;
  result: ToolResult;
  // Extra target-sheet patch for use_item fed to someone else.
  healTarget?: { characterId: string; amount: number };
  // Extra target-sheet patch for a feature that lands on someone else
  // (Bardic Inspiration). Applied and published by the caller.
  patchTarget?: { characterId: string; patch: FullPatchSheetInput };
  event?: string;
  // Wild Shape: how many in-world hours the form lasts, for the clock.
  shapeHours?: number;
};

// Rolls healing server-side as a visible dice card, exactly as a player's
// own roll would appear. Shared by the potion path and the class-feature
// healing path; the heal itself always rides the standard heal mutation so
// the death engine wakes a dying target. Exported for the Combat Wild Shape
// slot-heal in mutations.ts.
export function rollHealing(
  campaign: Campaign,
  target: CharacterSheet,
  detail: string,
  expression: string,
): number {
  const outcome = rollExpression(expression);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: target.id,
    requestedBy: "dm",
    kind: "custom",
    detail: `${detail} (${expression})`,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  return outcome.total;
}

export function computeUseItem(
  campaign: Campaign,
  sheet: CharacterSheet,
  target: CharacterSheet,
  itemName: string,
): Outcome | ToolError {
  const carried = findCarriedItem(sheet.equipment, itemName);
  if (!carried) {
    const refusal = notCarried(sheet.name, sheet.equipment.map((item) => item.name), itemName, isTableGearName(campaign.id, itemName));
    return { ...refusal, error: `${refusal.error} One taken in this same action is given with grant_item first, then used.` };
  }
  const removal = removeItemMath(sheet.equipment, carried.name, 1);
  if (!removal) {
    return notCarried(sheet.name, sheet.equipment.map((item) => item.name), itemName, isTableGearName(campaign.id, itemName));
  }
  const effect = consumableEffect(carried);
  const base: Outcome = {
    patch: { equipment: removal.equipment },
    result: {
      ok: true,
      used: carried.name,
      remaining: removal.equipment.find((entry) => entry.name === carried.name)?.qty ?? 0,
    },
  };
  if (effect.kind === "healing") {
    if (target.deathSaves?.dead) {
      return { error: `${target.name} is DEAD; a potion cannot help.`, refused: "rules" };
    }
    const total = rollHealing(campaign, target, carried.name, effect.expression);
    base.healTarget = { characterId: target.id, amount: Math.max(1, total) };
    base.result.healingRolled = total;
  }
  return base;
}

// How the target of an inspiration die carries it: a condition on their
// sheet that the next d20 roll consumes (src/lib/dm/rolls.ts). The die size
// rides in the name so one string carries the whole effect.
export function inspirationCondition(die: string): string {
  return `bardic inspiration (${die})`;
}

// 10 minutes of rounds, the SRD duration for a held inspiration die.
const INSPIRATION_ROUNDS = 100;

// ---- Font of Magic (sorcery-point <-> spell-slot conversion) ----

// SRD point cost to create a slot of each level; slots above 5th cannot be
// created. The reverse direction refunds points equal to the slot's level.
const FONT_SLOT_COST: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };

type FontDirection = "create_slot" | "recover_points";

// The two conversions by the variant the Sorcery Points guidance names (a
// fixed choice, src/lib/srd/class-resources.ts); the slot level is the call's
// amount, as Primeval Awareness takes it. Any other variant is a plain
// Metamagic spend (null).
const FONT_OF_MAGIC = new Map<string, FontDirection>([
  ["create slot", "create_slot"],
  ["convert slot", "recover_points"],
]);

export function fontOfMagicDirection(variant: string | undefined): FontDirection | null {
  return FONT_OF_MAGIC.get(textKey(variant ?? "")) ?? null;
}

function computeFontOfMagic(
  sheet: CharacterSheet,
  displayName: string,
  state: { max: number; used: number },
  conversion: { direction: FontDirection; level: number },
): Outcome | ToolError {
  const { direction, level } = conversion;
  if (!sheet.spellcasting) {
    return { error: `${sheet.name} has no spellcasting to convert ${displayName} into.`, refused: "rules" };
  }
  const slots = { ...sheet.spellcasting.slots };
  const key = String(level);
  if (direction === "create_slot") {
    const cost = FONT_SLOT_COST[level];
    if (!cost) {
      return { error: `Font of Magic cannot create a slot above 5th level.`, refused: "rules" };
    }
    const left = state.max - state.used;
    if (left < cost) {
      return {
        error: `Creating a level-${level} slot costs ${cost} sorcery points; ${sheet.name} has ${left}/${state.max} left.`,
        refused: "rules",
      };
    }
    const slot = slots[key];
    // A spent slot returns first; otherwise a bonus slot rides on max until
    // the long rest claws created slots back (rest-logic.ts).
    slots[key] = slot
      ? slot.used > 0
        ? { max: slot.max, used: slot.used - 1 }
        : { max: slot.max + 1, used: slot.used }
      : { max: 1, used: 0 };
    return {
      patch: {
        resources: {
          ...sheet.resources,
          sorcery_points: { max: state.max, used: state.used + cost },
        },
        spellcasting: { ...sheet.spellcasting, slots },
      },
      result: {
        ok: true,
        resource: displayName,
        spent: cost,
        left: `${left - cost}/${state.max}`,
        created: `one level-${level} spell slot`,
        note: "Created slots vanish at the end of a long rest.",
      },
    };
  }
  // recover_points: break an unspent slot of this level into points.
  const slot = slots[key];
  if (!slot || slot.used >= slot.max) {
    return spentSlotRefusal(sheet.name, sheet.spellcasting, { level, lowest: 1, what: `converting into ${displayName}`, withPact: false });
  }
  const refund = Math.min(level, state.used);
  if (refund <= 0) {
    return {
      error: `${sheet.name} is already at full ${displayName} (${state.max - state.used}/${state.max}); breaking a slot would waste it.`,
      refused: "rules",
    };
  }
  slots[key] = { max: slot.max, used: slot.used + 1 };
  return {
    patch: {
      resources: {
        ...sheet.resources,
        sorcery_points: { max: state.max, used: state.used - refund },
      },
      spellcasting: { ...sheet.spellcasting, slots },
    },
    result: {
      ok: true,
      resource: displayName,
      converted: `one level-${level} spell slot`,
      regained: `${refund} sorcery point${refund === 1 ? "" : "s"}`,
      left: `${state.max - state.used + refund}/${state.max}`,
    },
  };
}

type PoolState = CharacterSheet["resources"][string];

// What pays for a use: the pool itself or, with no use left, a pool that
// pays for one instead (Breath of the Dragon's 2 ki); the refusal when
// neither can. Asked before an option is asked for too (mutations.ts).
export function payForUse(
  sheet: CharacterSheet,
  def: ResourceDef,
  state: PoolState,
  amount: number,
): { fallback: { id: string; amount: number; state: PoolState } | null } | ToolError {
  const left = state.max - state.used;
  if (left >= amount) {
    return { fallback: null };
  }
  const fallback = def.fallbackPool ?? null;
  const fallbackState = fallback ? sheet.resources[fallback.id] : undefined;
  if (fallback && fallbackState && fallbackState.max - fallbackState.used >= fallback.amount) {
    return { fallback: { ...fallback, state: fallbackState } };
  }
  return {
    error: `${sheet.name} has ${left}/${state.max} ${def.displayName} left; they cannot spend ${amount}.${
      fallback ? ` With none left it costs ${fallback.amount} ${fallback.id.replace(/_/g, " ")}, and they have ${fallbackState ? fallbackState.max - fallbackState.used : 0}.` : ""
    } The feature is not available; narrate accordingly.`,
    refused: "rules",
  };
}

// The marker a spend leaves when its use returns only after a rolled number
// of long rests: "<name> recovering (n)", counted down by each long rest.
function recoveryMarker(campaign: Campaign, sheet: CharacterSheet, def: ResourceDef): { conditions: string[]; note: string } {
  const rests = Math.max(1, rollHealing(campaign, sheet, `${def.displayName}: long rests until it returns`, def.recovers ?? "1"));
  const prefix = recoveringPrefix(def.displayName);
  return {
    conditions: [...sheet.conditions.filter((entry) => !isConditionNamed(entry, prefix)), `${prefix} (${rests})`],
    note: `${def.displayName} comes back after ${rests} long rest${rests === 1 ? "" : "s"}.`,
  };
}

export function computeUseResource(
  campaign: Campaign,
  sheet: CharacterSheet,
  target: CharacterSheet,
  resourceName: string,
  amount: number,
  form?: WildShapeAsk,
  variant?: string,
  // The reaction gate judged the character as they stood before the hit
  // that dropped them (a reaction that answers it, or one taken on dropping
  // to 0): the use goes ahead at 0 hit points (issue 233).
  reacting?: { beforeDrop?: boolean },
): Outcome | ToolError {
  const def = matchResource(resourceName);
  const state = def ? sheet.resources[def.id] : undefined;
  if (!def || !state) {
    const available = Object.keys(sheet.resources);
    const theirs = available.length ? ` Their resources: ${available.join(", ")}.` : " They have no limited-use resources.";
    // A resource the rules know that the sheet lacks is the game saying no;
    // a name nobody knows is the call's to fix, from the list.
    return def
      ? { error: `${sheet.name} has no tracked resource "${resourceName}".${theirs}`, refused: "rules" }
      : { error: `No resource called "${resourceName}" is known.${theirs} Send the one meant, by the name on the sheet.`, retry: true };
  }
  if (def.passive) {
    return {
      error: `${def.displayName} is not spent by choice: ${def.guidance} Do not call use_resource for it.`,
      retry: true,
    };
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is dead and cannot use ${def.displayName}.`, refused: "rules" };
  }
  const standing = Boolean(reacting?.beforeDrop) && def.action === "reaction";
  if (sheet.currentHp <= 0 && !standing) {
    return {
      error: `${sheet.name} is at 0 HP and cannot use ${def.displayName}; they are unconscious and take no actions.`,
      refused: "rules",
    };
  }
  const stoppedBy = standing ? null : incapacitatedBy(sheet.conditions);
  if (stoppedBy) {
    return {
      error: `${sheet.name} is ${stoppedBy} and cannot use ${def.displayName} until the condition ends.`,
      refused: "rules",
    };
  }

  // The monk's ki techniques spend the bonus action and land their effect
  // (src/lib/dm/bonus-actions.ts); a plain spend (Stunning Strike's point)
  // passes no variant and falls through to the generic path below.
  if (def.id === "ki") {
    const technique = kiTechnique(variant);
    if (technique) {
      return spendKiTechnique(campaign, sheet, technique, variant);
    }
    if (variant?.trim()) {
      return {
        error: `${def.displayName} takes variant 'flurry of blows', 'patient defense', 'step of the wind' ('step of the wind dash' to Dash), 'diamond soul' or 'empty body'; "${variant}" is none of them. A plain spend (Stunning Strike) names no variant. Nothing was spent.`,
        retry: true,
      };
    }
  }

  // Font of Magic: sorcery points convert into a spell slot and back, the
  // direction in the variant and the slot level in amount; a plain spend
  // (Metamagic) falls through to the generic path below.
  if (def.id === "sorcery_points") {
    // The variant as its rules text lists it (class-resources.ts).
    if (textKey(variant ?? "") === "quickened spell") {
      return spendQuickenedSpell(campaign, sheet, state);
    }
    const direction = fontOfMagicDirection(variant);
    if (direction) {
      return computeFontOfMagic(sheet, def.displayName, state, { direction, level: amount });
    }
    // Any other variant is a value off the list, never a spend: a plain
    // Metamagic spend names no variant, or the option it pays for.
    if (variant?.trim() && !optionsOfKind("metamagic").some((option) => textKey(option.n) === textKey(variant))) {
      return {
        error: `${def.displayName} takes variant 'create slot' or 'convert slot' (Font of Magic, the slot's level in amount), 'Quickened Spell', or a Metamagic option by its name; "${variant}" is none of them. For a Metamagic spend give the points in amount. Nothing was spent.`,
        retry: true,
      };
    }
  }

  // Reverting a Wild Shape costs nothing: a second call while shaped drops
  // the form rather than burning another use.
  if (def.effect.kind === "wild_shape" && sheet.wildShape) {
    const form = sheet.wildShape.form;
    return {
      patch: { wildShape: null },
      result: {
        ok: true,
        reverted: form,
        hp: `${sheet.currentHp}/${sheet.maxHp}`,
        note: `${sheet.name} returns to their own body with the hit points they had before shifting. No use was spent.`,
      },
    };
  }

  // Elemental Wild Shape spends two uses at once, or is refused before
  // anything is spent (src/lib/dm/wild-shape-use.ts).
  const elementalAsk = def.effect.kind === "wild_shape" ? elementalWildShape(sheet, form?.name) : null;
  if (elementalAsk && "error" in elementalAsk) {
    return elementalAsk;
  }
  const elemental = elementalAsk?.form ?? null;
  const cost = elemental ? ELEMENTAL_WILD_SHAPE_COST : amount;

  if (def.requires === "below_half" && sheet.currentHp >= effectiveMaxHp(sheet) / 2) {
    return {
      error: `${def.displayName} is used when ${sheet.name} has fewer than half of their hit points left, and they have ${sheet.currentHp}/${effectiveMaxHp(sheet)}. Nothing was spent.`,
      refused: "rules",
    };
  }
  // A pool a single use may only dip into (Balm of the Summer Court: half the
  // druid level of dice; Healing Light: the Charisma modifier).
  if (def.perUse) {
    const cap =
      def.perUse === "half_level"
        ? Math.max(1, Math.floor(resourceLevel(def, sheet) / 2))
        : Math.max(1, computeSheetDerived(sheet).abilityMods.cha);
    if (amount > cap) {
      return {
        error: `${def.displayName} spends at most ${cap} at a time for ${sheet.name} (${def.perUse === "half_level" ? "half their level" : "their Charisma modifier"}); ${amount} is more. Nothing was spent.`,
        retry: true,
      };
    }
  }
  const left = state.max - state.used;
  const payment = payForUse(sheet, def, state, cost);
  if ("error" in payment) {
    return payment;
  }
  const paid = payment.fallback;
  // A feature with no limit is used, not counted down.
  const unlimited = isUnlimited(state);
  const spent = paid
    ? { ...sheet.resources, [paid.id]: { max: paid.state.max, used: paid.state.used + paid.amount } }
    : unlimited
      ? sheet.resources
      : { ...sheet.resources, [def.id]: { max: state.max, used: state.used + cost } };
  // A use that returns only after several long rests (Limited Wish): the
  // marker the rest counts down (src/lib/dm/rest-logic.ts).
  const recovering = def.recovers && !paid && !unlimited ? recoveryMarker(campaign, sheet, def) : null;
  const outcome: Outcome = {
    patch: { resources: spent, ...(recovering ? { conditions: recovering.conditions } : {}) },
    result: {
      ok: true,
      ...(recovering ? { returns: recovering.note } : {}),
      resource: def.displayName,
      spent: paid ? `${paid.amount} ${paid.id.replace(/_/g, " ")} (no use was left)` : cost,
      left: unlimited ? "unlimited" : paid ? `0/${state.max}` : `${left - cost}/${state.max}`,
      refills: def.recharge === "short" ? "on any rest" : "on a long rest",
      effect: def.guidance,
    },
  };

  const derived = computeSheetDerived(sheet);
  // Multiclass: an effect's level-scaled dice read the owning class's level
  // (Second Wind heals 1d10 + FIGHTER level), not the summed character level.
  const fxLevel = resourceLevel(def, sheet);
  switch (def.effect.kind) {
    case "heal_self": {
      // "halfmax": half the character's hit point maximum (Unearthly Recovery).
      const expression = def.effect.dice(fxLevel, derived.abilityMods).replace(/\bhalfmax\b/g, String(Math.floor(effectiveMaxHp(sheet) / 2)));
      const total = rollHealing(campaign, sheet, def.displayName, expression);
      outcome.healTarget = { characterId: sheet.id, amount: Math.max(1, total) };
      outcome.result.healingRolled = total;
      return outcome;
    }
    case "heal_pool": {
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.`, refused: "rules" };
      }
      outcome.healTarget = { characterId: target.id, amount };
      outcome.result.healed = `${amount} HP to ${target.name}`;
      return outcome;
    }
    case "heal_dice_pool": {
      // Each spent use is one die of healing to the target.
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.`, refused: "rules" };
      }
      const total = rollHealing(campaign, target, def.displayName, `${amount}${def.effect.die}`);
      outcome.healTarget = { characterId: target.id, amount: Math.max(1, total) };
      outcome.result.healingRolled = total;
      outcome.result.healed = `${total} HP to ${target.name}`;
      // Balm of the Summer Court: a temporary hit point for each die, kept
      // only when it beats what the creature already has.
      const temp = (def.effect.tempPerDie ?? 0) * amount;
      if (temp > target.tempHp) {
        if (target.id === sheet.id) {
          outcome.patch.tempHp = temp;
        } else {
          outcome.patchTarget = { characterId: target.id, patch: { tempHp: temp } };
        }
        outcome.result.tempHp = `${temp} temporary hit points to ${target.name}`;
      }
      return outcome;
    }
    case "heal_target": {
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.`, refused: "rules" };
      }
      const expression = def.effect.dice(fxLevel, derived.abilityMods);
      const total = rollHealing(campaign, target, def.displayName, expression);
      outcome.healTarget = { characterId: target.id, amount: Math.max(1, total) };
      outcome.result.healingRolled = total;
      return outcome;
    }
    case "temp_hp": {
      const expression = def.effect.dice(fxLevel, derived.abilityMods);
      const total = Math.max(
        1,
        rollHealing(campaign, target, `${def.displayName} (temporary HP)`, expression),
      );
      // 5e temporary hit points never stack; the higher value stands.
      if (target.tempHp >= total) {
        outcome.result.tempHp = `${target.name} keeps their existing ${target.tempHp} temporary hit points (the new ${total} would be lower).`;
        return outcome;
      }
      if (target.id === sheet.id) {
        outcome.patch.tempHp = total;
      } else {
        outcome.patchTarget = { characterId: target.id, patch: { tempHp: total } };
      }
      outcome.result.tempHp = `${total} temporary hit points to ${target.name}`;
      return outcome;
    }
    case "buff": {
      const effect = def.effect;
      // A feature with variants takes the one named whole or by its choice
      // ("bear" for "spirit totem: bear"); a miss is refused, never the
      // first.
      let condition = effect.condition;
      if (effect.variants?.length) {
        const wanted = textKey(variant ?? "");
        const picked = effect.variants.find((entry) => [entry, nameChoice(entry) ?? ""].some((spelling) => textKey(spelling) === wanted));
        if (!picked) {
          return wanted
            ? noneNamed(`${def.displayName} has no variant called`, (variant ?? "").trim(), effect.variants)
            : { error: `${def.displayName} needs its variant: ${effect.variants.join(", ")}. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
        }
        condition = picked;
      }
      const recipient = effect.target === "ally" ? target : sheet;
      if (recipient.conditions.some((entry) => entry.toLowerCase() === condition)) {
        return { error: `${recipient.name} is already ${condition}; the feature is already running.`, refused: "rules" };
      }
      const conditionPatch = {
        conditions: [...recipient.conditions, condition],
        conditionMeta: {
          ...recipient.conditionMeta,
          [condition]: { rounds: effect.rounds },
        },
      };
      // Temporary hit points riding the buff (Fighting Spirit, Form of
      // Dread); 5e temp HP never stacks, the higher value stands.
      let tempHpPatch: { tempHp: number } | null = null;
      if (effect.tempHp) {
        const rolled = Math.max(
          1,
          rollHealing(
            campaign,
            recipient,
            `${def.displayName} (temporary HP)`,
            effect.tempHp(sheet.level, derived.abilityMods),
          ),
        );
        if (rolled > recipient.tempHp) {
          tempHpPatch = { tempHp: rolled };
          outcome.result.tempHp = `${rolled} temporary hit points to ${recipient.name}`;
        }
      }
      if (recipient.id === sheet.id) {
        outcome.patch.conditions = conditionPatch.conditions;
        outcome.patch.conditionMeta = conditionPatch.conditionMeta;
        if (tempHpPatch) {
          outcome.patch.tempHp = tempHpPatch.tempHp;
        }
      } else {
        outcome.patchTarget = {
          characterId: recipient.id,
          patch: { ...conditionPatch, ...(tempHpPatch ?? {}) },
        };
      }
      const summary = conditionEffectsFor(condition)?.summary;
      outcome.result.applied = `${condition} on ${recipient.name} for ${effect.rounds} rounds`;
      if (summary) {
        outcome.result.effect = summary;
      }
      return outcome;
    }
    case "enemy_save": {
      // The spend hands back the real numbers; the model resolves the
      // save with cast_at_enemy so the enemy's stat block rolls it.
      const dc =
        derived.spellSaveDc ??
        8 +
          derived.proficiencyBonus +
          Math.max(...Object.values(derived.abilityMods));
      outcome.result.resolveWith = "cast_at_enemy";
      outcome.result.saveAbility = def.effect.save;
      outcome.result.dc = dc;
      if (def.effect.condition) {
        outcome.result.condition = def.effect.condition;
      }
      if (def.effect.dice) {
        outcome.result.dice = def.effect.dice(fxLevel, derived.abilityMods);
      }
      return outcome;
    }
    case "teleport": {
      outcome.result.teleport = `${sheet.name} teleports up to ${def.effect.feet} feet; move their token with move_token (forced: true) if a battle map is live.`;
      return outcome;
    }
    case "condition": {
      const condition = def.effect.condition;
      if (sheet.conditions.some((entry) => entry.toLowerCase() === condition)) {
        return { error: `${sheet.name} is already ${condition}; the feature is already running.`, refused: "rules" };
      }
      // A rage ends any spell the barbarian was concentrating on (SRD 5.1,
      // Rage). Nothing is refused past this point, so it is ended here, and
      // the conditions are read again after the spell's own have come off.
      let holder = sheet;
      if (condition === RAGING && sheet.concentratingOn) {
        const ended = breakConcentration(campaign, null, sheet.id, "entered a rage");
        holder = getSheetById(sheet.id) ?? sheet;
        if (ended) {
          outcome.result.concentrationEnded = `${sheet.name} stops concentrating on ${ended} as the rage takes hold.`;
        }
      }
      outcome.patch.conditions = [...holder.conditions, condition];
      outcome.patch.conditionMeta = {
        ...holder.conditionMeta,
        [condition]: { rounds: def.effect.rounds },
      };
      outcome.result.applied = `${condition} for ${def.effect.rounds} rounds`;
      if (condition === RAGING && wearsHeavyArmor(sheet.equipment)) {
        outcome.result.heavyArmor = `${sheet.name} is wearing heavy armor, so this rage gives none of its benefits: no resistance, no bonus damage, no advantage on Strength. They gain them the moment the armor is off.`;
      }
      return outcome;
    }
    case "inspire": {
      if (target.id === sheet.id) {
        return {
          error: `${def.displayName} goes to another creature, never to the bard themselves. Pass targetCharacterId.`,
          retry: true,
        };
      }
      const die = def.effect.die(fxLevel);
      const condition = inspirationCondition(die);
      if (target.conditions.some((entry) => entry.toLowerCase() === condition)) {
        return { error: `${target.name} already holds an unspent inspiration die.`, refused: "rules" };
      }
      outcome.patchTarget = {
        characterId: target.id,
        patch: {
          conditions: [...target.conditions, condition],
          conditionMeta: {
            ...target.conditionMeta,
            // Who gave it, and a Creation bard's mote with it
            // (src/lib/dm/authored-mote.ts).
            [condition]: { rounds: INSPIRATION_ROUNDS, ...(holdsMote(sheet) ? { source: sheet.id, mote: true } : {}) },
          },
        },
      };
      outcome.result.granted = `1${die} to ${target.name}, spent automatically on their next d20 roll`;
      return outcome;
    }
    case "aoe": {
      const spend = aoeSpendFor(def, sheet, fxLevel, derived)!;
      outcome.result.resolveWith = "aoe_damage";
      outcome.result.dice = spend.dice;
      outcome.result.saveAbility = spend.saveAbility;
      outcome.result.dc = spend.dc;
      if (spend.damageType) {
        outcome.result.damageType = spend.damageType;
      }
      if (spend.area) {
        outcome.result.area = spend.area;
      }
      return outcome;
    }
    case "wild_shape": {
      return wildShapeUse(sheet, outcome, def.displayName, form, elemental);
    }
    case "recover_slots": {
      // Spent through take_rest, which reads the counter and returns the
      // slots; spending it by hand here would burn the use for nothing.
      return {
        error: `${def.displayName} happens as part of a short rest, not on its own. Call take_rest with kind=short and the server applies it.`,
        retry: true,
      };
    }
    case "narrative":
      return outcome;
  }
}
