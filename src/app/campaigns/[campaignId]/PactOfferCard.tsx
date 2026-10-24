"use client";

import { VenetianMask, X } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { CharacterPortrait } from "@/lib/ui";
import { characterPlaceholder } from "@/lib/placeholders";
import { KitButton } from "./PanelKit";
import { useSettlingCards } from "./AdvanceOfferCard";
import type { ItemProposal } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A pact's approach (issue 503 Phase 7) as an owner-only offer card in the
// chat column: who takes the character aside, their words, and the answers
// (join, play along, tell the party, refuse) for that character's player
// alone. Nobody else at the table is ever sent it (src/lib/table-delivery.ts);
// whoever runs the story sees whom it waits on and may withdraw it. It moves
// like the advance card it is built on (motion-app.css .advance-card), only
// from the server's offer and its settling. data-offer-card is what the
// apps look for to know the card is already on screen.

export function PactOffers({
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
        <PactOfferCard
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

function PactOfferCard({
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
  const [busy, setBusy] = useState("");
  const hintBase = useId();
  const from = proposal.from;
  const who = from?.name || "Someone";
  const face = characterPlaceholder({ race: from?.look.race || "human", class: from?.look.class || "fighter", gender: from?.look.gender || "" });
  const characterName = character?.name ?? "a character";
  const choices = proposal.choices ?? [];

  async function answer(choice: string) {
    setBusy(choice);
    try {
      const action = choice === "cancel" ? "cancel" : choice === "refuse" ? "decline" : "approve";
      const response = await fetch(`/api/campaigns/${campaignId}/item-proposals/${proposal.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "approve" ? { choice } : {}) }),
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
        aria-label={`${proposal.summary}, from ${who}`}
        data-offer-card={proposal.id}
        data-pact-offer={proposal.id}
        className={cn("advance-card panel rounded-xl px-3 py-2.5 text-xs", mine ? "ornate border-violet-400/50" : "border-violet-900/40")}
      >
        <div className="flex items-start gap-2.5">
          <CharacterPortrait url={from?.portraitUrl || undefined} fallback={face} alt={who} size="size-10" rounded="rounded-full" className="border-violet-400/40" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-violet-100">
              <VenetianMask className="size-3.5 shrink-0 text-violet-300" aria-hidden="true" />
              <span className="min-w-0">{proposal.summary}</span>
            </p>
            {proposal.reason ? <p className="mt-1 text-sm italic leading-snug text-stone-200">&ldquo;{proposal.reason}&rdquo;</p> : null}
            {mine ? (
              <p className="mt-1 text-[11px] text-stone-400">Only you see this, and only you answer. Nobody else at the table knows it was asked.</p>
            ) : null}
          </div>
        </div>
        {mine ? (
          <div role="group" aria-label={`Your answer for ${characterName}`} className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {choices.map((choice, index) => (
              <KitButton
                key={choice.id}
                className={cn("h-auto min-h-10 w-full flex-col items-start gap-0 whitespace-normal px-3 py-1.5 text-left", choice.id === "join" && "border-violet-400/60 text-violet-50")}
                onClick={() => void answer(choice.id)}
                disabled={Boolean(busy) || leaving}
                busy={busy === choice.id}
                aria-describedby={`${hintBase}-${index}`}
                data-pact-choice={choice.id}
              >
                <span className="text-[12px] font-medium">{choice.label}</span>
                <span id={`${hintBase}-${index}`} className="text-[11px] font-normal leading-snug opacity-80">
                  {choice.hint}
                </span>
              </KitButton>
            ))}
          </div>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
            <span className="text-[11px] italic text-stone-500">waiting on {characterName}&apos;s player</span>
            {steersStory ? (
              <KitButton className="min-h-10" onClick={() => void answer("cancel")} disabled={Boolean(busy) || leaving} busy={busy === "cancel"}>
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
