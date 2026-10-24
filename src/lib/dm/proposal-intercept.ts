import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import {
  insertItemProposal,
  listOpenItemProposals,
  listRecentItemProposals,
  type ItemProposal,
} from "@/lib/db/item-proposals";
import { publishPersisted } from "@/lib/events";
import {
  duplicateOfferProblem,
  offerLineStatus,
  offerPrecheck,
  proposalSummary,
  SETTLED_OFFERS_MAX,
  SETTLED_OFFERS_WINDOW_MS,
  shouldProposeChange,
  VITALS_PROPOSAL_TOOL_NAMES,
  type OfferArgs,
  type OfferLine,
} from "@/lib/dm/proposal-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import { listPriceCp, saleValueCp } from "@/lib/dm/trade-value";
import { lineNamed } from "@/lib/srd/item-row";

// What a purchase offered for approval will charge or pay each, in gold, as
// purchase-math.ts settles it on approval: the list price to buy, the sale
// value to sell, and the call's price only for a thing nothing prices. The
// offer's line showed the call's own price, which the engine ignores for
// anything the book lists (issue #471).
function quotedPurchase(args: OfferArgs, sheet: CharacterSheet): OfferArgs | ToolError {
  const name = String(args.item ?? args.name ?? "").trim();
  const sold = args.action === "sell" ? sheet.equipment[lineNamed(sheet.equipment, name)] : undefined;
  const item = sold ?? { name, srdName: typeof (args as { srdName?: unknown }).srdName === "string" ? String((args as { srdName?: unknown }).srdName) : undefined };
  const listCp = listPriceCp(item);
  if (listCp === null) {
    return args.price === undefined ? { error: `Nothing prices "${name}": send price, the gold one is worth. No offer was made.`, retry: true } : args;
  }
  return { ...args, price: (args.action === "sell" ? saleValueCp(item, listCp) : listCp) / 100 };
}

// Interception for the inventoryApprovals and vitalsApprovals game
// settings: a DM inventory, gold, damage, healing or condition mutation
// aimed at a player character becomes a pending offer the owning player
// answers, instead of applying immediately. Returns null when the normal
// auto-apply path should run.

// The offer as a seat receives it (src/lib/dm/proposal-view.ts).
export { publicItemProposal } from "@/lib/dm/proposal-view";
import { publicItemProposal } from "@/lib/dm/proposal-view";

