import { getDatabase, parseJson } from "@/lib/db/core";
import { normalizeParty, type PartyState } from "@/lib/dm/party-logic";

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
  return normalizeParty(parseJson(row?.party_json ?? "", null));
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
