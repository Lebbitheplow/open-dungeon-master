"use client";

import { Heart, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CharacterPortrait } from "@/lib/ui";
import { characterPlaceholder, npcPlaceholder } from "@/lib/placeholders";
import { KitButton } from "./PanelKit";
import type { ItemProposal } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// An NPC's romantic advance (issue 501), as the offer card in the chat
// column: the suitor's face, their words, and Accept and Decline for the
// character's own player only. Everyone else sees whom it waits on; the lead
// may withdraw it, never answer it. It enters with a short fade and rise and
// settles with a collapse, and only from the server's offer: nothing here
// moves on a model's words (src/app/styles/motion-app.css .advance-card).

// How long a settled card stays to play its collapse (the CSS's 160ms, and
// a frame to spare).
const SETTLE_MS = 180;

// The owner-only offer cards (this one and a pact's approach,
// PactOfferCard.tsx) share their motion: a card that just left the list
// stays a beat to play its collapse.
export function useSettlingCards(proposals: ItemProposal[]): Array<{ proposal: ItemProposal; left: boolean }> {
  const [leaving, setLeaving] = useState<ItemProposal[]>([]);
  const previous = useRef<ItemProposal[]>(proposals);
  useEffect(() => {
    const ids = new Set(proposals.map((proposal) => proposal.id));
    const gone = previous.current.filter((proposal) => !ids.has(proposal.id));
    previous.current = proposals;
    if (!gone.length) {
      return;
    }
    setLeaving((current) => [...current, ...gone]);
    const timer = window.setTimeout(() => {
      setLeaving((current) => current.filter((entry) => !gone.some((left) => left.id === entry.id)));
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [proposals]);
  return [...proposals.map((proposal) => ({ proposal, left: false })), ...leaving.map((proposal) => ({ proposal, left: true }))];
}

export function AdvanceOffers({
  campaignId,
  proposals,
  sheets,
  meUserId,
  steersStory,
  onError,
}: {
  campaignId: string;
  proposals: ItemProposal[];
  sheets: CharacterSheet[];
  meUserId: string;
  steersStory: boolean;
  onError: (message: string) => void;
}) {
  const shown = useSettlingCards(proposals);
  if (!shown.length) {
    return null;
  }
  return (
    <>
      {shown.map(({ proposal, left }) => (
        <AdvanceOfferCard
          key={proposal.id}
          campaignId={campaignId}
          proposal={proposal}
          character={sheets.find((sheet) => sheet.id === proposal.characterId)}
          mine={proposal.userId === meUserId}
          steersStory={steersStory}
          leaving={left}
          onError={onError}
        />
      ))}
    </>
  );
}

function AdvanceOfferCard({
  campaignId,
  proposal,
  character,
  mine,
  steersStory,
  leaving,
  onError,
}: {
  campaignId: string;
  proposal: ItemProposal;
  character: CharacterSheet | undefined;
  mine: boolean;
  steersStory: boolean;
  leaving: boolean;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"" | "approve" | "decline" | "cancel">("");
  const suitor = proposal.advance?.suitor || "Someone";
  const look = proposal.advance?.look;
  const face = look?.race
    ? characterPlaceholder({ race: look.race, class: look.class, gender: look.gender })
    : npcPlaceholder(look?.role, suitor);
  const characterName = character?.name ?? "a character";

  async function answer(action: "approve" | "decline" | "cancel") {
    setBusy(action);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/item-proposals/${proposal.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        onError(String(data.error ?? "That did not work."));
      }
    } catch {
      onError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="advance-shell" data-leaving={leaving ? "" : undefined}>
      <section
        aria-label={`${suitor} makes a romantic advance toward ${characterName}`}
        data-advance-card={proposal.id}
        data-offer-card={proposal.id}
        className={cn(
          "advance-card panel rounded-xl px-3 py-2.5 text-xs",
          mine ? "ornate border-rose-400/45" : "border-rose-900/40",
        )}
      >
        <div className="flex items-start gap-2.5">
          <CharacterPortrait
            url={proposal.advance?.portraitUrl || undefined}
            fallback={face}
            alt={suitor}
            size="size-10"
            rounded="rounded-full"
            className="border-rose-400/40"
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-rose-100">
              <Heart className="size-3.5 shrink-0 text-rose-300" aria-hidden="true" />
              <span className="min-w-0">{proposal.summary}</span>
            </p>
            {proposal.reason ? (
              <p className="mt-1 text-sm italic leading-snug text-stone-200">&ldquo;{proposal.reason}&rdquo;</p>
            ) : null}
            {mine ? (
              <p className="mt-1 text-[11px] text-stone-400">
                Only you answer this. Say how {characterName} takes it in the scene too, if you like.
              </p>
            ) : null}
          </div>
        </div>
        {mine ? (
          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
            <KitButton
              tone="primary"
              className="min-h-10 px-4"
              onClick={() => void answer("approve")}
              disabled={Boolean(busy) || leaving}
              busy={busy === "approve"}
            >
              {busy === "approve" ? null : <Heart className="size-3.5" aria-hidden="true" />}
              Accept
            </KitButton>
            <KitButton
              className="min-h-10 px-4"
              onClick={() => void answer("decline")}
              disabled={Boolean(busy) || leaving}
              busy={busy === "decline"}
            >
              {busy === "decline" ? null : <X className="size-3.5" aria-hidden="true" />}
              Decline
            </KitButton>
          </div>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
            <span className="text-[11px] italic text-stone-500">waiting on {characterName}&apos;s player</span>
            {steersStory ? (
              <KitButton
                className="min-h-10"
                onClick={() => void answer("cancel")}
                disabled={Boolean(busy) || leaving}
                busy={busy === "cancel"}
              >
                {busy === "cancel" ? null : <X className="size-3.5" aria-hidden="true" />}
                Withdraw
              </KitButton>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
