"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { EventLog } from "@/app/campaigns/[campaignId]/EventLog";
import { MapPanel } from "@/app/campaigns/[campaignId]/MapPanel";
import { PartyPanel } from "@/app/campaigns/[campaignId]/PartyPanel";
import type {
  AuditEntry,
  CampaignLocation,
} from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Tab = "party" | "map" | "log";

// The session's right rail: party sheets, the current area map, and the
// stat-change log, tabbed to keep the rail narrow.
export function SidePanel({
  campaignId,
  sheets,
  meUserId,
  isLead,
  leadUserId,
  canTransferLead,
  onAdjustHp,
  spotlightUserIds,
  auditLog,
  locations,
  mapsEnabled,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  meUserId: string;
  isLead: boolean;
  leadUserId: string;
  canTransferLead: boolean;
  onAdjustHp: (delta: number) => void;
  spotlightUserIds: string[];
  auditLog: AuditEntry[];
  locations: CampaignLocation[];
  mapsEnabled: boolean;
}) {
  const [tab, setTab] = useState<Tab>("party");
  const tabs: Array<[Tab, string]> = [
    ["party", "Party"],
    ...(mapsEnabled ? ([["map", "Map"]] as Array<[Tab, string]>) : []),
    ["log", "Log"],
  ];

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-stone-800 lg:flex">
      <div className="flex border-b border-stone-800">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "flex-1 py-2 text-xs font-medium uppercase tracking-wide",
              tab === value
                ? "border-b-2 border-amber-600 text-amber-300"
                : "text-stone-500 hover:text-stone-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "party" ? (
          <PartyPanel
            sheets={sheets}
            meUserId={meUserId}
            onAdjustHp={onAdjustHp}
            spotlightUserIds={spotlightUserIds}
            isLead={isLead}
            leadUserId={leadUserId}
            canTransferLead={canTransferLead}
            embedded
          />
        ) : tab === "map" ? (
          <MapPanel campaignId={campaignId} locations={locations} isLead={isLead} />
        ) : (
          <EventLog auditLog={auditLog} sheets={sheets} />
        )}
      </div>
    </aside>
  );
}
