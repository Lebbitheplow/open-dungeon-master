"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import { ItemProposalBar } from "@/app/campaigns/[campaignId]/ItemProposalBar";
import { UtilityCallStrip } from "@/app/campaigns/[campaignId]/UtilityCallStrip";
import { AskDock } from "@/app/campaigns/[campaignId]/AskPanel";
import { DmCoverNotice } from "@/app/campaigns/[campaignId]/DmDelegationPanel";
import type { NarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CampaignMessage } from "@/lib/db/messages";

// The story column: the transcript with every message action wired to its
// route, then the strips that sit directly above the composer (item
// proposals, the Ask dock, in-flight utility calls, the assisted-mode
// notice), and finally whatever the caller puts in the composer slot. The
// message handlers live here rather than in SessionView because they are
// nothing but fetches against the message routes, and SessionView is about
// what the whole table is doing.
export function SessionChatColumn({
  state,
  campaignId,
  meUserId,
  steersStory,
  narration,
  visible,
  askOpen,
  onAskOpenChange,
  refreshAsks,
  refreshFacts,
  onError,
  onLoreCheck,
  onRenarrate,
  onPinned,
  children,
}: {
  state: CampaignState;
  campaignId: string;
  meUserId: string;
  steersStory: boolean;
  narration: NarrationAudio;
  // Below lg only one column shows at a time; from lg up both always do.
  visible: boolean;
  askOpen: boolean;
  onAskOpenChange: (open: boolean) => void;
  refreshAsks: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  onError: (message: string) => void;
  onLoreCheck: (message: CampaignMessage, selection: string) => void;
  onRenarrate: (message: CampaignMessage) => void;
  // A memory pin landed, so the pins panel should refetch.
  onPinned: () => void;
  children: ReactNode;
}) {
  const { campaign, messages, rolls, sheets, locations, dmStatus, dmDraft, utilityCalls } = state;
  const ttsEnabled = Boolean(campaign?.gameSettings?.ttsEnabled);
  // Ask already reports its own progress inside the strip, naming the
  // question being answered, so repeating it in the strip is the same news
  // twice.
  const visibleUtilityCalls = utilityCalls.filter((call) => call.kind !== "ask");

  return (
    <div className={cn("min-w-0 flex-1 flex-col", visible ? "flex" : "hidden lg:flex")}>
      <MessageList
        messages={messages}
        campaignId={campaignId}
        canRetryTurn={steersStory}
        canIllustrate={steersStory}
        rolls={rolls}
        sheets={sheets}
        members={state.members}
        locations={locations}
        dmStatus={dmStatus}
        dmDraft={dmDraft}
        mediaStatus={state.mediaStatus}
        onReplayAudio={
          ttsEnabled
            ? async (messageId) => {
                // The click doubles as the gesture that gets us past the
                // browser's autoplay block.
                narration.unlock();
                const known = state.narrationAudio[messageId];
                if (known) {
                  narration.play(messageId, known);
                  return null;
                }
                // Never voiced: render it now, then play the same take.
                // Passages from before TTS was switched on, and ones whose
                // render failed, are otherwise silent forever.
                const response = await fetch(
                  `/api/campaigns/${campaignId}/messages/${messageId}/narrate`,
                  { method: "POST" },
                );
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  return data.error || "Could not read that passage aloud.";
                }
                const data = await response.json();
                narration.play(messageId, data.url);
                return null;
              }
            : undefined
        }
        onLoreCheck={(message) => {
          // Whatever text was selected when the flag was raised, captured at
          // click, before the dialog steals focus.
          const selection = window.getSelection()?.toString().trim() ?? "";
          onLoreCheck(message, selection.length > 3 ? selection : "");
        }}
        onRenarrate={steersStory ? onRenarrate : undefined}
        onContinueScene={
          steersStory
            ? async (message) => {
                // No dialog: a continue takes no options, so the button is
                // the whole interaction. The server publishes
                // message_updated with the extended prose.
                const response = await fetch(
                  `/api/campaigns/${campaignId}/messages/${message.id}/continue`,
                  { method: "POST" },
                );
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  onError(data.error || "Could not continue the scene.");
                }
              }
            : undefined
        }
        onSelectVariant={
          steersStory
            ? async (message, index) => {
                // The server publishes message_updated, so every player's
                // chat swaps to the picked take.
                const response = await fetch(
                  `/api/campaigns/${campaignId}/messages/${message.id}/renarrate`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "select", index }),
                  },
                );
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  onError(data.error || "Could not switch takes.");
                }
              }
            : undefined
        }
        onEditSave={
          steersStory
            ? async (message, content) => {
                // Returns the server's refusal so the editor can show it
                // inline; the roll-marker rule lives server-side.
                const response = await fetch(
                  `/api/campaigns/${campaignId}/messages/${message.id}/edit`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content }),
                  },
                );
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  return data.error || "Could not save that edit.";
                }
                return null;
              }
            : undefined
        }
        onPinMemory={async (message) => {
          // NE-P's isFullMessage distinction: a selection is an excerpt, no
          // selection pins the whole narration. Any member may pin, unlike
          // onPinCanon (facts), which is lead-only canon.
          const selection = window.getSelection()?.toString().trim() ?? "";
          const isFullMessage = selection.length <= 3;
          const response = await fetch(`/api/campaigns/${campaignId}/pins`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageId: message.id,
              text: isFullMessage ? message.content : selection,
              isFullMessage,
            }),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            onError(data.error || "Could not pin that.");
            return;
          }
          onPinned();
        }}
        onPinCanon={
          steersStory
            ? async (message) => {
                // The lead's selected text inside the message wins;
                // otherwise the passage's opening is pinned.
                const selection = window.getSelection()?.toString().trim() ?? "";
                const excerpt = (selection.length > 3 ? selection : message.content)
                  .trim()
                  .slice(0, 300);
                if (!excerpt) {
                  return;
                }
                await fetch(`/api/campaigns/${campaignId}/facts`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    category: "lore",
                    subject: "",
                    fact: excerpt,
                    sourceSeq: message.seq,
                  }),
                });
                await refreshFacts();
              }
            : undefined
        }
      />

      <ItemProposalBar
        campaignId={campaignId}
        proposals={state.itemProposals}
        sheets={sheets}
        meUserId={meUserId}
        steersStory={steersStory}
      />

      <AskDock
        campaignId={campaignId}
        asks={state.asks}
        meUserId={meUserId}
        loaded={state.asksLoaded}
        open={askOpen}
        onOpenChange={onAskOpenChange}
        onAsked={refreshAsks}
      />

      {/* Directly above the composer, so the answer to "why is nothing
          happening" sits where the player is already looking. */}
      <UtilityCallStrip calls={visibleUtilityCalls} />

      {/* Assisted mode: the DM stepped away and the AI is answering for
          them. Shown to every seat, because a player owed an answer is owed
          the knowledge of who is giving it. */}
      <DmCoverNotice cover={campaign?.dmCover ?? null} />

      {children}
    </div>
  );
}
