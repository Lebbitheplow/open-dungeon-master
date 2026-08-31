import { getDatabase, nowIso } from "@/lib/db/core";
import {
  createCampaign,
  getCampaignForUser,
  updateGameSettings,
  type Campaign,
} from "@/lib/db/campaigns";
import { normalizeTargetParty, type TargetParty } from "@/lib/workshop/kind";
import type { CampaignSummary } from "@/lib/campaign-types";

// The DB rim for workshops. Thin on purpose: a workshop is a campaigns row
// (docs/workshop-plan.md section 1), so everything a workshop CONTAINS is
// already served by the campaign-scoped modules. What is left, and all that
// lives here, is the row's own lifecycle.

// A workshop seats its creator as the DM and never narrates on its own.
// dmMode "human" is what gives the owner dm caps in src/lib/dm/viewer.ts:
// the secrets, real enemy numbers, an unfogged map and the adjudication
// console, which is exactly the view a person doing prep needs.
export function createWorkshop(
  ownerUserId: string,
  input: { title: string; description?: string; targetParty?: Partial<TargetParty> },
): Campaign {
  const targetParty = normalizeTargetParty(input.targetParty ?? {});
  return createCampaign(ownerUserId, {
    title: input.title,
    description: input.description ?? "",
    theme: "",
    // A workshop holds no players. The cap still has to be a legal number,
    // and one keeps any accidental lobby render honest.
    maxPlayers: 1,
    startingLevel: targetParty.level,
    difficulty: "normal",
    kind: "workshop",
    gameSettings: {
      dmMode: "human",
      // Nothing here should reach for a model on its own. Every generator in
      // the workshop is invoked by a button, never by a cadence.
      aiStorySetup: false,
      worldSimulation: false,
      holdSubmissions: false,
      targetParty,
    },
  });
}

// Workshops a user owns. Unlike campaigns this does not join
// campaign_members: a workshop is one person's prep space, and sharing it is
// Phase 10's job (export a file), not an invite code.
export function listWorkshopsForUser(userId: string): CampaignSummary[] {
  const rows = getDatabase()
    .prepare(
      `SELECT c.id FROM campaigns c
       WHERE c.kind = 'workshop' AND c.owner_user_id = ?
       ORDER BY c.updated_at DESC`,
    )
    .all(userId) as Array<{ id: string }>;
  return rows
    .map((row) => getCampaignForUser(row.id, userId))
    .filter((campaign): campaign is Campaign => Boolean(campaign));
}

// Membership plus ownership plus kind, in one call, so a route cannot
// accidentally accept a campaign id where it meant a workshop id.
export function getWorkshopForUser(workshopId: string, userId: string): Campaign | null {
  const campaign = getCampaignForUser(workshopId, userId);
  if (!campaign || campaign.kind !== "workshop" || campaign.ownerUserId !== userId) {
    return null;
  }
  return campaign;
}

export function renameWorkshop(workshopId: string, title: string, description: string) {
  getDatabase()
    .prepare(
      `UPDATE campaigns SET title = ?, description = ?, updated_at = ?
       WHERE id = ? AND kind = 'workshop'`,
    )
    .run(title, description, nowIso(), workshopId);
}

// The stand-in party every prep tool budgets against. Also mirrored onto
// starting_level, because the character builder and the encounter tools read
// that column directly and a workshop should not disagree with itself.
export function setWorkshopTargetParty(
  workshop: Campaign,
  raw: Partial<TargetParty>,
): TargetParty {
  const targetParty = normalizeTargetParty({ ...workshop.gameSettings.targetParty, ...raw });
  updateGameSettings(workshop.id, { targetParty });
  getDatabase()
    .prepare(`UPDATE campaigns SET starting_level = ?, updated_at = ? WHERE id = ?`)
    .run(targetParty.level, nowIso(), workshop.id);
  return targetParty;
}
