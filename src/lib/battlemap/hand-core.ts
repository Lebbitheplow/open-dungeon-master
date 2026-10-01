// The Hand's shared vocabulary: what a card is, what a turn is, and the
// gates that stop a card being played. Split from hand.ts only to keep each
// file readable; hand.ts re-exports everything a caller needs.
import {
  spendAction,
  spendAttack,
  type AttackSpendOptions,
  type SpendResult,
  type TurnBudget,
} from "@/lib/dm/action-budget";
import { canAct, type ActKind, type ActingEncounter } from "@/lib/dm/can-act";
import type { OrderEntry } from "@/lib/db/encounters";
import type { IconRef } from "@/lib/icons";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import type { HandIntentExtras } from "@/lib/battlemap/hand-intent";
import type { HandArea } from "@/lib/battlemap/hand-area";

export type { HandBonusAttack } from "@/lib/battlemap/hand-intent";

export type HandCost = "action" | "bonus" | "reaction" | "rider" | "free";
export type HandCardType = "attack" | "rider" | "spell" | "control" | "mend" | "ward" | "feature" | "basic";
export type HandTarget = "enemy" | "ally" | "self" | "none";
export type BasicActionId =
  | "dodge" | "dash" | "disengage" | "help" | "hide" | "ready" | "grapple" | "shove" | "use-object" | "end-turn"
  | "search" | "escape";

// What the structured commit carries beside the sentence. An optional extra
// field on the action body: a server that does not know it drops it. The
// extras (hand-intent.ts) carry what the newer rules need: a reaction's
// feature, a ki variant, a bonus-action route, Ready's trigger, the attack
// options pc_attack resolves.
export type HandIntent = (
  | { card: "attack"; weapon: string; offHand?: boolean }
  | { card: "rider"; rider: string; slotLevel?: number }
  | { card: "spell"; spell: string; slotLevel: number | null }
  | { card: "feature"; resourceId: string }
  | { card: "basic"; action: BasicActionId }
  | { card: "reaction"; feature: string; spell?: string; slotLevel?: number | null }
) &
  HandIntentExtras;

export type HandCard = {
  id: string;
  type: HandCardType;
  name: string;
  cost: HandCost;
  range: string;
  // The headline line ("1d8+3 slashing", "heals 1d8+3", "WIS save DC 13").
  dice: string;
  // The roll line under it ("+5 to hit", "no roll", "on a hit").
  roll: string;
  rules: string;
  // Slot, uses or ammunition ("Slot 1 · 3/4"); "" when the card costs nothing.
  resource: string;
  // The condition applied, or "Concentration".
  condition: string;
  icon: IconRef;
  target: HandTarget;
  toHit: number | null;
  // A dice expression the preview can average; null when nothing is rolled.
  damage: string | null;
  damageType: string;
  heals: boolean;
  save: { ability: string; dc: number } | null;
  melee: boolean;
  // Why the card cannot be played right now; null when it can.
  disabled: string | null;
  // The reason is that something ran out, so the card dims rather than greys.
  spent: boolean;
  // The sentence needs finishing by hand (a Ready trigger, a Lay on Hands
  // amount), so the card fills the composer instead of sending.
  compose: boolean;
  // What a composed spend is counted in ("ki" for Touch of the Long Death);
  // hit points when absent (Lay on Hands).
  unit?: string;
  intent: HandIntent;
  // The class options this attack may carry, each already judged by the
  // engine's checkAttackOptions (Reckless Attack, Stunning Strike, knock out).
  options?: HandAttackOption[];
  // The card needs a line from the player before it can go: Ready's trigger.
  asks?: "trigger";
  // A reaction card's reason to be offered now ("Goblin 2's scimitar hit
  // you for 7").
  prompt?: string;
  // One pick the card needs beside its target: a spell's form (Command's
  // word, Bestow Curse's curse, Heat Metal on worn armor), the condition a
  // restoration ends, the spell a Ready holds. Sent under the tool
  // argument's own name (hand-intent.ts).
  choice?: HandChoice;
  // A spell that leaves an area on the battle map: the square it is laid on
  // is picked on the board (src/lib/battlemap/hand-area.ts) and sent as the
  // tool's atX/atY/towardX/towardY.
  area?: HandArea;
};

export type HandChoice = {
  arg: "condition" | "variant" | "readySpell";
  label: string;
  options: Array<{ value: string; label: string; note?: string }>;
  // What is sent when the player picks none (the first option otherwise).
  fallback?: string;
  // A readied spell's slot level, by spell name (take_action's `level`).
  levels?: Record<string, number>;
};

