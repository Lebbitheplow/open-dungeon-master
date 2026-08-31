import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getParty, updateParty } from "@/lib/db/party";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { addPartyItem, removePartyItem, splitBankedXp } from "@/lib/dm/party-logic";
import { grantItemMath, removeItemMath } from "@/lib/dm/mutation-math";
import { addCopper, formatCopper, parseCoins, purseCopper } from "@/lib/srd/currency";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Moving things between a character and the party.
//
// Every transfer here is two writes that must agree: coin leaving a purse has
// to arrive in the common one, and an item stowed has to leave the hands that
// stowed it. Doing that in one place is the point of the party record; before
// it, "put the rope in the party's kit" meant picking a character to blame.

export const PARTY_TOOL_NAMES = ["party_stash"] as const;

const stashSchema = z.object({
  do: z.enum(["stow", "take", "deposit", "withdraw"]),
  characterId: z.string().optional(),
  name: z.string().max(80).optional(),
  qty: z.coerce.number().int().min(1).max(999).optional(),
  coins: z.string().max(60).optional(),
  amount: z.coerce.number().int().min(0).max(1000000).optional(),
  reason: z.string().max(200).optional(),
});

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const partyTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "party_stash",
      description:
        "Move an item or money between one character and the party's shared pack and common purse. stow/take move an item (name, qty); deposit/withdraw move money (coins like '3 gp 4 sp', or amount in whole gold). The party's pack and purse are shared property: use them for the rope nobody wants to carry and the coin the party banked together, not for a character's own kit.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          do: {
            type: "string",
            enum: ["stow", "take", "deposit", "withdraw"],
            description: "stow/take an item, deposit/withdraw money.",
          },
          characterId: { type: "string", description: "Whose hands it comes from or goes to." },
          name: { type: "string", description: "Item name, for stow and take." },
          qty: { type: "integer", minimum: 1, maximum: 999 },
          coins: { type: "string", description: "Money in denominations, e.g. '3 gp 4 sp'." },
          amount: { type: "integer", minimum: 0, description: "Money in whole gold, if coins is not used." },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["do"],
      },
    },
  },
];

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

function publishParty(campaignId: string, party: ReturnType<typeof getParty>) {
  publishPersisted(campaignId, "party_updated", { party });
}