export function maybeProposeItemChange(
  campaign: Campaign,
  turnId: string,
  toolName: string,
  rawArguments: string,
  sheetsById: Map<string, CharacterSheet>,
): ToolResult | null {
  let args: OfferArgs & { characterId?: string; reason?: string };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  // "null" or a bare value parses but is no arguments: the handler refuses it.
  if (!args || typeof args !== "object") {
    return null;
  }
  const sheet = args.characterId ? sheetsById.get(String(args.characterId)) : undefined;
  if (!shouldProposeChange(campaign.gameSettings, toolName, sheet ?? null)) {
    return null;
  }

  // Light validation now, so a malformed offer fails while the model can
  // still fix it; the full check reruns in applyDmMutation on approval.
  if ((toolName === "grant_item" || toolName === "remove_item") && !String(args.name ?? "").trim()) {
    return { error: `${toolName} needs an item name.`, retry: true };
  }
  if (toolName === "modify_gold" && !Number(args.delta ?? 0)) {
    return { error: "modify_gold needs a nonzero delta.", retry: true };
  }
  if (toolName === "purchase" && (!String(args.item ?? args.name ?? "").trim() || (args.action !== "buy" && args.action !== "sell"))) {
    return { error: "purchase needs item and action buy|sell.", retry: true };
  }

  if (toolName === "apply_damage" && !(Number(args.amount ?? 0) >= 1)) {
    return { error: "apply_damage needs a positive amount.", retry: true };
  }
  if (toolName === "heal" && !(Number(args.amount ?? 0) >= 1) && !String(args.spell ?? "").trim()) {
    return { error: "heal needs an amount or a spell.", retry: true };
  }
  if ((toolName === "set_condition" || toolName === "clear_condition") && !String(args.condition ?? "").trim()) {
    return { error: `${toolName} needs a condition.`, retry: true };
  }

  // An offer that could not apply is refused now, before the player sees
  // an apparently valid one (issue 239): nothing to take, nothing to sell.
  const cannot = offerPrecheck(toolName, args, sheet!);
  if (cannot) {
    return cannot;
  }
  // A purchase's line names the price the engine will charge.
  const quoted = toolName === "purchase" ? quotedPurchase(args, sheet!) : args;
  if ("error" in quoted) {
    return quoted;
  }
  // The same offer again, while the first waits or just after it was
  // accepted, is the same loot twice.
  const repeated = duplicateOfferProblem(
    toolName,
    args,
    { id: sheet!.id, name: sheet!.name },
    [...listOpenItemProposals(campaign.id), ...listRecentItemProposals(campaign.id, 20)],
    Date.now(),
  );
  if (repeated) {
    return repeated;
  }

  const summary = proposalSummary(toolName, quoted, sheet!.name);
  const proposal = insertItemProposal({
    campaignId: campaign.id,
    turnId,
    characterId: sheet!.id,
    userId: sheet!.userId,
    toolName,
    argsJson: rawArguments,
    summary,
    reason: String(args.reason ?? "").trim(),
    seq: allocateSeq(campaign.id),
  });
  publishPersisted(campaign.id, "item_proposal_added", {
    proposal: publicItemProposal(proposal),
  });
  return {
    ok: true,
    proposed: summary,
    note: VITALS_PROPOSAL_TOOL_NAMES.has(toolName)
      ? `Recorded as a pending change; ${sheet!.name}'s player will confirm or refuse it. Narrate the blow or the cure as landing, but do not state the new hit points or the condition as fact until it is confirmed. Their answer arrives as a table note; do not ask them for it in words.`
      : `Recorded as an offer; ${sheet!.name}'s player will accept or decline it on their screen. Narrate the offer without assuming acceptance, and do not ask them in words whether they take it: their answer arrives as a table note, and the offer is never to be made again.`,
  };
}

// The offers block of the DM's game state (issue 239): every offer of the
// DM's still waiting on a player, then what was settled in the last hours
// and how. A trade between players is not the DM's offer; the DM hears of
// one through the table note it leaves when it settles.
export function offerLinesForPrompt(
  campaignId: string,
  sheetsById: Map<string, { name: string }>,
  nowMs = Date.now(),
): OfferLine[] {
  const nameOf = (proposal: ItemProposal) => sheetsById.get(proposal.characterId)?.name ?? "a character";
  // An owner-only offer (a pact's approach, issue 503) is the storyteller's
  // and its player's: it rides the storyteller's section, never this list.
  const open = listOpenItemProposals(campaignId)
    .filter((proposal) => proposal.toolName !== "trade" && !proposal.ownerOnly)
    .map((proposal) => ({
      summary: proposal.summary,
      characterName: nameOf(proposal),
      status: "pending" as const,
      outcome: "",
      minutesAgo: null,
    }));
  const settled = listRecentItemProposals(campaignId, SETTLED_OFFERS_MAX * 2)
    .filter((proposal) => {
      if (proposal.toolName === "trade" || proposal.ownerOnly) return false;
      const at = Date.parse(proposal.resolvedAt ?? "");
      return !Number.isNaN(at) && nowMs - at <= SETTLED_OFFERS_WINDOW_MS;
    })
    .slice(0, SETTLED_OFFERS_MAX)
    .map((proposal) => ({
      summary: proposal.summary,
      characterName: nameOf(proposal),
      status: offerLineStatus(proposal.status, proposal.outcome),
      outcome: proposal.outcome,
      minutesAgo: Math.floor((nowMs - Date.parse(proposal.resolvedAt ?? "")) / 60_000),
    }));
  return [...open, ...settled];
}