// The toggles an attack card carries. Open Hand Technique is one choice of
// three, so its ids carry the rider after a colon and share a group.
export type HandAttackOptionId =
  | "reckless"
  | "stunningStrike"
  | "nonlethal"
  | "useInspiration"
  | "strokeOfLuck"
  | "hurlThroughHell"
  | "rapidStrike"
  | "openHand:prone"
  | "openHand:push"
  | "openHand:no reactions";

export type HandAttackOption = {
  id: HandAttackOptionId;
  label: string;
  // What choosing it does, for the toggle's tooltip.
  note: string;
  // The engine's refusal when it cannot ride this swing now.
  disabled: string | null;
  // Options of one group exclude each other (Open Hand's three riders).
  group?: "openHand";
};

// The turn so far, read from the engine's TurnBudget
// (src/lib/dm/action-budget.ts) through the encounter's public projection
// (hand-table.ts turnFromEncounter). The Hand keeps no ledger of its own: a
// card sent is spent when the engine says so.
export type HandTurn = {
  myTurn: boolean;
  // Whose turn it is when it is not mine, for the tooltip.
  currentName?: string;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  attacksMade: number;
  extraActions?: number;
  // Action Surge's additional action, not yet spent.
  grantedActions?: number;
  // The engine budget's once-per-turn marks (Martial Arts' strike open, a
  // levelled or bonus-action spell cast, Sneak Attack spent).
  marks?: string[];
  // Flurry of Blows strikes bought and not made.
  flurryStrikes?: number;
  // This turn's action went on an attack-roll spell, so Extra Attack is gone.
  castThisAction?: boolean;
  // The engine's reading of the fight, so the gates ask canAct itself.
  table?: HandTable | null;
};

// What canAct needs to know about the fight, off the public encounter.
export type HandTable = {
  round: number;
  orderReady: boolean;
  // The combatant the pointer rests on; `id` is empty unless a character.
  acting: { id: string; name: string } | null;
  surprised: { acting: string[]; reacting: string[] };
};

export const FRESH_TURN: HandTurn = {
  myTurn: true,
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  attacksMade: 0,
};

// What the content pack says about a spell. Fetched by the component; the
// authored rows cover a table without the pack.
export type SpellFact = {
  level: number;
  school: string;
  castingTime: string;
  range: string;
  desc: string;
  higherLevel: string;
  concentration: boolean;
};

export type HandOptions = {
  spells?: Record<string, SpellFact>;
  // The table's ammunition variant rule. Undefined = unknown: the count is
  // shown but an empty quiver only warns.
  trackAmmo?: boolean;
};

export const HAND_FAN_CAP = 9;

export function spellKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function addFlat(expression: string, bonus: number): string {
  if (!bonus) return expression;
  return `${expression}${bonus > 0 ? "+" : "-"}${Math.abs(bonus)}`;
}

export function feet(range: string): string {
  const match = /^(\d+)\s*(feet|foot|ft)/i.exec(range.trim());
  if (match) return `${match[1]} ft`;
  return range.trim() ? range.trim().replace(/^./, (c) => c.toUpperCase()) : "";
}

export function hasFeature(sheet: CharacterSheet, fragment: string): boolean {
  const wanted = fragment.toLowerCase();
  return sheet.features.some((feature) => feature.name.toLowerCase().includes(wanted));
}

export function primaryClass(sheet: CharacterSheet): string {
  return (sheet.classes[0]?.id ?? sheet.class).toLowerCase();
}

// ---- what stops a card ----

export type Gate = { reason: string; spent: boolean } | null;

// The fight as canAct reads it, built from the public projection. The order
// is reduced to the one entry canAct looks at (the pointer's), and the
// surprise list is the server's own answer for this kind of act, so the
// verdict is the one the server will give.
export function actingEncounter(turn: HandTurn, kind: ActKind): ActingEncounter | null {
  const table = turn.table;
  if (!table) {
    // No projection (a test, an older server): the floor's word decides.
    if (turn.myTurn) return null;
    return {
      orderReady: true,
      round: 2,
      turnIndex: 0,
      surprisedIds: [],
      order: [{ kind: "npc", npcId: "", name: turn.currentName ?? "someone else", initiative: 0 }],
    };
  }
  const current: OrderEntry[] = table.acting
    ? [
        table.acting.id
          ? { kind: "pc", characterId: table.acting.id, userId: "", name: table.acting.name, initiative: 0 }
          : { kind: "npc", npcId: "", name: table.acting.name, initiative: 0 },
      ]
    : [];
  return {
    orderReady: table.orderReady,
    round: table.round,
    turnIndex: 0,
    order: current,
    surprisedIds: kind === "reaction" ? table.surprised.reacting : table.surprised.acting,
  };
}

