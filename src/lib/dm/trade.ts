import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { getDatabase } from "@/lib/db/core";
import type { ItemProposal } from "@/lib/db/item-proposals";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { computeTrade, normalizeTradeOffer, tradeSummary } from "@/lib/dm/trade-logic";
import { publishEphemeral, publishPersisted } from "@/lib/events";

// Carrying out an accepted trade (docs/vtt-parity-implementation-plan.md
// 11.2): both sheets move in one transaction with an audit row each, so
// the ledger shows the exchange from both sides and nothing can land on
// one sheet without leaving the other.
export function applyTrade(campaign: Campaign, proposal: ItemProposal): { ok: true; summary: string } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(proposal.argsJson || "{}");
  } catch {
    return { error: "The offer could not be read." };
  }
  const offer = normalizeTradeOffer(raw);
  if (!offer) {
    return { error: "The offer is empty." };
  }
  const from = getSheetById(proposal.characterId);
  const to = getSheetById(offer.toCharacterId);
  if (!from || !to || from.campaignId !== campaign.id || to.campaignId !== campaign.id) {
    return { error: "One of the characters has left the table." };
  }
  const computed = computeTrade(from, to, offer);
  if ("error" in computed) {
    return computed;
  }
  const summary = tradeSummary(offer, from.name, to.name);
  getDatabase().transaction(() => {
    patchSheet(from.id, computed.from);
    patchSheet(to.id, computed.to);
    for (const [sheet, patch] of [
      [from, computed.from],
      [to, computed.to],
    ] as const) {
      insertSheetAudit({
        campaignId: campaign.id,
        characterId: sheet.id,
        turnId: null,
        kind: "trade",
        delta: { with: sheet.id === from.id ? to.name : from.name, offer },
        reason: summary,
        seq: allocateSeq(campaign.id),
        actor: "player",
        before: sheet,
        patch,
      });
      insertCharacterEvent({
        libraryCharacterId: sheet.libraryCharacterId,
        campaignCharacterId: sheet.id,
        campaignId: campaign.id,
        seq: allocateSeq(campaign.id),
        kind: "item",
        summary,
      });
    }
  })();
  for (const id of [from.id, to.id]) {
    const updated = getSheetById(id);
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  publishEphemeral(campaign.id, "coins", { characterId: from.id, direction: offer.giveCp > offer.wantCp ? "out" : "in", amountCp: Math.abs(offer.giveCp - offer.wantCp), at: Date.now() });
  return { ok: true, summary };
}
