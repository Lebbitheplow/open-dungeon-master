// handle_item: what a character does with the gear in their hands (issue
// #424). Before it, nothing the DM could call changed what was worn or
// held: a shield came off only through the sheet's toggle, and every drop in
// the story went through remove_item, which destroys the item. The rules are
// the sheet toggle's (src/app/api/campaigns/[campaignId]/sheet/usage) and
// the hands module's (gear-hands.ts):
//   - a shield is an action to put on or take off, on the character's turn;
//   - armor takes minutes, so it never changes in a fight, and outside one
//     the clock moves by the don and doff minutes;
//   - drawing or stowing a weapon, picking something up or handing it over
//     is the turn's free object interaction, a second the Use an Object
//     action;
//   - dropping something is free, and it lies where it fell
//     (src/lib/db/dropped-items.ts) until someone within reach takes it.
// One handler for the AI DM, the console and connected agents
// (src/lib/dm/invoke-dispatch.ts).
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { advanceClock } from "@/lib/db/clock";
import { spendAction, type TurnBudget } from "@/lib/dm/action-budget";
import { dualWields } from "@/lib/dm/attack-rules";
import { hasFastHands } from "@/lib/dm/bonus-routes";
import { canAct } from "@/lib/dm/can-act";
import { armorChangeMinutes } from "@/lib/dm/don-doff";
import { drawRow, gearKindOf, handsFor, handsFullError, handsFullFor, holdIfFree, inHand, spendInteraction } from "@/lib/dm/gear-hands";
import { lineNamed } from "@/lib/srd/item-row";
import { srdNameFor } from "@/lib/dm/item-logic";
import { ITEM_TAGS, listedItemTags } from "@/lib/schemas/item-tags";
import { drop, enemyHandles, pickUp, standing } from "@/lib/dm/gear-ground";
import { ownBudget, refuse, retry, saveEquipment } from "@/lib/dm/gear-store";
import { footprintDistance } from "@/lib/battlemap/footprint";
import { tokenFootprint } from "@/lib/dm/board-reach";
import { addRowMath, handedOverRow, removeItemMath } from "@/lib/dm/mutation-math";
import { characterCallUnasked } from "@/lib/dm/player-word";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { storeBudget } from "@/lib/dm/turn-budget";
import { gearPatch, implicitlyWorn } from "@/lib/dm/usage-rules";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { acBreakdownFor } from "@/lib/srd";

export { describeGround } from "@/lib/dm/gear-ground";

export const GEAR_TOOL_NAMES = ["handle_item"] as const;

const ACTIONS = ["equip", "unequip", "drop", "pick_up", "hand"] as const;
type GearAction = (typeof ACTIONS)[number];

export const handleItemTool = {
  type: "function",
  function: {
    name: "handle_item",
    description:
      "Equip, unequip, drop, pick up or hand over gear for a character (or an enemy), at its real cost. The server charges the action, the free object interaction or the minutes each takes (a shield takes an action; armor never changes in a fight). drop: free, and the item lies where it fell, NOT destroyed, for anyone within 5 feet to pick_up (use this, never remove_item, for anything set down, knocked away or let fall). hand: give an item to an ally within 5 feet. An enemy may drop something it holds (a disarmed blade) or pick_up an item on the ground, with enemyId instead of characterId.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "The character who acts: exact characterId from GAME STATE." },
        enemyId: { type: "string", description: "Or the enemy who acts (drop or pick_up only): exact enemyId from GAME STATE." },
        action: { type: "string", enum: [...ACTIONS] },
        item: {
          type: "string",
          description: "The item's name: one carried, or for pick_up the one on the ground (name or id from GAME STATE). For an enemy's drop, what it lets fall.",
        },
        qty: { type: "integer", minimum: 1, maximum: 99, description: "How many of a stack (drop, hand, pick_up). One when omitted." },
        srdName: { type: "string", description: "An enemy's drop in the table's language: its SRD or pack name in English ('Scimitar')." },
        tags: { type: "array", items: { type: "string" }, description: "An enemy's drop only: as grant_item's tags." },
        toCharacterId: { type: "string", description: "hand: who receives it, exact characterId from GAME STATE." },
        helped: { type: "boolean", description: "unequip armor: someone helps, so it comes off in half the time." },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["action", "item"],
    },
  },
} as const;

type Args = {
  characterId?: string;
  enemyId?: string;
  action?: string;
  item?: string;
  qty?: number;
  srdName?: string;
  tags?: unknown;
  toCharacterId?: string;
  helped?: boolean;
  reason?: string;
};

