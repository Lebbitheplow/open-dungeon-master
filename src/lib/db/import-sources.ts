import {
  capsFor,
  getCampaignForUser,
  listCampaignsForUser,
  type Campaign,
} from "@/lib/db/campaigns";
import { listWorkshopsForUser } from "@/lib/db/workshops";
import { readImportSource } from "@/lib/db/content-import";
import { IMPORT_KINDS, type ImportKind } from "@/lib/workshop/import";
import type { CampaignKind } from "@/lib/workshop/kind";

// Who may copy prep OUT of what.
//
// src/lib/db/content-import.ts will happily copy rows between any two
// campaign ids, because that is all an import is. This module is the gate in
// front of it, and it is the only place that decides. Two rules:
//
//   1. A workshop is one person's prep space, so only its owner may copy
//      from it. That matches src/lib/db/workshops.ts.
//   2. A campaign's lore, cast, region and prepared fights are the story's
//      secret spine, so copying them out follows STORY AUTHORITY: the party
//      lead in an AI-run game, the DM once a person runs it. A player at the
//      table cannot walk off with the DM's notes.
//
// Deliberately the same permission that /api/campaigns/[id]/import demands at
// the TARGET end. Both are required; they are two separate questions.

export type ImportSourceSummary = {
  id: string;
  title: string;
  kind: CampaignKind;
  updatedAt: string;
  // How much of each importable kind this source holds, so a picker never
  // has to fetch per source.
  contents: Record<ImportKind, number>;
};

export function getImportSourceForUser(sourceId: string, userId: string): Campaign | null {
  const campaign = getCampaignForUser(sourceId, userId);
  if (!campaign) {
    return null;
  }
  if (campaign.kind === "workshop") {
    return campaign.ownerUserId === userId ? campaign : null;
  }
  return capsFor(campaign, userId).steersStory ? campaign : null;
}

function summarize(campaign: Campaign): ImportSourceSummary {
  const source = readImportSource(campaign.id);
  return {
    id: campaign.id,
    title: campaign.title,
    kind: campaign.kind,
    updatedAt: campaign.updatedAt,
    contents: Object.fromEntries(
      IMPORT_KINDS.map((kind) => [kind, source[kind].length]),
    ) as Record<ImportKind, number>,
  };
}

// Everything this user may copy from: their workshops first, because that is
// what a prep space is for, then the campaigns they steer.
export function listImportSourcesForUser(userId: string): ImportSourceSummary[] {
  const workshops = listWorkshopsForUser(userId).map((workshop) =>
    summarize(workshop as Campaign),
  );
  const campaigns = listCampaignsForUser(userId)
    .map((summary) => getImportSourceForUser(summary.id, userId))
    .filter((campaign): campaign is Campaign => Boolean(campaign))
    .map(summarize);
  return [...workshops, ...campaigns];
}
