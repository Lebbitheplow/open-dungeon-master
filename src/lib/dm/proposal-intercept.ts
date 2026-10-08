import { normalizeTradeOffer } from "@/lib/dm/trade-logic";
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertItemProposal, type ItemProposal } from "@/lib/db/item-proposals";
import { publishPersisted } from "@/lib/events";
import {
  proposalSummary,
  shouldProposeChange,
  VITALS_PROPOSAL_TOOL_NAMES,
  type ProposalArgs,
} from "@/lib/dm/proposal-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Interception for the inventoryApprovals and vitalsApprovals game
// settings: a DM inventory, gold, damage, healing or condition mutation
// aimed at a player character becomes a pending offer the owning player
// answers, instead of applying immediately. Returns null when the normal
// auto-apply path should run.

// Inventory is party-visible, so the full proposal may ride the persisted
// stream (unlike notes/whispers).
export function publicItemProposal(proposal: ItemProposal) {
  return {
    id: proposal.id,
    characterId: proposal.characterId,
    userId: proposal.userId,
    toolName: proposal.toolName,
    summary: proposal.summary,
    reason: proposal.reason,
    status: proposal.status,
    createdAt: proposal.createdAt,
    toCharacterId: proposal.toCharacterId,
    // A trade carries its offer so the bar can lay out both sides.
    ...(proposal.toolName === "trade" ? { offer: normalizeTradeOffer(safeParse(proposal.argsJson)) } : {}),
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export function maybeProposeItemChange(
  campaign: Campaign,
  turnId: string,
  toolName: string,
  rawArguments: string,
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> | null {
  let args: ProposalArgs & { characterId?: string; reason?: string };
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
    return { error: `${toolName} needs an item name.` };
  }
  if (toolName === "modify_gold" && !Number(args.delta ?? 0)) {
    return { error: "modify_gold needs a nonzero delta." };
  }
  if (
    toolName === "purchase" &&
    (!String(args.item ?? args.name ?? "").trim() ||
      args.price === undefined ||
      (args.action !== "buy" && args.action !== "sell"))
  ) {
    return { error: "purchase needs item, price, and action buy|sell." };
  }

  if (toolName === "apply_damage" && !(Number(args.amount ?? 0) >= 1)) {
    return { error: "apply_damage needs a positive amount." };
  }
  if (toolName === "heal" && !(Number(args.amount ?? 0) >= 1) && !String(args.spell ?? "").trim()) {
    return { error: "heal needs an amount or a spell." };
  }
  if ((toolName === "set_condition" || toolName === "clear_condition") && !String(args.condition ?? "").trim()) {
    return { error: `${toolName} needs a condition.` };
  }

  const summary = proposalSummary(toolName, args, sheet!.name);
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
      ? `Recorded as a pending change; ${sheet!.name}'s player will confirm or refuse it. Narrate the blow or the cure as landing, but do not state the new hit points or the condition as fact until it is confirmed.`
      : `Recorded as an offer; ${sheet!.name}'s player will accept or decline it. Narrate the offer without assuming acceptance.`,
  };
}
