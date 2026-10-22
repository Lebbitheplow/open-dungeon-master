import { getDatabase, parseJson } from "@/lib/db/core";
import { repairedWeight } from "@/lib/content/item-weights";
import { normalizeParty, type PartyState } from "@/lib/dm/party-logic";
import { rowName } from "@/lib/srd/item-row";

// Reading and writing the party record.
//
// One column on the campaign row rather than a table: there is exactly one
// party per campaign, it is replaced rather than accumulated, and it is
// hydrated onto every Campaign so the prompt and the panel read the same
// value. The functions here are for the callers that change it.

export function getParty(campaignId: string): PartyState {
  const row = getDatabase()
    .prepare(`SELECT party_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { party_json?: string } | undefined;
  return partyFromJson(row?.party_json ?? "");
}

// The stored column read into a party, here and on every Campaign
// (src/lib/db/campaigns.ts), so both read the same value.
export function partyFromJson(json: string): PartyState {
  return withRepairedWeights(normalizeParty(parseJson(json, null)));
}

// The shared pack keeps the per-unit weight of what was put in it, so a dart
// stashed from a sheet an old pack weighed (issue #205) carries 14 lb; that
// one number is put right on read and saved with the next change.
function withRepairedWeights(party: PartyState): PartyState {
  if (!party.inventory.some((item) => item.weight !== undefined)) {
    return party;
  }
  const inventory = party.inventory.map((item) => {
    const weight = repairedWeight(rowName(item), item.weight);
    if (weight === item.weight) {
      return item;
    }
    const line = { ...item };
    delete line.weight;
    return weight === undefined ? line : { ...line, weight };
  });
  return { ...party, inventory };
}

export function setParty(campaignId: string, party: PartyState) {
  getDatabase()
    .prepare(`UPDATE campaigns SET party_json = ? WHERE id = ?`)
    .run(JSON.stringify(party), campaignId);
}

// Read, change, write, in one place. Two engines touching the party at once
// (a hoard split while the DM edits the pack) cannot both write from the same
// stale copy, which is the whole reason the party is one record and not five
// sheets in the first place.
export function updateParty(
  campaignId: string,
  change: (party: PartyState) => PartyState,
): PartyState {
  const next = change(getParty(campaignId));
  setParty(campaignId, next);
  return next;
}
