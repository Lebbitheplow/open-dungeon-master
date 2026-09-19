// What a card says once it is chosen: the outcome preview, the sentence the
// engine reads, the structured intent beside it, and the turn bookkeeping
// (docs/visual-overhaul-plan.md 5.2 and 5.3). Pure, tested by
// scripts/test-hand.mjs.
import { attackContext } from "@/lib/dm/condition-logic";
import { asPercent, attackOdds, averageDetail } from "@/lib/srd/odds";
import type { HandCard, HandCost, HandIntent, HandTurn } from "@/lib/battlemap/hand-core";

// Who a card is aimed at. `ac` only ever arrives in the DM's projection; a
// player's preview works from the challenge rating, which they can see.
export type HandAim = {
  id: string;
  name: string;
  kind: "enemy" | "ally" | "self";
  ac?: number;
  cr?: number;
  conditions?: string[];
};

export type PreviewRow = { key: string; value: string; tone: "damage" | "heal" | "plain" | "save" | "muted" | "applies" | "cost" };

// The armour class a creature of this challenge usually carries (the SRD's
// monster statistics by challenge rating). An estimate, and labelled as one.
export function typicalAcForCr(cr: number): number {
  if (cr < 4) return 13;
  if (cr < 5) return 14;
  if (cr < 8) return 15;
  if (cr < 10) return 16;
  if (cr < 13) return 17;
  if (cr < 17) return 18;
  return 19;
}

const COST_LABEL: Record<HandCost, string> = {
  action: "Action",
  bonus: "Bonus action",
  reaction: "Reaction",
  rider: "Rider",
  free: "Free",
};

export function costLabel(cost: HandCost): string {
  return COST_LABEL[cost];
}

function mean(expression: string): string | null {
  const detail = averageDetail(expression);
  return Number.isFinite(detail.average) && detail.exact ? detail.average.toFixed(1) : null;
}

// The rows of the outcome preview. Arithmetic, not hints: the mean of the
// dice, the real d20 odds against the armour class, the save and its DC.
export function previewRows(card: HandCard, aim: HandAim | null, attackerConditions: string[] = []): PreviewRow[] {
  const rows: PreviewRow[] = [];
  if (card.dice) {
    rows.push({ key: card.heals ? "Restores" : card.damage ? "Damage" : "Effect", value: card.dice, tone: card.heals ? "heal" : card.damage ? "damage" : "plain" });
  }
  if (card.damage) {
    const expected = mean(card.damage);
    if (expected) rows.push({ key: card.heals ? "Expected" : "Expected dmg", value: card.heals ? `+${expected}` : expected, tone: "plain" });
  }
  if (card.save) {
    rows.push({ key: "Save", value: card.save.dc ? `${card.save.ability} save vs DC ${card.save.dc}` : `${card.save.ability} save`, tone: "save" });
  } else if (card.toHit !== null) {
    const bonus = card.toHit >= 0 ? `+${card.toHit}` : `${card.toHit}`;
    const enemy = aim && aim.kind === "enemy" ? aim : null;
    const known = enemy?.ac;
    const ac = known ?? (enemy?.cr !== undefined ? typicalAcForCr(enemy.cr) : null);
    if (ac === null) {
      rows.push({ key: "To hit", value: bonus, tone: "plain" });
    } else {
      const context = attackContext({
        attackerConditions,
        targetConditions: enemy?.conditions ?? [],
        melee: card.melee,
        adjacent: card.melee,
        requested: "none",
      });
      const odds = attackOdds({ attackBonus: card.toHit, ac, advantage: context.advantage });
      const edge = context.advantage === "none" ? "" : ` · ${context.advantage}`;
      rows.push({
        key: "To hit",
        value: `${bonus} vs AC ${known === undefined ? "~" : ""}${ac} · ${asPercent(odds.hit)}${edge}`,
        tone: "plain",
      });
    }
  } else if (card.roll) {
    rows.push({ key: "Roll", value: card.roll, tone: "muted" });
  }
  if (card.damageType) rows.push({ key: "Type", value: card.damageType, tone: "muted" });
  if (card.condition) rows.push({ key: "Applies", value: card.condition, tone: "applies" });
  rows.push({ key: "Cost", value: card.resource ? `${costLabel(card.cost)} · ${card.resource}` : costLabel(card.cost), tone: "cost" });
  return rows;
}

// ---- the sentence ----

function riderClause(rider: HandCard): string {
  if (rider.intent.card !== "rider") return "";
  if (rider.intent.rider === "Divine Smite") {
    const slot = rider.intent.slotLevel ? ` with a level ${rider.intent.slotLevel} slot` : "";
    return ` If it hits, I use Divine Smite${slot}.`;
  }
  return ` I use ${rider.intent.rider} on this attack.`;
}

