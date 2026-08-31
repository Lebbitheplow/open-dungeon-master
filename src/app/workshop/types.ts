import type { CampaignSummary } from "@/lib/campaign-types";
import type { GameSettings } from "@/lib/schemas/game-settings";
import type { ImportKind } from "@/lib/workshop/import";
import type { CampaignKind } from "@/lib/workshop/kind";

// What /api/workshops hands the client. A workshop is a campaigns row, so
// this is the campaign projection minus the story secrets, exactly as
// publicCampaign returns it; naming it separately keeps the workshop pages
// from reaching for campaign fields that mean nothing during prep.
export type WorkshopSummary = CampaignSummary & {
  gameSettings: GameSettings;
  // How much of each importable kind this workshop holds. Served by
  // /api/workshops so a picker never has to fetch per workshop.
  contents: Record<ImportKind, number>;
};

// What /api/import-sources hands the client: a workshop or a campaign this
// user may copy prep out of. Kept here rather than imported from
// src/lib/db/import-sources.ts so a client component never names a module
// that opens the database.
export type ImportSourceSummary = {
  id: string;
  title: string;
  kind: CampaignKind;
  updatedAt: string;
  contents: Record<ImportKind, number>;
};
