// Pure logic for the inventory-approval flow: which DM mutations become
// player-approved proposals, the human summary the approval bar shows, and
// expiry. No DB access and no "@/" imports so
// scripts/test-item-proposals.mjs can load it directly; the impure rim is
// src/lib/db/item-proposals.ts plus the turn.ts interception.

export const PROPOSAL_TOOL_NAMES = new Set([
  "grant_item",
  "remove_item",
  "modify_gold",
  "purchase",
]);

export const PROPOSAL_TTL_HOURS = 24;

export type ProposalArgs = {
  name?: string;
  item?: string;
  qty?: number;
  delta?: number;
  price?: number;
  action?: string;
};

// Only DM-initiated inventory/gold changes to a real player's character are
// staged; companions, pets, and enemies stay auto-applied (nobody is at the
// table to approve for them).
export function shouldProposeItemChange(
  inventoryApprovals: boolean,
  toolName: string,
  target: { isCompanion?: boolean } | null,
): boolean {
  return Boolean(
    inventoryApprovals && PROPOSAL_TOOL_NAMES.has(toolName) && target && !target.isCompanion,
  );
}

export function proposalSummary(
  toolName: string,
  args: ProposalArgs,
  characterName: string,
): string {
  const qty = Math.max(1, Number(args.qty ?? 1));
  const itemName = String(args.name ?? args.item ?? "an item").trim() || "an item";
  const suffix = qty > 1 ? ` x${qty}` : "";
  switch (toolName) {
    case "grant_item":
      return `Give ${itemName}${suffix} to ${characterName}`;
    case "remove_item":
      return `Take ${itemName}${suffix} from ${characterName}`;
    case "modify_gold": {
      const delta = Number(args.delta ?? 0);
      return delta >= 0
        ? `Give ${delta} gold to ${characterName}`
        : `Take ${Math.abs(delta)} gold from ${characterName}`;
    }
    case "purchase": {
      const price = Number(args.price ?? 0) * qty;
      return args.action === "sell"
        ? `${characterName} sells ${itemName}${suffix} for ${price} gold`
        : `${characterName} buys ${itemName}${suffix} for ${price} gold`;
    }
    default:
      return `${toolName} for ${characterName}`;
  }
}

export function proposalExpired(createdAt: string, now: Date): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) {
    return true;
  }
  return now.getTime() - created > PROPOSAL_TTL_HOURS * 3_600_000;
}

export type ProposalStatus = "pending" | "approved" | "declined" | "expired" | "cancelled";

// Which resolutions each actor may apply: the owning player answers, the
// lead may also answer or withdraw the offer.
export function canResolveProposal(
  action: "approve" | "decline" | "cancel",
  actorIsOwner: boolean,
  actorIsLead: boolean,
): boolean {
  if (action === "cancel") {
    return actorIsLead;
  }
  return actorIsOwner || actorIsLead;
}
