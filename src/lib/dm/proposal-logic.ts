// Pure logic for the inventory-approval flow: which DM mutations become
// player-approved proposals, the human summary the approval bar shows, and
// expiry. No DB access and no "@/" imports so
// scripts/test-item-proposals.mjs can load it directly; the impure rim is
// src/lib/db/item-proposals.ts plus the turn.ts interception.

import type { ToolError } from "./tool-errors.ts";
import { textKey } from "../language/text-logic.ts";
import { lineNamed } from "../srd/item-row.ts";

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

// ---- Settling an offer with the DM (issue 239) ----
//
// Accepting or declining an offer settled the sheet but never the story:
// the DM read the next turn's history and sheets and saw neither which
// offer was answered nor how, so it asked again in words and, told "yes",
// made a fresh offer for the same loot. Three things close that: a system
// line in the chronicle when an offer is settled (the DM reads it as
// authoritative, the table reads it as words), a block of open and recently
// settled offers in the game state, and a refusal before an offer is shown
// when it repeats one that is pending or just accepted, or cannot apply.

// Marks the system line that says how an offer was answered.
export const OFFER_NOTE_PREFIX = "[Offer settled] ";

// An identical offer inside this window of an accepted one is the same loot
// twice unless the caller says it is another (`additional: true`).
export const DUPLICATE_OFFER_WINDOW_MS = 10 * 60_000;

// How far back the game state lists settled offers, and how many.
export const SETTLED_OFFERS_WINDOW_MS = 6 * 3_600_000;
export const SETTLED_OFFERS_MAX = 8;

export type OfferArgs = ProposalArgs & { coins?: string; additional?: boolean; unidentified?: boolean };

export type OfferSheet = {
  name: string;
  equipment: Array<{ name: string; qty: number; srdName?: string }>;
  gold: number;
  copper: number;
};

// The first row by that name, as removeItemMath takes it (an unidentified
// twin sits in its own row and is not touched by a removal of the first).
function heldQty(sheet: OfferSheet, name: string): number {
  const row = sheet.equipment[lineNamed(sheet.equipment, name)];
  return row ? Math.max(0, Number(row.qty) || 0) : 0;
}

// The stored tool arguments, tolerant of a bad row.
export function parseOfferArgs(raw: string): OfferArgs {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as OfferArgs) : {};
  } catch {
    return {};
  }
}

export function purseWords(gold: number, copper: number): string {
  const cp = Math.max(0, Math.round(gold * 100 + copper));
  const gp = Math.floor(cp / 100);
  const rest = cp % 100;
  if (!rest) {
    return `${gp} gp`;
  }
  return `${gp} gp ${rest} cp`;
}

// Whether the offer could apply right now: a removal or a sale of what the
// character does not carry is refused before the player ever sees it, and
// the DM is told why. Coin is not checked here: modify_gold floors at zero
// by its own contract and a purchase is priced by the shelf, not the call,
// so both are left to applyDmMutation on approval (a failure there is told
// to the table as one).
export function offerPrecheck(toolName: string, args: OfferArgs, sheet: OfferSheet): ToolError | null {
  const qty = Math.max(1, Math.floor(Number(args.qty ?? 1) || 1));
  if (toolName === "remove_item") {
    const name = String(args.name ?? "").trim();
    const held = heldQty(sheet, name);
    if (!held) {
      return { error: `${sheet.name} does not carry "${name}", so there is nothing to take and no offer was made. Check the sheet before offering a removal.`, retry: true };
    }
    if (qty > held) {
      return { error: `${sheet.name} carries only ${held} ${name}; offer to take at most ${held}. No offer was made.`, retry: true };
    }
    return null;
  }
  if (toolName === "purchase" && args.action === "sell") {
    const item = String(args.item ?? args.name ?? "").trim();
    const held = heldQty(sheet, item);
    if (!held) {
      return { error: `${sheet.name} does not carry "${item}" to sell. No offer was made.`, retry: true };
    }
    if (qty > held) {
      return { error: `${sheet.name} carries only ${held} ${item} to sell. No offer was made.`, retry: true };
    }
  }
  return null;
}