// The prose the engine reads. Written the way the token HUD already writes
// it ("I attack Wight 1."), so the DM's tools see nothing new; names are left
// exactly as the sheet and the tracker spell them, because the engine matches
// on them.
export function composeSentence(card: HandCard, aim: HandAim | null, riders: HandCard[] = []): string {
  const who = aim?.kind === "self" ? "myself" : aim?.name ?? "";
  const intent = card.intent;
  if (intent.card === "attack") {
    const how = intent.weapon === "Unarmed strike" ? "an unarmed strike" : `my ${intent.weapon}`;
    const lead = intent.offHand
      ? `I make my off-hand attack${who ? ` against ${who}` : ""} with ${how} as a bonus action.`
      : `I attack ${who || "the nearest enemy"} with ${how}.`;
    return lead + riders.map(riderClause).join("");
  }
  if (intent.card === "spell") {
    const where = !who ? "" : aim?.kind === "enemy" ? ` at ${who}` : ` on ${who}`;
    const slot = intent.slotLevel ? ` using a level ${intent.slotLevel} slot` : "";
    const how = card.cost === "bonus" ? " as a bonus action" : card.cost === "reaction" ? " as a reaction" : "";
    return `I cast ${intent.spell}${where}${how}${slot}.`;
  }
  if (intent.card === "feature") {
    const where = !who || aim?.kind === "self" ? "" : ` on ${who}`;
    const how = card.cost === "bonus" ? " as a bonus action" : "";
    // A pool is spent by amount; the blank is where the player says how much.
    return card.compose ? `I use ${card.name}${where} for  hit points.` : `I use ${card.name}${where}${how}.`;
  }
  if (intent.card === "rider") {
    return `I use ${intent.rider} on my next hit.`;
  }
  const bonus = card.cost === "bonus" ? " as a bonus action (Cunning Action)" : "";
  switch (intent.action) {
    case "dodge":
      return "I take the Dodge action.";
    case "dash":
      return `I Dash${bonus}.`;
    case "disengage":
      return `I Disengage${bonus} and step away.`;
    case "help":
      return `I take the Help action for ${who || "my ally"}.`;
    case "hide":
      return `I Hide${bonus}.`;
    case "ready":
      return "I ready an action: ";
    case "grapple":
      return `I try to grapple ${who || "the nearest enemy"}.`;
    case "shove":
      return `I shove ${who || "the nearest enemy"}.`;
    case "use-object":
      return "I use an object: ";
    case "end-turn":
      return "I end my turn.";
  }
}

// The optional structured half of the commit. The action route validates
// `content` and `kind` and drops what it does not know, so this costs an
// older server nothing and gives a newer one the card without parsing prose.
export type HandIntentBody = HandIntent & {
  targetId?: string;
  targetName?: string;
  targetKind?: HandAim["kind"];
  riders?: string[];
};

export function intentBody(card: HandCard, aim: HandAim | null, riders: HandCard[] = []): HandIntentBody {
  return {
    ...card.intent,
    ...(aim ? { targetId: aim.id, targetName: aim.name, targetKind: aim.kind } : {}),
    ...(riders.length ? { riders: riders.map((rider) => rider.name) } : {}),
  };
}

// ---- the turn, kept by the Hand ----

// What playing this card spends. `allowed` is the swings the Attack action
// grants (1 + Extra Attack); hand.ts holds the action open until the last.
export function afterCommit(turn: HandTurn, card: HandCard, allowed = 1): HandTurn {
  const next: HandTurn = { ...turn };
  const swing = card.intent.card === "attack" && !card.intent.offHand;
  const contest = card.intent.card === "basic" && (card.intent.action === "grapple" || card.intent.action === "shove");
  if (swing || contest) {
    // A swing once the Attack action has closed opens the Haste or Action
    // Surge one, which counts its own swings from the top.
    const open = turn.attacksMade > 0 && turn.attacksMade < allowed;
    const extra = turn.actionUsed && !open && (turn.extraActions ?? 0) > 0;
    if (extra) next.extraActions = (turn.extraActions ?? 1) - 1;
    next.actionUsed = true;
    next.attacksMade = extra ? 1 : turn.attacksMade + 1;
    return next;
  }
  if (card.cost === "action") {
    if (turn.actionUsed && (turn.extraActions ?? 0) > 0) {
      next.extraActions = (turn.extraActions ?? 1) - 1;
    }
    next.actionUsed = true;
  } else if (card.cost === "bonus") {
    next.bonusUsed = true;
  } else if (card.cost === "reaction") {
    next.reactionUsed = true;
  }
  if (card.intent.card === "spell" && card.resource !== "Cantrip" && (card.cost === "action" || card.cost === "bonus")) {
    next.leveledSpell = card.cost;
  }
  if (card.intent.card === "feature" && card.intent.resourceId === "action_surge") {
    next.extraActions = (turn.extraActions ?? 0) + 1;
  }
  return next;
}

// ---- a target picked on the board ----

// The board's targeting mode already reaches the composer as a sentence
// ("I attack Wight 1.", "I cast  at Wight 1."). While a card is raised that
// sentence is read as the pick, so a tap on the map aims the card without the
// board knowing the Hand exists. Longest name first, so "Wight 12" is never
// taken for "Wight 1".
export function targetFromComposedText(text: string, names: string[]): string | null {
  const match = /^I (?:attack|cast\s+at)\s+(.+?)\.?\s*$/i.exec(text.trim());
  if (!match) return null;
  const said = match[1].trim().toLowerCase();
  const sorted = [...names].sort((a, b) => b.length - a.length);
  return sorted.find((name) => name.trim().toLowerCase() === said) ?? null;
}

// Window events a board can use to aim a raised card directly: the Hand
// announces the aim, and listens for a pick by tracker id or by name.
export const HAND_AIM_EVENT = "odm:hand-aim";
export const HAND_TARGET_EVENT = "odm:hand-target";
export type HandAimDetail = { active: boolean; cardId: string | null; target: HandCard["target"] | null };
export type HandTargetDetail = { id?: string; name?: string };
