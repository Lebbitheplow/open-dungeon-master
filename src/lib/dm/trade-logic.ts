import { grantItemMath, removeItemMath } from "@/lib/dm/mutation-math";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { addCopper, formatCopper, purseCopper } from "@/lib/srd/currency";

// Player-to-player trade (docs/vtt-parity-implementation-plan.md 11.2),
// the pure half: what an offer is, what it reads as, and the two patches
// that carry it out when both sides have said yes.

export type TradeLine = { name: string; qty: number };

export type TradeOffer = {
  toCharacterId: string;
  // What the proposer hands over, and coin in copper.
  give: TradeLine[];
  giveCp: number;
  // What the proposer asks for in return.
  want: TradeLine[];
  wantCp: number;
};

const MAX_LINES = 8;

function normalizeLines(raw: unknown): TradeLine[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((line) => {
      const record = (line ?? {}) as Record<string, unknown>;
      return { name: String(record.name ?? "").trim().slice(0, 80), qty: Math.max(1, Math.min(999, Math.round(Number(record.qty) || 1))) };
    })
    .filter((line) => line.name)
    .slice(0, MAX_LINES);
}

export function normalizeTradeOffer(raw: unknown): TradeOffer | null {
  const record = (raw ?? {}) as Record<string, unknown>;
  const offer: TradeOffer = {
    toCharacterId: String(record.toCharacterId ?? "").trim(),
    give: normalizeLines(record.give),
    giveCp: Math.max(0, Math.round(Number(record.giveCp) || 0)),
    want: normalizeLines(record.want),
    wantCp: Math.max(0, Math.round(Number(record.wantCp) || 0)),
  };
  if (!offer.toCharacterId) {
    return null;
  }
  // An offer of nothing for nothing is not a trade.
  if (!offer.give.length && !offer.giveCp && !offer.want.length && !offer.wantCp) {
    return null;
  }
  return offer;
}

function describeSide(lines: TradeLine[], cp: number): string {
  const parts = lines.map((line) => (line.qty > 1 ? `${line.name} x${line.qty}` : line.name));
  if (cp > 0) {
    parts.push(formatCopper(cp));
  }
  return parts.length ? parts.join(", ") : "nothing";
}

export function tradeSummary(offer: TradeOffer, fromName: string, toName: string): string {
  return `${fromName} offers ${describeSide(offer.give, offer.giveCp)} to ${toName} for ${describeSide(offer.want, offer.wantCp)}`;
}

// Who may do what with a trade: the counterparty accepts or declines, the
// proposer withdraws (declines their own), the lead may do any of it.
export function canResolveTrade(action: "approve" | "decline" | "cancel", actorIsProposer: boolean, actorIsCounterparty: boolean, actorIsLead: boolean): boolean {
  if (actorIsLead) {
    return true;
  }
  if (action === "approve") {
    return actorIsCounterparty;
  }
  if (action === "decline") {
    return actorIsCounterparty || actorIsProposer;
  }
  return actorIsProposer;
}

type Patch = { gold: number; copper: number; equipment: CharacterSheet["equipment"] };

// Both patches, or the reason it cannot happen. Everything is checked
// before anything moves: the proposer must still carry what they offer and
// the coin they promised, the counterparty likewise for what was asked.
export function computeTrade(from: CharacterSheet, to: CharacterSheet, offer: TradeOffer): { from: Patch; to: Patch } | { error: string } {
  let fromEquipment = from.equipment;
  let toEquipment = to.equipment;
  for (const line of offer.give) {
    const removal = removeItemMath(fromEquipment, line.name, line.qty);
    if (!removal || removal.removed < line.qty) {
      return { error: `${from.name} no longer carries ${line.qty > 1 ? `${line.qty} ` : ""}${line.name}.` };
    }
    fromEquipment = removal.equipment;
    toEquipment = grantItemMath(toEquipment, line.name, line.qty).equipment;
  }
  for (const line of offer.want) {
    const removal = removeItemMath(toEquipment, line.name, line.qty);
    if (!removal || removal.removed < line.qty) {
      return { error: `${to.name} does not carry ${line.qty > 1 ? `${line.qty} ` : ""}${line.name}.` };
    }
    toEquipment = removal.equipment;
    fromEquipment = grantItemMath(fromEquipment, line.name, line.qty).equipment;
  }
  const fromPurse = { gold: from.gold, copper: from.copper };
  const toPurse = { gold: to.gold, copper: to.copper };
  if (purseCopper(fromPurse) < offer.giveCp) {
    return { error: `${from.name} no longer has ${formatCopper(offer.giveCp)}.` };
  }
  if (purseCopper(toPurse) < offer.wantCp) {
    return { error: `${to.name} does not have ${formatCopper(offer.wantCp)}.` };
  }
  const fromAfter = addCopper(fromPurse, offer.wantCp - offer.giveCp).purse;
  const toAfter = addCopper(toPurse, offer.giveCp - offer.wantCp).purse;
  return {
    from: { gold: fromAfter.gold, copper: fromAfter.copper, equipment: fromEquipment },
    to: { gold: toAfter.gold, copper: toAfter.copper, equipment: toEquipment },
  };
}
