"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Dialog } from "@/components/ui/Dialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { navigateTo } from "@/lib/navigation";
import { ui } from "@/lib/ui";

// The detail page's one primary action (docs/visual-overhaul-plan.md 8c.2):
// take this library character to a table. It lists the campaigns the player
// belongs to and sends the same request the campaign's own "pick from your
// library" page sends, so the campaign's multi-character setting and the
// server's lobby/gameplay rules are the ones that answer.

type CampaignRow = {
  id: string;
  title: string;
  status?: string;
  kind?: string;
  isWorkshop?: boolean;
};

export function UseInCampaignDialog({
  characterId,
  characterName,
  seatedIn,
  onClose,
}: {
  characterId: string;
  characterName: string;
  // Campaign ids that already hold a copy of this character.
  seatedIn: string[];
  onClose: () => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState<{ campaignId: string; text: string; taken: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/campaigns")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const rows: CampaignRow[] = data?.campaigns ?? [];
        setCampaigns(
          rows.filter((row) => row.status !== "ended" && row.kind !== "workshop" && !row.isWorkshop),
        );
      })
      .catch(() => {
        if (!cancelled) setCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function seat(campaign: CampaignRow) {
    setBusyId(campaign.id);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryCharacterId: characterId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError({
          campaignId: campaign.id,
          text: data.error || "Could not bring the character to that table.",
          taken: response.status === 409,
        });
        return;
      }
      navigateTo(`/campaigns/${campaign.id}`);
    } catch {
      setError({ campaignId: campaign.id, text: "Could not reach the server.", taken: false });
    } finally {
      setBusyId("");
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Use ${characterName} in a campaign`}
      icon={<GameIcon icon={{ kind: "glyph", key: "tab-campaigns" }} size="size-7" />}
      width="w-[min(92vw,30rem)]"
    >
      <p className="mb-3 text-xs leading-5 text-stone-400">
        The table gets its own copy of the sheet, adapted to its starting level. Your library keeps
        this one as it is.
      </p>
      {campaigns === null ? (
        <div className="skeleton-block h-24 rounded-xl" aria-label="Loading your campaigns" />
      ) : campaigns.length === 0 ? (
        <EmptyState
          art="map"
          size="sm"
          title="No tables to bring them to yet."
          hint="Start a campaign or join one with a room code, then come back."
          action={
            <Link href="/" className={ui.btnSecondary}>
              To your campaigns
            </Link>
          }
        />
      ) : (
        <ul className="stagger space-y-2">
          {campaigns.map((campaign) => {
            const seated = seatedIn.includes(campaign.id);
            return (
              <li key={campaign.id} className="plate-row">
                <GameIcon icon={{ kind: "glyph", key: "tab-campaigns" }} size="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm tracking-wide text-amber-100">{campaign.title}</span>
                  <span className="block text-[11px] text-stone-500">
                    {seated ? "Already at this table" : campaign.status === "lobby" ? "In the lobby" : "In play"}
                  </span>
                </span>
                {seated ? (
                  <Link href={`/campaigns/${campaign.id}`} className={ui.btnSmall}>
                    Open
                  </Link>
                ) : (
                  <button type="button" disabled={Boolean(busyId)} onClick={() => void seat(campaign)} className={ui.btnSmall}>
                    {busyId === campaign.id ? <Loader2 className="size-3.5 animate-spin" /> : null} Take a seat
                  </button>
                )}
                {error?.campaignId === campaign.id ? (
                  <p role="alert" className="motion-shake w-full text-xs text-red-400">
                    {error.text}{" "}
                    {error.taken ? (
                      <Link href={`/campaigns/${campaign.id}/character?mode=replace`} className="text-amber-200 underline underline-offset-2">
                        Swap characters in its lobby
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