export function handleItemCall(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  turn: DmTurn | null,
): ToolResult {
  let args: Args;
  try {
    args = JSON.parse(rawArguments || "{}") as Args;
  } catch {
    return retry("Invalid arguments.");
  }
  const action = (args.action ?? "").trim() as GearAction;
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return retry(`action is one of ${ACTIONS.join(", ")}.`);
  }
  const itemName = (args.item ?? "").trim();
  if (!itemName) {
    return retry("Say which item.");
  }
  const qty = Math.max(1, Math.min(99, Math.floor(Number(args.qty) || 1)));
  const reason = (args.reason ?? "").slice(0, 200);
  const encounter = getActiveEncounter(campaign.id);
  if (args.enemyId) {
    // What an enemy lets fall is a thing no sheet knew yet: it lies as the
    // row it is, as grant_item would give it.
    const listed = srdNameFor(args.srdName, "handle_item");
    if ("error" in listed) {
      return listed;
    }
    const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined;
    const unknown = tags?.filter((tag) => !(ITEM_TAGS as readonly string[]).includes(tag)) ?? [];
    if (unknown.length) {
      return retry(`handle_item: no tag ${unknown.map((tag) => `"${tag}"`).join(", ")}. The tags: ${ITEM_TAGS.join(", ")}.`);
    }
    return enemyHandles(campaign, encounter, args.enemyId, action, itemName, qty, { ...listed, ...(tags?.length ? { tags: listedItemTags(tags) } : {}) });
  }
  const named = resolveSheetRef(args.characterId, sheets, sheetsById);
  if (!named) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  // The turn's party list is read once, before its calls run: a drop and a
  // draw sent together would otherwise see the hands as they were before
  // the drop. The sheet as it stands now.
  const sheet = getSheetById(named.id) ?? named;
  const unasked = characterCallUnasked(campaign.id, turn, rawArguments, "characterId");
  if (unasked) {
    return unasked;
  }
  if (sheet.deathSaves?.dead) {
    return refuse(`${sheet.name} is dead and handles nothing.`);
  }
  if (action === "pick_up") {
    return pickUp(campaign, turn, encounter, sheet, itemName, qty, reason);
  }
  const row = sheet.equipment[lineNamed(sheet.equipment, itemName)];
  if (!row) {
    return retry(`${sheet.name} carries no "${itemName}". They carry: ${sheet.equipment.map((item) => item.name).join(", ") || "nothing"}.`);
  }
  switch (action) {
    case "equip":
    case "unequip":
      return changeWear(campaign, turn, encounter, sheet, row, action === "equip", reason, args.helped === true);
    case "drop":
      return drop(campaign, turn, encounter, sheet, row, qty, reason);
    case "hand": {
      const to = resolveSheetRef(args.toCharacterId, sheets, sheetsById);
      if (!to || to.id === sheet.id) {
        return retry("hand needs toCharacterId: the ally who receives it.");
      }
      return handOver(campaign, turn, encounter, sheet, to, row, qty, reason);
    }
  }
}

// ---- wearing and holding ----

