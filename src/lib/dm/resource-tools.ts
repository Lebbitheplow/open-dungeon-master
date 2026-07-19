import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { matchResource } from "@/lib/srd/class-resources";
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
        "A character spends a limited-use class feature tracked in their Resources list (Rage, Ki Points, Second Wind, Action Surge, Channel Divinity, Bardic Inspiration, Wild Shape, Lay on Hands...). The server refuses at 0 uses left. Call this BEFORE narrating the feature; a feature narrated without its spend has not happened.",
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
  event?: string;
};

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
    // The healing rolls server-side as a visible dice card; the heal lands
    // through the standard heal mutation so the death engine wakes them.
    const outcome = rollExpression(effect.expression);
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "custom",
      detail: `${carried.name} (${effect.expression})`,
      result: outcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    base.healTarget = { characterId: target.id, amount: Math.max(1, outcome.total) };
    base.result.healingRolled = outcome.total;
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

export function computeUseResource(
  sheet: CharacterSheet,
  resourceName: string,
  amount: number,
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
  const left = state.max - state.used;
  if (left < amount) {
    return {
      error: `${sheet.name} has ${left}/${state.max} ${def.displayName} left; they cannot spend ${amount}. The feature is not available; narrate accordingly.`,
    };
  }
  const next = { ...sheet.resources, [def.id]: { max: state.max, used: state.used + amount } };
  return {
    patch: { resources: next },
    result: {
      ok: true,
      resource: def.displayName,
      spent: amount,
      left: `${left - amount}/${state.max}`,
      refills: def.recharge === "short" ? "on any rest" : "on a long rest",
    },
  };
}