// Whether this character may act at all right now, in the engine's words
// (src/lib/dm/can-act.ts): dead, at 0 HP, incapacitated, surprised, the
// order not rolled, or somebody else's turn. A reaction is asked as one, so
// it is open on anyone's turn.
export function standingGate(sheet: CharacterSheet, turn: HandTurn, kind: ActKind = "action"): Gate {
  const verdict = canAct({ sheet, encounter: actingEncounter(turn, kind), kind });
  return verdict.ok ? null : { reason: verdict.error, spent: false };
}

// The turn as the engine's own TurnBudget, so a cost is judged by the same
// spend functions pc_attack, take_action and the cast guard call, and a
// refusal reads in their words.
export function budgetOf(turn: HandTurn, sheet: Pick<CharacterSheet, "id">, allowed = 1): TurnBudget {
  return {
    ownerId: sheet.id,
    round: turn.table?.round ?? 1,
    actionUsed: turn.actionUsed,
    bonusUsed: turn.bonusUsed,
    reactionUsed: turn.reactionUsed,
    attacksMade: turn.attacksMade,
    attacksAllowed: Math.max(1, allowed),
    oncePerTurn: turn.marks ?? [],
    dashed: false,
    disengaged: false,
    ...(turn.extraActions ? { extraActions: turn.extraActions } : {}),
    ...(turn.grantedActions ? { grantedActions: turn.grantedActions } : {}),
    ...(turn.flurryStrikes ? { flurryStrikes: turn.flurryStrikes } : {}),
    ...(turn.castThisAction ? { castThisAction: true } : {}),
  };
}

const spentGate = (result: SpendResult): Gate => (result.ok ? null : { reason: result.error, spent: true });

// `what` is the card's name as the engine would name the spend ("Dash",
// "Longsword"): Haste's extra action pays only for the ones it allows.
export function costGate(cost: HandCost, turn: HandTurn, sheet: CharacterSheet, what = "that"): Gate {
  if (cost === "reaction") {
    const blocked = conditionBlocksReactions(sheet.conditions);
    if (blocked) return { reason: `${sheet.name} is ${blocked} and cannot take a reaction.`, spent: false };
    return spentGate(spendAction(budgetOf(turn, sheet), "reaction", what, sheet.name));
  }
  if (cost === "action" || cost === "bonus") {
    return spentGate(spendAction(budgetOf(turn, sheet), cost, what, sheet.name));
  }
  return null;
}

// The Attack action stays open until every swing it grants is made, which
// is what lets a fighter play the same card twice. Asked of spendAttack
// itself: Action Surge's action, Haste's one weapon attack and Flurry of
// Blows' unarmed strikes count exactly as the engine counts them.
export function attackGate(
  turn: HandTurn,
  allowed: number,
  sheet: Pick<CharacterSheet, "id" | "name">,
  options: AttackSpendOptions = {},
): Gate {
  return spentGate(spendAttack(budgetOf(turn, sheet, allowed), sheet.name, options));
}

export function gated<T extends HandCard>(card: T, ...gates: Gate[]): T {
  const hit = gates.find((gate) => gate !== null) ?? null;
  return hit ? { ...card, disabled: hit.reason, spent: hit.spent } : card;
}

export type SlotPick = { level: number; left: number; max: number; pact: boolean };

// The lowest slot that can carry a spell of this level, pact slots included.
export function lowestSlot(sheet: CharacterSheet, spellLevel: number): SlotPick | null {
  const casting = sheet.spellcasting;
  if (!casting) return null;
  const picks: SlotPick[] = [];
  for (const [key, slot] of Object.entries(casting.slots)) {
    const level = Number(key);
    if (level >= spellLevel && slot.max - slot.used > 0) {
      picks.push({ level, left: slot.max - slot.used, max: slot.max, pact: false });
    }
  }
  if (casting.pact && casting.pact.level >= spellLevel && casting.pact.max - casting.pact.used > 0) {
    picks.push({ level: casting.pact.level, left: casting.pact.max - casting.pact.used, max: casting.pact.max, pact: true });
  }
  picks.sort((a, b) => a.level - b.level);
  return picks[0] ?? null;
}

export function slotLine(slot: SlotPick): string {
  return `${slot.pact ? "Pact" : "Slot"} ${slot.level} · ${slot.left}/${slot.max}`;
}


export const SAVE_LABEL: Record<string, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
