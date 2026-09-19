// The Hand's shared vocabulary: what a card is, what a turn is, and the
// gates that stop a card being played. Split from hand.ts only to keep each
// file readable; hand.ts re-exports everything a caller needs.
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import type { IconRef } from "@/lib/icons";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";

export type HandCost = "action" | "bonus" | "reaction" | "rider" | "free";
export type HandCardType = "attack" | "rider" | "spell" | "control" | "mend" | "ward" | "feature" | "basic";
export type HandTarget = "enemy" | "ally" | "self" | "none";
export type BasicActionId =
  | "dodge" | "dash" | "disengage" | "help" | "hide" | "ready" | "grapple" | "shove" | "use-object" | "end-turn";

// What the structured commit carries beside the sentence. An optional extra
// field on the action body: a server that does not know it drops it.
export type HandIntent =
  | { card: "attack"; weapon: string; offHand?: boolean }
  | { card: "rider"; rider: string; slotLevel?: number }
  | { card: "spell"; spell: string; slotLevel: number | null }
  | { card: "feature"; resourceId: string }
  | { card: "basic"; action: BasicActionId };

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
  intent: HandIntent;
};

// The turn so far. Shaped after the engine's TurnBudget
// (src/lib/dm/action-budget.ts) so a server projection of it can be handed
// straight in; until one exists the Hand keeps its own from what it sent.
export type HandTurn = {
  myTurn: boolean;
  // Whose turn it is when it is not mine, for the tooltip.
  currentName?: string;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  attacksMade: number;
  extraActions?: number;
  // The bonus-action spell rule: a levelled spell cast with one kind of
  // action leaves only an action cantrip for the other.
  leveledSpell?: "action" | "bonus" | null;
};

export const FRESH_TURN: HandTurn = {
  myTurn: true,
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  attacksMade: 0,
  leveledSpell: null,
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

export function standingGate(sheet: CharacterSheet, turn: HandTurn): Gate {
  if (sheet.deathSaves?.dead) return { reason: `${sheet.name} is dead.`, spent: false };
  if (sheet.currentHp <= 0 && !sheet.wildShape) {
    return { reason: `${sheet.name} is down and cannot act.`, spent: false };
  }
  const stopped = incapacitatedBy(sheet.conditions);
  if (stopped) return { reason: `${sheet.name} is ${stopped} and cannot act.`, spent: false };
  if (!turn.myTurn) {
    return {
      reason: turn.currentName ? `It is ${turn.currentName}'s turn.` : "It is not your turn.",
      spent: false,
    };
  }
  return null;
}

export function costGate(cost: HandCost, turn: HandTurn, sheet: CharacterSheet): Gate {
  if (cost === "action" && turn.actionUsed && (turn.extraActions ?? 0) <= 0) {
    return { reason: "Your action is spent this turn.", spent: true };
  }
  if (cost === "bonus" && turn.bonusUsed) {
    return { reason: "Your bonus action is spent this turn.", spent: true };
  }
  if (cost === "reaction") {
    if (turn.reactionUsed) return { reason: "Your reaction is spent until your next turn.", spent: true };
    const blocked = conditionBlocksReactions(sheet.conditions);
    if (blocked) return { reason: `No reactions while ${blocked}.`, spent: false };
  }
  return null;
}

// The Attack action stays open until every swing it grants is made, which
// is what lets a fighter play the same card twice.
export function attackGate(turn: HandTurn, allowed: number): Gate {
  if (!turn.actionUsed) return null;
  if (turn.attacksMade > 0 && turn.attacksMade < allowed) return null;
  if ((turn.extraActions ?? 0) > 0) return null;
  return turn.attacksMade >= allowed && turn.attacksMade > 0
    ? { reason: allowed > 1 ? `All ${allowed} attacks are made this turn.` : "Your attack is made this turn.", spent: true }
    : { reason: "Your action is spent this turn.", spent: true };
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