// What an offer is, apart from who made it and when: the same key twice is
// the same offer. Vitals have no key (a second blow or cure is its own).
export function offerKey(toolName: string, args: OfferArgs): string | null {
  const qty = Math.max(1, Math.floor(Number(args.qty ?? 1) || 1));
  switch (toolName) {
    case "grant_item":
    case "remove_item":
      return `${toolName}|${textKey(String(args.name ?? ""))}|${qty}|${args.unidentified ? 1 : 0}`;
    case "modify_gold":
      return `${toolName}|${Number(args.delta ?? 0) || 0}|${String(args.coins ?? "").trim().toLowerCase()}`;
    case "purchase":
      return `${toolName}|${args.action}|${textKey(String(args.item ?? args.name ?? ""))}|${qty}|${Number(args.price ?? 0) || 0}`;
    default:
      return null;
  }
}

export type RecentOffer = {
  toolName: string;
  characterId: string;
  argsJson: string;
  status: ProposalStatus;
  createdAt: string;
  resolvedAt: string | null;
};

// The same offer again, while the first still waits or just after it was
// accepted, is refused with the reason: the loot is claimed or the answer
// is still coming. `additional: true` says this is another of the same from
// a separate source and passes the accepted check (never the pending one).
export function duplicateOfferProblem(
  toolName: string,
  args: OfferArgs,
  character: { id: string; name: string },
  recent: readonly RecentOffer[],
  nowMs: number,
): ToolError | null {
  const key = offerKey(toolName, args);
  if (!key) {
    return null;
  }
  const summary = proposalSummary(toolName, args, character.name);
  for (const offer of recent) {
    if (offer.characterId !== character.id || offer.toolName !== toolName) {
      continue;
    }
    if (offerKey(offer.toolName, parseOfferArgs(offer.argsJson)) !== key) {
      continue;
    }
    if (offer.status === "pending" && !proposalExpired(offer.createdAt, new Date(nowMs))) {
      return { error: `An identical offer ("${summary}") is still waiting for ${character.name}'s player to answer. Do not offer it again and do not ask them in words; their answer arrives as a table note.`, retry: true };
    }
    if (offer.status === "approved" && !args.additional) {
      const resolved = Date.parse(offer.resolvedAt ?? "");
      const age = Number.isNaN(resolved) ? Number.POSITIVE_INFINITY : nowMs - resolved;
      if (age <= DUPLICATE_OFFER_WINDOW_MS) {
        const minutes = Math.max(1, Math.round(age / 60_000));
        const what = toolName === "modify_gold" ? "coin" : "loot";
        return { error: `${character.name}'s player already accepted "${summary}" ${minutes} minute${minutes === 1 ? "" : "s"} ago and it was applied; that ${what} is claimed. Do not grant it twice. Only if this is truly another, separate ${what} from a different source, call again with additional: true.`, retry: true };
      }
    }
  }
  return null;
}

export type OfferAfter = OfferSheet & {
  currentHp: number;
  maxHp: number;
  tempHp: number;
  conditions: string[];
};

// What applying the offer left on the sheet, in one sentence the chronicle
// and the DM both read.
export function appliedOutcome(toolName: string, args: OfferArgs, after: OfferAfter): string {
  const name = after.name;
  const item = String(args.name ?? args.item ?? "").trim();
  switch (toolName) {
    case "grant_item": {
      const held = heldQty(after, item);
      return `${name} now carries ${item}${held > 1 ? ` x${held}` : ""}.`;
    }
    case "remove_item": {
      const held = heldQty(after, item);
      return held ? `${name} still carries ${item} x${held}.` : `${name} no longer carries any ${item}.`;
    }
    case "modify_gold":
      return `${name}'s purse now holds ${purseWords(after.gold, after.copper)}.`;
    case "purchase": {
      const held = heldQty(after, item);
      return `${name}'s purse now holds ${purseWords(after.gold, after.copper)}${held ? `; ${name} carries ${item}${held > 1 ? ` x${held}` : ""}` : ""}.`;
    }
    case "apply_damage":
    case "heal":
      return `${name} is at ${after.currentHp}/${after.maxHp} hit points${after.tempHp > 0 ? ` with ${after.tempHp} temporary` : ""}.`;
    case "set_condition": {
      const condition = String(args.condition ?? "").trim();
      return after.conditions.some((entry) => entry.toLowerCase() === condition.toLowerCase())
        ? `${name} is now ${condition}.`
        : `${name} is not ${condition} after all.`;
    }
    case "clear_condition":
      return `${name} is no longer ${String(args.condition ?? "").trim()}.`;
    default:
      return "";
  }
}

