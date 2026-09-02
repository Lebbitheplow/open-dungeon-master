"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import type { CampaignDifficulty } from "@/lib/campaign-types";
import type { GameSettings } from "@/lib/schemas/game-settings";
import type { StorySettings } from "@/lib/types";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { StoryAiPanel } from "@/app/campaigns/[campaignId]/StoryAiPanel";

// Setup tab of the session side panel. Two authorities meet here: campaign
// details belong to the lead (the PATCH /api/campaigns/[id] gate), while game
// settings and house rules follow story authority, which a human DM takes
// over from the lead. Everyone else sees a read-only summary.
export function SessionSettings({
  campaign,
  isLead,
  steersStory,
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
    // Scrubbed of API keys before it ever reaches a browser (publicCampaign);
    // the panel learns key existence from the story-settings route.
    settings?: StorySettings;
  };
  isLead: boolean;
  steersStory: boolean;
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
          steersStory={steersStory}
        />
      ) : null}

      {campaign.settings ? (
        <StoryAiPanel
          campaignId={campaign.id}
          settings={campaign.settings}
          steersStory={steersStory}
        />
      ) : null}

      {campaign.gameSettings ? (
        <div className="mt-3">
          <RulesPanel
            campaignId={campaign.id}
            settings={campaign.gameSettings}
            steersStory={steersStory}
          />
        </div>
      ) : null}

      {editing ? <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
