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

// The vitals the second switch (vitalsApprovals) stages: what a DM tool
// call does to a player character's hit points and conditions.
export const VITALS_PROPOSAL_TOOL_NAMES = new Set([
  "apply_damage",
  "heal",
  "set_condition",
  "clear_condition",
]);

export const PROPOSAL_TTL_HOURS = 24;

export type ProposalArgs = {
  name?: string;
  item?: string;
  qty?: number;
  delta?: number;
  price?: number;
  action?: string;
  // apply_damage, heal, set_condition, clear_condition
  amount?: number;
  type?: string;
  temp?: boolean;
  spell?: string;
  condition?: string;
  rounds?: number;
};

export type ApprovalSettings = { inventoryApprovals: boolean; vitalsApprovals: boolean };

// Which DM tool calls become offers under this table's two switches: items
// and gold under the first, hit points and conditions under the second.
// Only a real player's character is staged; companions, pets and enemies
// stay auto-applied (nobody is at the table to approve for them).
export function shouldProposeChange(
  settings: ApprovalSettings,
  toolName: string,
  target: { isCompanion?: boolean } | null,
): boolean {
  if (!target || target.isCompanion) {
    return false;
  }
  if (PROPOSAL_TOOL_NAMES.has(toolName)) {
    return settings.inventoryApprovals;
  }
  if (VITALS_PROPOSAL_TOOL_NAMES.has(toolName)) {
    return settings.vitalsApprovals;
  }
  return false;
}

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
    case "apply_damage": {
      const amount = Math.max(1, Number(args.amount ?? 0));
      const type = String(args.type ?? "").trim();
      return `Deal ${amount} ${type ? `${type} ` : ""}damage to ${characterName}`;
    }
    case "heal": {
      const amount = Number(args.amount ?? 0);
      const spell = String(args.spell ?? "").trim();
      if (args.temp) {
        return `Give ${characterName} ${Math.max(1, amount)} temporary hit points`;
      }
      return spell
        ? `Heal ${characterName} with ${spell}${amount > 0 ? ` (${amount})` : ""}`
        : `Heal ${characterName} for ${Math.max(1, amount)}`;
    }
    case "set_condition": {
      const condition = String(args.condition ?? "a condition").trim() || "a condition";
      const rounds = Number(args.rounds ?? 0);
      return `Make ${characterName} ${condition}${rounds > 0 ? ` for ${rounds} round${rounds === 1 ? "" : "s"}` : ""}`;
    }
    case "clear_condition": {
      const condition = String(args.condition ?? "a condition").trim() || "a condition";
      return `Clear ${condition} from ${characterName}`;
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
