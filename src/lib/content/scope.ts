import { getCampaignForUser } from "@/lib/db/campaigns";
import { listHomebrew, tableAuthors } from "@/lib/db/homebrew";
import type { HomebrewKind } from "@/lib/schemas/homebrew";

// Whose homebrew a content request reads, the one rule every picker, the
// builder, the Hand and play agree on.
//
//   - Outside a table (the workshop, the library, a character made on its
//     own): the asker's own shelf.
//   - At a table (`?campaign=<id>`, which the asker must belong to): the
//     shelves of whoever runs it, its owner and its DM and assistant DM
//     seats (src/lib/db/homebrew.ts tableAuthors). That is the same list the
//     cast guard, the sheet's gear, the feat and subclass readers and the
//     monster lookup read in play, so what a picker offers is what the table
//     admits, and what it admits is what plays.
//
// A player's own entry is not a rule of anybody's table until one of those
// people keeps a copy; at a table the response names the asker's own
// entries it left out (`unadmitted`), so a picker can say why.

export type ContentScope = {
  userIds: string[];
  campaignId: string | null;
  // The asker is one of the authors whose shelves count.
  admitted: boolean;
};

export function contentScopeFor(url: URL, userId: string): ContentScope | { error: string; status: number } {
  const campaignId = (url.searchParams.get("campaign") ?? "").trim();
  if (!campaignId) {
    return { userIds: [userId], campaignId: null, admitted: true };
  }
  const campaign = getCampaignForUser(campaignId, userId);
  if (!campaign) {
    return { error: "Campaign not found.", status: 404 };
  }
  const authors = tableAuthors(campaign.id);
  return { userIds: authors, campaignId: campaign.id, admitted: authors.includes(userId) };
}

const KIND_OF: Record<string, HomebrewKind> = {
  spells: "spell",
  items: "item",
  feats: "feat",
  backgrounds: "background",
  races: "race",
  archetypes: "archetype",
  monsters: "monster",
  hazards: "hazard",
};

// The asker's own entries of a kind that this table does not admit, by name,
// matching the search; empty outside a table or for one of its authors.
export function unadmittedNames(scope: ContentScope, userId: string, kind: string, q: string): string[] {
  const homebrewKind = KIND_OF[kind];
  if (scope.admitted || !scope.campaignId || !homebrewKind) {
    return [];
  }
  const needle = q.trim().toLowerCase();
  const admitted = new Set(
    scope.userIds.flatMap((author) => listHomebrew(author, homebrewKind).map((entry) => entry.name.trim().toLowerCase())),
  );
  return listHomebrew(userId, homebrewKind)
    .map((entry) => entry.name)
    .filter((name) => (!needle || name.toLowerCase().includes(needle)) && !admitted.has(name.trim().toLowerCase()))
    .slice(0, 12);
}
