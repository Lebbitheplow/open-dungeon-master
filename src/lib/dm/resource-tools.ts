import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { findBeastForm, formatCr, wildShapeCapsFor } from "@/lib/srd/beast-forms";
import { matchResource, resourceLevel } from "@/lib/srd/class-resources";
import { classLevelFor, classListFor } from "@/lib/srd/multiclass";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { consumableEffect, findCarriedItem } from "@/lib/dm/item-logic";
import { goldMath, grantItemMath, removeItemMath } from "@/lib/dm/mutation-math";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

// Handlers for the resource-engine mutation tools: use_item (atomic
// consumable use), purchase (atomic gold + item trade), and use_resource
// (limited-use class features). Dispatched from applyDmMutation, which owns
// the sheet resolution, audit, and publish plumbing; these helpers compute
// the patch + result so mutations.ts only grows dispatch lines. Must not
// import mutations.ts (the import points the other way).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const RESOURCE_TOOL_NAMES = ["use_item", "purchase", "use_resource"] as const;

export const resourceTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "use_item",
      description:
        "A character uses up ONE consumable they carry (potion, scroll, thrown flask, ration, torch). The server checks they carry it, applies a healing potion's healing itself (rolling the dice), and decrements or removes the item, all in one call. Never narrate a consumable's use without calling this.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          item: { type: "string", description: "Item name from their equipment." },
          targetCharacterId: {
            type: "string",
            description: "Who receives the effect when fed to someone else; defaults to the user.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "item"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "purchase",
      description:
        "A character buys or sells an item for gold, atomically: buying refuses when the purse cannot cover price x qty, otherwise the gold moves and the item lands in (or leaves) their pack in one audited step. Use this for EVERY trade instead of separate modify_gold and grant_item calls.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          item: { type: "string", description: "Item name." },
          price: { type: "integer", minimum: 0, maximum: 100000, description: "Gold per unit." },
          qty: { type: "integer", minimum: 1, maximum: 99 },
          action: { type: "string", enum: ["buy", "sell"] },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "item", "price", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "use_resource",
      description:
        "A character spends a limited-use class feature tracked in their Resources list (Rage, Ki Points, Second Wind, Action Surge, Channel Divinity, Bardic Inspiration, Wild Shape, Lay on Hands...). The server spends the use AND applies the feature's real effect: Second Wind heals, Lay on Hands moves hit points to the target, Rage grants its resistance and damage, Bardic Inspiration hands the target a die. It refuses at 0 uses left. Call this BEFORE narrating the feature and narrate exactly what it reports back.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          resource: {
            type: "string",
            description: "Resource name from their Resources list, e.g. 'Rage' or 'Ki Points'.",
          },
          amount: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Uses or points to spend (default 1). Lay on Hands spends HP from its pool.",
          },
          targetCharacterId: {
            type: "string",
            description:
              "Who the feature is aimed at, for features that touch someone else (Lay on Hands, Bardic Inspiration). Defaults to the user.",
          },
          form: {
            type: "string",
            description: "Wild Shape only: the beast being assumed, e.g. 'dire wolf'.",
          },
          variant: {
            type: "string",
            description:
              "For features with a choice (Starry Form's archer/chalice/dragon, Spirit Totem's bear/hawk/unicorn): the chosen option.",
          },
          formHp: {
            type: "integer",
            minimum: 1,
            maximum: 300,
            description: "Wild Shape only: the beast form's hit points from its stat block.",
          },
          formAc: {
            type: "integer",
            minimum: 1,
            maximum: 30,
            description: "Wild Shape only: the beast form's armor class.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "resource"],
      },
    },
  },
];

type Outcome = {
  patch: FullPatchSheetInput;
  result: Record<string, unknown>;
  // Extra target-sheet patch for use_item fed to someone else.
  healTarget?: { characterId: string; amount: number };
  // Extra target-sheet patch for a feature that lands on someone else
  // (Bardic Inspiration). Applied and published by the caller.
  patchTarget?: { characterId: string; patch: FullPatchSheetInput };
  event?: string;
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
): Outcome | { error: string } {
  const carried = findCarriedItem(sheet.equipment, itemName);
  if (!carried) {
    return { error: `${sheet.name} does not carry "${itemName}".` };
  }
  const removal = removeItemMath(sheet.equipment, carried.name, 1);
  if (!removal) {
    return { error: `${sheet.name} does not carry "${itemName}".` };
  }
  const effect = consumableEffect(carried.name);
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
      return { error: `${target.name} is DEAD; a potion cannot help.` };
    }
    const total = rollHealing(campaign, target, carried.name, effect.expression);
    base.healTarget = { characterId: target.id, amount: Math.max(1, total) };
    base.result.healingRolled = total;
  }
  return base;
}

