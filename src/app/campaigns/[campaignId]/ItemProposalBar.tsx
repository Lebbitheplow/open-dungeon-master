"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { GameIcon } from "@/components/ui/GameIcon";
import { KitButton, PanelError } from "./PanelKit";
import type { ItemProposal } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Pending DM item/gold offers (inventoryApprovals): the owning player gets
// Accept/Decline, everyone else sees a passive chip, the lead may withdraw.
// Driven by item_proposal_added/item_proposal_resolved on the stream.
export function ItemProposalBar({
  campaignId,
  proposals,
  sheets,
  meUserId,
  steersStory,
}: {
  campaignId: string;
  proposals: ItemProposal[];
  sheets: CharacterSheet[];
  meUserId: string;
  steersStory: boolean;
}) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  if (!proposals.length) {
    return null;
  }

  async function resolve(proposalId: string, action: "approve" | "decline" | "cancel") {
    setBusyId(proposalId);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/item-proposals/${proposalId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(String(data.error ?? "That did not work."));
      }
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="stagger mx-3 mb-2 space-y-1.5">
      {error ? <PanelError>{error}</PanelError> : null}
      {proposals.map((proposal) => {
        const trade = proposal.toolName === "trade";
        // A trade is "mine" to answer when it is made to my character; the
        // offerer may only withdraw it (docs/vtt-parity-implementation-plan.md 11.2).
        const counterparty = trade ? sheets.find((sheet) => sheet.id === proposal.toCharacterId) : null;
        const proposer = proposal.userId === meUserId;
        const mine = trade ? counterparty?.userId === meUserId : proposal.userId === meUserId;
        const characterName =
          (trade ? counterparty?.name : sheets.find((sheet) => sheet.id === proposal.characterId)?.name) ?? "a character";
        const busy = busyId === proposal.id;
        return (
          <div
            key={proposal.id}
            className={cn(
              "panel live-in flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs",
              mine ? "ornate border-amber-500/50 text-amber-100" : "text-stone-400",
            )}
          >
            <GameIcon icon={{ kind: "glyph", key: trade ? "tab-trade" : "tab-loot" }} size="size-6" className="shrink-0" />
            <span className="min-w-0 flex-1">
              {proposal.summary}
              {proposal.reason ? (
                <span className="text-stone-500"> ({proposal.reason})</span>
              ) : null}
            </span>
            {trade && proposer && !mine && !steersStory ? (
              <KitButton onClick={() => resolve(proposal.id, "cancel")} disabled={busy} busy={busy}>
                {busy ? null : <X className="size-3.5" />} Withdraw
              </KitButton>
            ) : mine || steersStory ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <KitButton tone="primary" onClick={() => resolve(proposal.id, "approve")} disabled={busy} busy={busy}>
                  {busy ? null : <Check className="size-3.5" />}
                  Accept
                </KitButton>
                <KitButton onClick={() => resolve(proposal.id, mine ? "decline" : "cancel")} disabled={busy}>
                  <X className="size-3.5" /> {mine ? "Decline" : "Withdraw"}
                </KitButton>
              </span>
            ) : (
              <span className="shrink-0 text-[11px] italic text-stone-500">
                waiting on {characterName}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
