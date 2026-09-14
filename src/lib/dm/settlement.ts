import type { Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { setLocationLayout, type CampaignLocation } from "@/lib/db/locations";
import { insertLoreEntry } from "@/lib/db/lore";
import { createNpcFromDraft, getNpcByName, listNpcs } from "@/lib/db/npcs";
import { insertRollTable } from "@/lib/db/roll-tables";
import { insertShop, listShopsAt } from "@/lib/db/shops";
import { SIZE_MARKUP, stockFromPool } from "@/lib/dm/shop-logic";
import { stockPool } from "@/lib/dm/shop-tools";
import { generateSettlement, seedFromText, type Settlement } from "@/lib/overworld/settlement";
import { publishEphemeral } from "@/lib/events";

// Writing a generated settlement into a campaign (docs/vtt-parity-implementation-plan.md
// 12.1): the people join the cast at that place, the shops open there with
// stock from the pack, the rumours become a roll table and the hook a lore
// entry only the DM reads. A place already peopled is left alone.

export type PopulateOutcome = { ok: true; settlement: Settlement; npcs: number; shops: number } | { error: string };

export function placeIsWritten(campaign: Campaign, location: CampaignLocation): boolean {
  const here = location.name.toLowerCase();
  return listNpcs(campaign.id).some((npc) => npc.location.toLowerCase() === here) || listShopsAt(campaign.id, location.id, location.name).length > 0;
}

export function populateSettlement(campaign: Campaign, location: CampaignLocation, options: { size?: unknown; terrain?: unknown; seed?: number; force?: boolean } = {}): PopulateOutcome {
  if (!options.force && placeIsWritten(campaign, location)) {
    return { error: `${location.name} already has people in it.` };
  }
  const settlement = generateSettlement({
    name: location.name,
    size: options.size,
    terrain: options.terrain,
    genre: campaign.gameSettings.genre,
    seed: options.seed ?? seedFromText(`${campaign.id}|${location.name}`),
  });
  let npcs = 0;
  for (const draft of settlement.npcs) {
    if (getNpcByName(campaign.id, draft.name)) {
      continue;
    }
    createNpcFromDraft(campaign.id, draft);
    npcs += 1;
  }
  const instant = getClock(campaign.id).instant;
  let shops = 0;
  for (const shop of settlement.shops) {
    const keeper = getNpcByName(campaign.id, shop.keeper);
    insertShop(campaign.id, {
      name: shop.name,
      kind: shop.kind,
      size: shop.size,
      locationId: location.id,
      locationName: location.name,
      keeperNpcId: keeper?.id ?? "",
      stock: stockFromPool(stockPool(shop.kind), shop.size),
      markup: SIZE_MARKUP[shop.size],
      restockedAt: instant,
    });
    shops += 1;
  }
  insertRollTable({
    campaignId: campaign.id,
    name: `Rumours in ${settlement.name}`,
    entries: settlement.rumours,
    createdByUserId: campaign.ownerUserId,
  });
  insertLoreEntry({
    campaignId: campaign.id,
    category: "history",
    title: settlement.hook.title,
    body: settlement.hook.body,
    tags: ["hook", settlement.name],
    visibility: "dm",
  });
  if (!location.layoutDescription.trim()) {
    setLocationLayout(location.id, settlement.layoutDescription);
  }
  publishEphemeral(campaign.id, "npc_updated", { at: Date.now() });
  publishEphemeral(campaign.id, "shops_updated", { at: Date.now() });
  publishEphemeral(campaign.id, "lore_updated", { at: Date.now() });
  return { ok: true, settlement, npcs, shops };
}
