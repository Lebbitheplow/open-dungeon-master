"use client";

import { Flag, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import type { CampaignDifficulty, CampaignStatus } from "@/lib/campaign-types";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import {
  ContentImportPicker,
  EMPTY_SELECTION,
  type ImportSelection,
} from "@/app/workshop/ContentImportPicker";
import type { GameSettings } from "@/lib/schemas/game-settings";
import type { StorySettings } from "@/lib/types";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { StoryAiPanel } from "@/app/campaigns/[campaignId]/StoryAiPanel";

// Settings tab of the session side panel. Two authorities meet here: campaign
// details belong to the lead (the PATCH /api/campaigns/[id] gate), while game
// settings and house rules follow story authority, which a human DM takes
// over from the lead. Everyone else sees a read-only summary.
//
// Two things that used to exist only in the lobby live here too, because a
// table in play has no lobby to go back to: bringing in more prep (story
// authority, the same gate as the import route), and ending the campaign
// (the owner or the DM, the same pair that could start it).
export function SessionSettings({
  campaign,
  isLead,
  steersStory,
  isDm,
  canEnd = false,
}: {
  campaign: {
    id: string;
    title: string;
    description: string;
    theme: string;
    maxPlayers: number;
    startingLevel: number;
    difficulty: CampaignDifficulty;
    status?: CampaignStatus;
    gameSettings?: GameSettings;
    // Scrubbed of API keys before it ever reaches a browser (publicCampaign);
    // the panel learns key existence from the story-settings route.
    settings?: StorySettings;
  };
  isLead: boolean;
  steersStory: boolean;
  isDm: boolean;
  // The campaign owner or the DM proper: who the PATCH route lets end it.
  canEnd?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [prep, setPrep] = useState<ImportSelection>(EMPTY_SELECTION);
  const ended = campaign.status === "ended";
  // Four related but separate jobs share this tab: the campaign's own
  // details, how the table plays, which AI it plays with, and its rules. The
  // row at the top names them and takes you to each, so nobody reads one
  // form looking for another.
  const stops = [
    { id: "ss-campaign", label: "Campaign", glyph: "tab-campaigns", shown: true },
    { id: "ss-prep", label: "Prep", glyph: "system-lore", shown: steersStory && !ended },
    { id: "ss-table", label: "Table settings", glyph: "tab-settings", shown: Boolean(campaign.gameSettings) },
    { id: "ss-ai", label: "Story AI", glyph: "ui-ai", shown: Boolean(campaign.settings) },
    { id: "ss-rules", label: "Rules", glyph: "system-rules", shown: Boolean(campaign.gameSettings) },
    { id: "ss-end", label: "End", glyph: "quest-done", shown: canEnd },
  ].filter((stop) => stop.shown);

  return (
    <div className="text-sm">
      <nav aria-label="Settings sections" className="stagger-pop mb-3 flex flex-wrap gap-1.5">
        {stops.map((stop) => (
          <button
            key={stop.id}
            type="button"
            onClick={() => {
              const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              document.getElementById(stop.id)?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
            }}
            className="motion-press inline-flex min-h-8 items-center gap-1.5 rounded-full border border-stone-700/70 py-0.5 pl-1 pr-2.5 text-xs text-stone-300 hover:border-amber-500/40 hover:text-amber-100"
          >
            <GameIcon icon={{ kind: "glyph", key: stop.glyph }} size="size-5" />
            {stop.label}
          </button>
        ))}
      </nav>
      <div id="ss-campaign" className="mb-3 scroll-mt-2 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-stone-400">Campaign</p>
          {isLead && !ended ? (
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
          <p className="reveal mt-1 line-clamp-2 text-xs text-stone-500">Setting: {campaign.theme}</p>
        ) : null}
      </div>

      {/* Every seat at the table reloads when this lands (the import
          route's prep_imported ping), so nothing here needs refreshing. */}
      {steersStory && !ended ? (
        <div id="ss-prep" data-setup-prep className="reveal mb-3 scroll-mt-2 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
          <p className="mb-1 text-xs font-medium text-stone-400">Bring in prep</p>
          <p className="mb-2 text-xs text-stone-500">
            Copy maps, NPCs, lore, encounters and more from a workshop or another campaign. The
            source keeps its own version; name clashes get numbered rather than overwritten.
          </p>
          <ContentImportPicker campaignId={campaign.id} selection={prep} onChange={setPrep} />
        </div>
      ) : null}

      {campaign.gameSettings ? (
        <div id="ss-table" className="scroll-mt-2">
          <GameSettingsPanel
            campaignId={campaign.id}
            settings={campaign.gameSettings}
            steersStory={steersStory}
            solo={campaign.maxPlayers <= 1}
          />
        </div>
      ) : null}

      {campaign.settings ? (
        <div id="ss-ai" className="scroll-mt-2">
          <StoryAiPanel
            campaignId={campaign.id}
            settings={campaign.settings}
            steersStory={steersStory}
          />
        </div>
      ) : null}

      {campaign.gameSettings ? (
        <div id="ss-rules" className="reveal mt-3 scroll-mt-2">
          <RulesPanel
            campaignId={campaign.id}
            settings={campaign.gameSettings}
            steersStory={steersStory}
            isDm={isDm}
          />
        </div>
      ) : null}

      {canEnd ? (
        <div id="ss-end" className="scroll-mt-2">
          <EndCampaign campaignId={campaign.id} title={campaign.title} ended={ended} />
        </div>
      ) : null}

      {editing ? <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

// Closing the book. The route writes each sheet's progress back to the
// library character it came from (level, XP, gold, gear, spells), refuses new turns, and
// shuts the room code; the transcript stays to be read. There is no way back
// to "active", so the confirm says so plainly.
function EndCampaign({ campaignId, title, ended }: { campaignId: string; title: string; ended: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (ended) {
    return (
      <div data-campaign-ended className="reveal mt-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-400">
          <Flag className="size-3.5" /> This campaign has ended
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Characters from a library took their progress home with them. The story stays here to
          read.
        </p>
      </div>
    );
  }

  async function end() {
    const ok = await appConfirm(
      `End "${title}" for everyone? Every character brought in from a library takes its level, XP, gold, gear and spells home, and the story stays here to read, but nobody can play on and the room code stops working. This cannot be undone.`,
      { title: "End the campaign", actionLabel: "End the campaign", tone: "danger" },
    );
    if (!ok) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ended" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not end the campaign.");
      }
      // On success the campaign_updated event flips every seat to ended.
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reveal mt-3 rounded-lg border border-red-900/50 bg-stone-950/40 p-3">
      <p className="mb-1 text-xs font-medium text-stone-400">End the campaign</p>
      <p className="mb-2 text-xs text-stone-500">
        When the story is done: library characters take their progress home, and the table
        closes. The transcript stays readable.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void end()}
          disabled={busy}
          data-end-campaign
          className={cn(ui.btnSmall, "text-red-300")}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Flag className="size-3.5" />}
          End the campaign
        </button>
        {error ? <span className="live-in text-xs text-red-300">{error}</span> : null}
      </div>
    </div>
  );
}
