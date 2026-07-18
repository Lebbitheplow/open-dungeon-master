"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import type { CampaignDifficulty } from "@/lib/campaign-types";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";

// Setup tab of the session side panel: the lead edits campaign details and
// game settings mid-adventure; everyone else sees a read-only summary.
export function SessionSettings({
  campaign,
  isLead,
}: {
  campaign: {
    id: string;
    title: string;
    description: string;
    theme: string;
    maxPlayers: number;
    startingLevel: number;
    difficulty: CampaignDifficulty;
    gameSettings?: GameSettings;
  };
  isLead: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="text-sm">
      <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-stone-400">Campaign</p>
          {isLead ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Edit title, premise, setting, difficulty, and player slots"
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900"
            >
              <Pencil className="size-3" /> Edit details
            </button>
          ) : null}
        </div>
        <p className="truncate text-stone-200">{campaign.title}</p>
        <p className="mt-1 text-xs text-stone-500">
          Difficulty {campaign.difficulty} · Level {campaign.startingLevel} start · Up to{" "}
          {campaign.maxPlayers} players
        </p>
        {campaign.theme ? (
          <p className="mt-1 line-clamp-2 text-xs text-stone-500">Setting: {campaign.theme}</p>
        ) : null}
      </div>

      {campaign.gameSettings ? (
        <GameSettingsPanel
          campaignId={campaign.id}
          settings={campaign.gameSettings}
          isLead={isLead}
        />
      ) : null}

      {editing ? <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