export function computePurchase(
  sheet: CharacterSheet,
  args: { item: string; price: number; qty: number; action: "buy" | "sell" },
): Outcome | { error: string } {
  const total = args.price * args.qty;
  if (args.action === "buy") {
    if (sheet.gold < total) {
      return {
        error: `${sheet.name} has ${sheet.gold} gold; ${args.qty > 1 ? `${args.qty}x ` : ""}${args.item} costs ${total}. They cannot afford it.`,
      };
    }
    const gold = goldMath(sheet.gold, -total);
    const items = grantItemMath(sheet.equipment, args.item.slice(0, 80), args.qty);
    return {
      patch: { gold: gold.gold, equipment: items.equipment },
      result: { ok: true, bought: args.item, qty: args.qty, paid: total, gold: gold.gold },
      event: `Bought ${args.item}${args.qty > 1 ? ` x${args.qty}` : ""} for ${total} gold.`,
    };
  }
  const removal = removeItemMath(sheet.equipment, args.item, args.qty);
  if (!removal) {
    return { error: `${sheet.name} does not carry "${args.item}" to sell.` };
  }
  const gold = goldMath(sheet.gold, total);
  return {
    patch: { gold: gold.gold, equipment: removal.equipment },
    result: {
      ok: true,
      sold: args.item,
      qty: removal.removed,
      received: args.price * removal.removed,
      gold: gold.gold,
    },
  };
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

// What a use_resource variant on Sorcery Points asks for, or null for a
// plain Metamagic spend. Direction is read from word order: whichever of
// "slot"/"point" comes later is the product ("points into a slot" creates
// a slot; "slot into points" refunds points).
export function parseFontOfMagic(
  variant?: string,
): { direction: "create_slot" | "recover_points"; level: number } | null {
  const text = (variant ?? "").toLowerCase();
  if (!text.includes("slot")) {
    return null;
  }
  const levelMatch = /([1-9])(?:st|nd|rd|th)?[\s-]*level|level[\s-]*([1-9])/.exec(text);
  const level = Number(levelMatch?.[1] ?? levelMatch?.[2] ?? 1);
  const direction =
    text.includes("point") && text.lastIndexOf("point") > text.lastIndexOf("slot")
      ? ("recover_points" as const)
      : ("create_slot" as const);
  return { direction, level };
}

function computeFontOfMagic(
  sheet: CharacterSheet,
  displayName: string,
  state: { max: number; used: number },
  conversion: { direction: "create_slot" | "recover_points"; level: number },
): Outcome | { error: string } {
  const { direction, level } = conversion;
  if (!sheet.spellcasting) {
    return { error: `${sheet.name} has no spellcasting to convert ${displayName} into.` };
  }
  const slots = { ...sheet.spellcasting.slots };
  const key = String(level);
  if (direction === "create_slot") {
    const cost = FONT_SLOT_COST[level];
    if (!cost) {
      return { error: `Font of Magic cannot create a slot above 5th level.` };
    }
    const left = state.max - state.used;
    if (left < cost) {
      return {
        error: `Creating a level-${level} slot costs ${cost} sorcery points; ${sheet.name} has ${left}/${state.max} left.`,
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
    return {
      error: `${sheet.name} has no unspent level-${level} slot to convert into ${displayName}.`,
    };
  }
  const refund = Math.min(level, state.used);
  if (refund <= 0) {
    return {
      error: `${sheet.name} is already at full ${displayName} (${state.max - state.used}/${state.max}); breaking a slot would waste it.`,
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

export function computeUseResource(
  campaign: Campaign,
  sheet: CharacterSheet,
  target: CharacterSheet,
  resourceName: string,
  amount: number,
  form?: { name?: string; hp?: number; ac?: number },
  variant?: string,
): Outcome | { error: string } {
  const def = matchResource(resourceName);
  const state = def ? sheet.resources[def.id] : undefined;
  if (!def || !state) {
    const available = Object.keys(sheet.resources);
    return {
      error: `${sheet.name} has no tracked resource "${resourceName}".${
        available.length ? ` Their resources: ${available.join(", ")}.` : " They have no limited-use resources."
      }`,
    };
  }
  if (def.passive) {
    return {
      error: `${def.displayName} is not spent by choice: ${def.guidance} Do not call use_resource for it.`,
    };
  }
  if (sheet.currentHp <= 0) {
    return {
      error: `${sheet.name} is at 0 HP and cannot use ${def.displayName}; they are unconscious and take no actions.`,
    };
  }

  // Font of Magic: sorcery points convert into a spell slot and back. The
  // variant carries the direction and slot level ("create a 2nd-level slot",
  // "convert my 3rd-level slot into points"); a plain spend (Metamagic)
  // passes no variant and falls through to the generic path below.
  if (def.id === "sorcery_points") {
    const conversion = parseFontOfMagic(variant);
    if (conversion) {
      return computeFontOfMagic(sheet, def.displayName, state, conversion);
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

  const left = state.max - state.used;
  if (left < amount) {
    return {
      error: `${sheet.name} has ${left}/${state.max} ${def.displayName} left; they cannot spend ${amount}. The feature is not available; narrate accordingly.`,
    };
  }
  const spent = { ...sheet.resources, [def.id]: { max: state.max, used: state.used + amount } };
  const outcome: Outcome = {
    patch: { resources: spent },
    result: {
      ok: true,
      resource: def.displayName,
      spent: amount,
      left: `${left - amount}/${state.max}`,
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
      const expression = def.effect.dice(fxLevel, derived.abilityMods);
      const total = rollHealing(campaign, sheet, def.displayName, expression);
      outcome.healTarget = { characterId: sheet.id, amount: Math.max(1, total) };
      outcome.result.healingRolled = total;
      return outcome;
    }
    case "heal_pool": {
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.` };
      }
      outcome.healTarget = { characterId: target.id, amount };
      outcome.result.healed = `${amount} HP to ${target.name}`;
      return outcome;
    }
    case "heal_dice_pool": {
      // Each spent use is one die of healing to the target.
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.` };
      }
      const total = rollHealing(campaign, target, def.displayName, `${amount}${def.effect.die}`);
      outcome.healTarget = { characterId: target.id, amount: Math.max(1, total) };
      outcome.result.healingRolled = total;
      outcome.result.healed = `${total} HP to ${target.name}`;
      return outcome;
    }
    case "heal_target": {
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.` };
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
      const wanted = (variant ?? "").trim().toLowerCase();
      const condition =
        wanted && effect.variants?.length
          ? (effect.variants.find((entry) => entry.toLowerCase().includes(wanted)) ??
            (effect.variants.some((entry) => wanted.includes(entry.toLowerCase()))
              ? effect.variants.find((entry) => wanted.includes(entry.toLowerCase()))!
              : effect.condition))
          : effect.condition;
      const recipient = effect.target === "ally" ? target : sheet;
      if (recipient.conditions.some((entry) => entry.toLowerCase() === condition)) {
        return { error: `${recipient.name} is already ${condition}; the feature is already running.` };
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
      if (effect.variants?.length && !wanted) {
        outcome.result.variants = `Options: ${effect.variants.join(", ")}. Pass variant to pick; ${condition} was applied.`;
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
        return { error: `${sheet.name} is already ${condition}; the feature is already running.` };
      }
      outcome.patch.conditions = [...sheet.conditions, condition];
      outcome.patch.conditionMeta = {
        ...sheet.conditionMeta,
        [condition]: { rounds: def.effect.rounds },
      };
      outcome.result.applied = `${condition} for ${def.effect.rounds} rounds`;
      return outcome;
    }
    case "inspire": {
      if (target.id === sheet.id) {
        return {
          error: `${def.displayName} goes to another creature, never to the bard themselves. Pass targetCharacterId.`,
        };
      }
      const die = def.effect.die(fxLevel);
      const condition = inspirationCondition(die);
      if (target.conditions.some((entry) => entry.toLowerCase() === condition)) {
        return { error: `${target.name} already holds an unspent inspiration die.` };
      }
      outcome.patchTarget = {
        characterId: target.id,
        patch: {
          conditions: [...target.conditions, condition],
          conditionMeta: {
            ...target.conditionMeta,
            [condition]: { rounds: INSPIRATION_ROUNDS },
          },
        },
      };
      outcome.result.granted = `1${die} to ${target.name}, spent automatically on their next d20 roll`;
      return outcome;
    }
    case "aoe": {
      outcome.result.resolveWith = "aoe_damage";
      outcome.result.dice = def.effect.dice(fxLevel);
      outcome.result.saveAbility = def.effect.save;
      outcome.result.dc = 8 + derived.proficiencyBonus + derived.abilityMods.con;
      return outcome;
    }
    case "wild_shape": {
      const name = (form?.name ?? "").trim();
      if (!name) {
        return {
          error: `${def.displayName} needs the beast being assumed: pass form (e.g. 'wolf', 'brown bear').`,
        };
      }
      // A known form loads its real stat block and is validated against the
      // druid-level ceilings; Circle of the Moon raises the CR cap.
      const known = findBeastForm(name);
      // Multiclass: the caps read the DRUID levels and the druid entry's
      // circle, not the character's summed level or primary subclass.
      const druidEntry = classListFor(sheet).find((entry) => entry.id.toLowerCase() === "druid");
      const druidLevel = classLevelFor(sheet, "druid") || sheet.level;
      const moonDruid = /moon/i.test(druidEntry?.subclass ?? sheet.subclass ?? "");
      const caps = wildShapeCapsFor(druidLevel, moonDruid);
      if (known) {
        if (known.cr > caps.maxCr) {
          return {
            error: `${known.name} is CR ${formatCr(known.cr)}; at level ${druidLevel}${moonDruid ? " (Circle of the Moon)" : ""} ${sheet.name} can Wild Shape into beasts of CR ${formatCr(caps.maxCr)} or lower. Offer a form within the limit.`,
          };
        }
        if (known.fly && !caps.fly) {
          return {
            error: `${known.name} has a flying speed; Wild Shape allows flying forms only from druid level 8. Offer a ground form instead.`,
          };
        }
        if (known.swim && !caps.swim) {
          return {
            error: `${known.name} has a swimming speed; Wild Shape allows swimming forms only from druid level 4. Offer a land form instead.`,
          };
        }
        outcome.patch.wildShape = {
          form: known.name,
          beastHp: known.hp,
          beastMaxHp: known.hp,
          beastAc: known.ac,
          kind: "wildshape",
          // Wild Shape swaps the physical scores; INT/WIS/CHA stay the
          // druid's own, so only these three are stored.
          abilities: {
            str: known.abilities.str,
            dex: known.abilities.dex,
            con: known.abilities.con,
          },
          speed: known.speed,
          attacks: known.attacks,
        };
        outcome.result.form = `${known.name}: ${known.hp} HP, AC ${known.ac}, speed ${known.speed} ft, STR ${known.abilities.str}/DEX ${known.abilities.dex}/CON ${known.abilities.con}`;
        outcome.result.attacks = known.attacks
          .map((attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type})`)
          .join(", ");
        if (known.traits) {
          outcome.result.formTraits = known.traits;
        }
        outcome.result.note = `Damage lands on the beast's ${known.hp} hit points first; ${sheet.name}'s own ${sheet.currentHp}/${sheet.maxHp} waits for them when the form drops. Physical rolls use the beast's scores; they keep their own mind and cannot cast while shaped. Resolve the beast's attacks with pc_attack. Call use_resource on Wild Shape again to revert (no use spent).`;
        return outcome;
      }
      // Unknown/homebrew beast: the old model-supplied path, kept so exotic
      // fictions still work, but the level caps cannot be checked.
      const beastHp = Math.min(300, Math.max(1, form?.hp ?? 0));
      const beastAc = Math.min(30, Math.max(1, form?.ac ?? 0));
      if (!form?.hp || !form?.ac) {
        return {
          error: `"${name}" is not in the beast-form table; pass formHp and formAc from its stat block (and keep it within CR ${formatCr(caps.maxCr)}${caps.fly ? "" : ", no flying forms"}${caps.swim ? "" : ", no swimming forms"}).`,
        };
      }
      outcome.patch.wildShape = {
        form: name.slice(0, 60),
        beastHp,
        beastMaxHp: beastHp,
        beastAc,
        kind: "wildshape",
      };
      outcome.result.form = `${name}: ${beastHp} HP, AC ${beastAc}`;
      outcome.result.note = `Damage lands on the beast's ${beastHp} hit points first; ${sheet.name}'s own ${sheet.currentHp}/${sheet.maxHp} waits for them when the form drops. Call use_resource on Wild Shape again to revert (no use spent).`;
      return outcome;
    }
    case "recover_slots": {
      // Spent through take_rest, which reads the counter and returns the
      // slots; spending it by hand here would burn the use for nothing.
      return {
        error: `${def.displayName} happens as part of a short rest, not on its own. Call take_rest with kind=short and the server applies it.`,
      };
    }
    case "narrative":
      return outcome;
  }
}