function resolve(
  id: string | undefined,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet | null {
  if (!id) {
    return null;
  }
  const direct = sheetsById.get(id);
  if (direct) {
    return direct;
  }
  const named = sheets.find((sheet) => sheet.name.toLowerCase() === id.toLowerCase());
  return named ?? null;
}

export function handlePartyStash(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof stashSchema>;
  try {
    args = stashSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: party_stash needs a `do` of stow, take, deposit or withdraw." };
  }

  const sheet = resolve(args.characterId, sheets, sheetsById);
  if (!sheet) {
    return { error: "party_stash needs a characterId: someone has to be handing it over or taking it." };
  }
  // Re-read: the sheet handed in may be a snapshot from the start of the turn.
  const fresh = getSheetById(sheet.id) ?? sheet;

  if (args.do === "stow" || args.do === "take") {
    const name = (args.name ?? "").trim();
    if (!name) {
      return { error: "Name the item." };
    }
    const qty = args.qty ?? 1;

    if (args.do === "stow") {
      const taken = removeItemMath(fresh.equipment, name, qty);
      if (!taken) {
        return { error: `${fresh.name} is not carrying "${name}".` };
      }
      const added = addPartyItem(getParty(campaign.id).inventory, {
        name,
        qty: taken.removed,
        weight: fresh.equipment.find((item) => item.name.toLowerCase() === name.toLowerCase())?.weight,
      });
      if ("error" in added) {
        return added;
      }
      patchSheet(fresh.id, { equipment: taken.equipment });
      const party = updateParty(campaign.id, (current) => ({ ...current, inventory: added.inventory }));
      publishParty(campaign.id, party);
      tableNote(campaign, `${fresh.name} puts ${name}${taken.removed > 1 ? ` x${taken.removed}` : ""} in the party's pack.`);
      return { ok: true, stowed: name, qty: taken.removed };
    }

    const party = getParty(campaign.id);
    const taken = removePartyItem(party.inventory, name, qty);
    if ("error" in taken) {
      return taken;
    }
    const granted = grantItemMath(fresh.equipment, taken.item.name, taken.removed, {
      identified: taken.item.identified !== false,
    });
    patchSheet(fresh.id, { equipment: granted.equipment });
    const next = updateParty(campaign.id, (current) => ({ ...current, inventory: taken.inventory }));
    publishParty(campaign.id, next);
    tableNote(campaign, `${fresh.name} takes ${name}${taken.removed > 1 ? ` x${taken.removed}` : ""} from the party's pack.`);
    return { ok: true, took: name, qty: taken.removed };
  }

  // Money. Coins win over the whole-gold amount when both are sent, for the
  // same reason they do in modify_gold: the more specific one was meant.
  const parsed = args.coins ? parseCoins(args.coins) : null;
  const copper = parsed ?? (args.amount ?? 0) * 100;
  if (copper <= 0) {
    return { error: "Say how much: coins like '3 gp 4 sp', or an amount in gold." };
  }

  if (args.do === "deposit") {
    const change = addCopper({ gold: fresh.gold, copper: fresh.copper }, -copper);
    if (change.short > 0) {
      return {
        error: `${fresh.name} only has ${formatCopper(purseCopper({ gold: fresh.gold, copper: fresh.copper }))}.`,
      };
    }
    patchSheet(fresh.id, { gold: change.purse.gold, copper: change.purse.copper });
    const party = updateParty(campaign.id, (current) => ({
      ...current,
      copper: current.copper + copper,
    }));
    publishParty(campaign.id, party);
    tableNote(campaign, `${fresh.name} puts ${formatCopper(copper)} in the common purse.`);
    return { ok: true, deposited: formatCopper(copper), purse: formatCopper(party.copper) };
  }

  const party = getParty(campaign.id);
  if (party.copper < copper) {
    return { error: `The common purse holds ${formatCopper(party.copper)}.` };
  }
  const change = addCopper({ gold: fresh.gold, copper: fresh.copper }, copper);
  patchSheet(fresh.id, { gold: change.purse.gold, copper: change.purse.copper });
  const next = updateParty(campaign.id, (current) => ({
    ...current,
    copper: Math.max(0, current.copper - copper),
  }));
  publishParty(campaign.id, next);
  tableNote(campaign, `${fresh.name} takes ${formatCopper(copper)} from the common purse.`);
  return { ok: true, withdrew: formatCopper(copper), purse: formatCopper(next.copper) };
}

// Handing out what the party banked. Not an adjudication: the DM decides when
// a session's experience is divided, and the AI has award_xp for everything
// it should be doing on its own.
export function payOutBankedXp(
  campaign: Campaign,
  characterIds: string[],
): { each: number; paid: string[] } | { error: string } {
  const party = getParty(campaign.id);
  if (party.bankedXp <= 0) {
    return { error: "There is no banked experience to hand out." };
  }
  const targets = characterIds.map((id) => getSheetById(id)).filter((sheet): sheet is CharacterSheet => Boolean(sheet));
  if (!targets.length) {
    return { error: "Nobody to hand it to." };
  }
  const split = splitBankedXp(party.bankedXp, targets.length);
  targets.forEach((sheet, index) => {
    patchSheet(sheet.id, { xp: sheet.xp + split.each[index] });
  });
  const next = updateParty(campaign.id, (current) => ({ ...current, bankedXp: 0 }));
  publishParty(campaign.id, next);
  tableNote(
    campaign,
    `The party divides ${split.spent} experience between ${targets.map((sheet) => sheet.name).join(", ")}.`,
  );
  return { each: split.each[0], paid: targets.map((sheet) => sheet.name) };
}