export type OfferResolution = "approved" | "declined" | "cancelled" | "expired" | "failed";

// The line the chronicle shows when an offer is settled (after the prefix).
export function resolutionNote(input: {
  status: OfferResolution;
  summary: string;
  characterName: string;
  // The lead answered for the player.
  byLead?: boolean;
  // Who withdrew it, when not the lead (a trade's own proposer may).
  withdrawnBy?: string;
  // What applying it did, or why it could not be applied.
  outcome?: string;
}): string {
  const { status, summary, characterName, byLead = false, withdrawnBy = "", outcome = "" } = input;
  const tail = outcome ? ` ${outcome}` : "";
  switch (status) {
    case "approved":
      return byLead
        ? `The lead accepted the offer for ${characterName}: ${summary}.${tail}`
        : `${characterName} accepted the offer: ${summary}.${tail}`;
    case "declined":
      return byLead
        ? `The lead declined the offer for ${characterName}: ${summary}. Nothing changed.`
        : `${characterName} declined the offer: ${summary}. Nothing changed.`;
    case "cancelled":
      return `${withdrawnBy || "The lead"} withdrew the offer: ${summary}. Nothing changed.`;
    case "expired":
      return `The offer lapsed unanswered: ${summary}. Nothing changed.`;
    case "failed":
      return `The offer "${summary}" could not be applied${outcome ? ` (${outcome.replace(/\.$/, "")})` : ""}. Nothing changed.`;
  }
}

export type OfferLine = {
  summary: string;
  characterName: string;
  status: ProposalStatus | "failed";
  outcome: string;
  minutesAgo: number | null;
};

// Every proposal row, as the game state wants it: status "declined" with a
// failure recorded is a failure, not a refusal.
export function offerLineStatus(status: ProposalStatus, outcome: string): OfferLine["status"] {
  return status === "declined" && outcome.startsWith("failed:") ? "failed" : status;
}

function ago(minutes: number | null): string {
  if (minutes === null) {
    return "";
  }
  return minutes < 1 ? " just now" : ` ${minutes} min ago`;
}

// The offers block of the game state: what waits on a player, and what was
// settled recently and how. Empty when there is nothing to say.
export function renderOffersBlock(offers: readonly OfferLine[]): string {
  if (!offers.length) {
    return "";
  }
  const lines = offers.map((offer) => {
    switch (offer.status) {
      case "pending":
        return `- WAITING on ${offer.characterName}'s player: ${offer.summary}. Do not offer it again, do not ask them in words, and do not narrate it as done; their answer arrives as a table note.`;
      case "approved":
        return `- ACCEPTED${ago(offer.minutesAgo)} and applied: ${offer.summary}.${offer.outcome ? ` ${offer.outcome}` : ""} Already settled: never offer or grant the same thing again; carry the scene on from here.`;
      case "declined":
        return `- DECLINED${ago(offer.minutesAgo)}: ${offer.summary}. Nothing changed; respect the refusal.`;
      case "failed":
        return `- COULD NOT BE APPLIED${ago(offer.minutesAgo)}: ${offer.summary} (${offer.outcome.replace(/^failed:\s*/, "").replace(/\.$/, "")}). Nothing changed.`;
      case "cancelled":
        return `- WITHDRAWN by the lead${ago(offer.minutesAgo)}: ${offer.summary}. Nothing changed.`;
      case "expired":
        return `- LAPSED unanswered${ago(offer.minutesAgo)}: ${offer.summary}. Nothing changed.`;
    }
  });
  return `Offers to players (changes a player must accept before they land; the server settled each one exactly as recorded here, authoritative):\n${lines.join("\n")}`;
}