function changeWear(
  campaign: Campaign,
  turn: DmTurn | null,
  encounter: Encounter | null,
  sheet: CharacterSheet,
  row: EquipmentItem,
  on: boolean,
  reason: string,
  helped = false,
): ToolResult {
  const kind = gearKindOf(row);
  if (inHand(row, sheet.equipment) === on && sheet.equipment.some((item) => item.equipped !== undefined)) {
    return { ok: true, unchanged: true, note: `${row.name} is already ${on ? (kind === "weapon" ? "in hand" : "on") : "put away"}; nothing changed or was spent.` };
  }
  const armor = acBreakdownFor(sheet);
  // A weapon taken in hand needs a hand free for it; putting another away
  // is its own interaction, so it is never folded into the draw.
  let drawn: EquipmentItem[] | null = null;
  if (on && kind === "weapon") {
    const wornBefore = sheet.equipment.some((item) => item.equipped !== undefined)
      ? null
      : implicitlyWorn(sheet.equipment, { armorName: armor.armorName, shieldName: armor.shieldName });
    const swap = drawRow(sheet.equipment, row, wornBefore);
    if (swap.full.length) {
      return refuse(handsFullError(sheet.name, row.name, swap.full));
    }
    drawn = swap.equipment;
  }
  // A shield takes a hand too.
  if (on && kind === "shield") {
    const full = handsFullFor(sheet.equipment, row);
    if (full.length) {
      return refuse(handsFullError(sheet.name, row.name, full, "strapped on"));
    }
  }
  let budget: TurnBudget | null = null;
  let cost = "";
  if (encounter) {
    if (kind === "armor") {
      return refuse(`Armor takes minutes to put on or take off, so ${row.name} cannot change during a fight. A shield takes one action, and a weapon the free object interaction.`);
    }
    const able = canAct({ sheet, encounter, kind: kind === "shield" ? "action" : "free" });
    if (!able.ok) {
      return toolError(able);
    }
    const own = ownBudget(encounter, sheet);
    if (!own) {
      return refuse(`${on ? "Putting on" : "Taking off"} ${row.name} happens on ${sheet.name}'s own turn.`);
    }
    const spent =
      kind === "shield"
        ? spendAction(own, "action", "Handling a shield", sheet.name)
        : spendInteraction(own, {
            what: `${on ? "drawing" : "putting away"} ${row.name}`,
            who: sheet.name,
            oneHandedWeapon: kind === "weapon" && handsFor(row) === 1,
            dualWielder: dualWields(sheet.feats, sheet.campaignId),
            fastHands: hasFastHands(sheet),
          });
    if (!spent.ok) {
      return toolError(spent);
    }
    budget = spent.budget;
    cost = spent.note ?? (kind === "shield" ? `${sheet.name}'s action` : "");
  }
  // Anything but a drawn weapon goes through the sheet's own rule, which
  // keeps one cloak at a time.
  let equipment: EquipmentItem[];
  if (drawn) {
    equipment = drawn;
  } else {
    const worn = gearPatch(sheet, { [row.name]: { equipped: on } }, { corrects: false, armor });
    if ("error" in worn) {
      return refuse(worn.error);
    }
    equipment = worn.equipment;
  }
  saveEquipment(campaign, turn, sheet, equipment, "gear", { item: row.name, equipped: on }, reason || `${on ? "Put on" : "Took off"} ${row.name}`);
  if (encounter && budget) {
    storeBudget(encounter, budget);
  }
  // Out of a fight, armor takes its minutes (SRD 5.1, Getting Into and Out
  // of Armor); the clock moves by them.
  const dressing = !encounter ? armorChangeMinutes(sheet.equipment, { [row.name]: { equipped: on } }, { helped }) : null;
  if (dressing?.minutes) {
    advanceClock(campaign.id, dressing.minutes, "minutes");
  }
  return {
    ok: true,
    applied: `${sheet.name} ${on ? (kind === "weapon" ? "draws" : "puts on") : kind === "weapon" ? "puts away" : "takes off"} ${row.name}.`,
    ...(cost ? { cost } : {}),
    ...(dressing?.minutes ? { timePassed: dressing.lines.join(" ") } : {}),
  };
}

function handOver(
  campaign: Campaign,
  turn: DmTurn | null,
  encounter: Encounter | null,
  sheet: CharacterSheet,
  to: CharacterSheet,
  row: EquipmentItem,
  qty: number,
  reason: string,
): ToolResult {
  let budget: TurnBudget | null = null;
  let cost = "";
  if (encounter) {
    const giver = standing(campaign.id, sheet.id).token;
    const taker = standing(campaign.id, to.id).token;
    if (giver && taker) {
      const apart = footprintDistance(giver, tokenFootprint(giver), taker, tokenFootprint(taker));
      if (apart > 1) {
        return refuse(`${to.name} is ${apart * 5} ft from ${sheet.name}; handing something over takes being within 5 ft.`);
      }
    }
    const able = canAct({ sheet, encounter, kind: "free" });
    if (!able.ok) {
      return toolError(able);
    }
    const own = ownBudget(encounter, sheet);
    if (!own) {
      return refuse(`Handing ${row.name} over happens on ${sheet.name}'s own turn.`);
    }
    const spent = spendInteraction(own, { what: `handing ${row.name} to ${to.name}`, who: sheet.name, fastHands: hasFastHands(sheet) });
    if (!spent.ok) {
      return toolError(spent);
    }
    budget = spent.budget;
    cost = spent.note ?? "";
  }
  const removal = removeItemMath(sheet.equipment, row.name, qty);
  if (!removal) {
    return retry(`${sheet.name} carries no "${row.name}".`);
  }
  const receiver = getSheetById(to.id) ?? to;
  const received = holdIfFree(addRowMath(receiver.equipment, handedOverRow(row, removal.removed)), row.name);
  saveEquipment(campaign, turn, sheet, removal.equipment, "hand_item", { name: row.name, to: to.name, qty: removal.removed }, reason || `Handed ${row.name} to ${to.name}`);
  saveEquipment(campaign, turn, receiver, received.equipment, "hand_item", { name: row.name, from: sheet.name, qty: removal.removed }, reason || `Received ${row.name} from ${sheet.name}`);
  if (encounter && budget) {
    storeBudget(encounter, budget);
  }
  return {
    ok: true,
    applied: `${sheet.name} hands ${removal.removed > 1 ? `${removal.removed} ` : ""}${row.name} to ${to.name}.`,
    ...(cost ? { cost } : {}),
  };
}
