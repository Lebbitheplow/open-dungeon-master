"use client";

import { Dices, Loader2, Send } from "lucide-react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloorBanners } from "@/app/campaigns/[campaignId]/FloorBanners";
import { NewAdventurerBanner } from "@/app/campaigns/[campaignId]/NewAdventurerBanner";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

export type InputKind = "do" | "say" | "ooc" | "lead";

const KIND_TIPS: Record<InputKind, string> = {
  do: "Act in the world. The DM narrates what happens.",
  say: "Speak in character. Sent as dialogue in quotes.",
  ooc: "Table talk. The DM does not respond, and it works even when the floor is locked.",
  lead: "Party lead only. Send the DM an authoritative story direction.",
};

// The action composer at the bottom of the game chat: pending-roll cards,
// floor banners, the join notice, kind pills and the input row.
export function Composer({
  campaignId,
  sheets,
  meUserId,
  isLead,
  kind,
  onKindChange,
  input,
  setInput,
  sending,
  error,
  inputBlocked,
  placeholder,
  dmStatus,
  pendingRolls,
  floor,
  spotlighted,
  heldSpotlightNames,
  encounter,
  onReleaseFloor,
  joinBanner,
  composerRef,
  onSubmit,
}: {
  campaignId: string;
  sheets: CampaignState["sheets"];
  meUserId: string;
  isLead: boolean;
  kind: InputKind;
  onKindChange: (kind: InputKind) => void;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  sending: boolean;
  error: string;
  inputBlocked: boolean;
  placeholder: string;
  dmStatus: CampaignState["dmStatus"];
  pendingRolls: CampaignState["pendingRolls"];
  floor: Parameters<typeof FloorBanners>[0]["floor"];
  spotlighted: CampaignState["sheets"];
  heldSpotlightNames: string[];
  encounter: CampaignState["encounter"];
  onReleaseFloor: () => Promise<void>;
  joinBanner: { text: string; onWriteIntro: () => void; onDismiss: () => void } | null;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="glass border-t border-stone-700/40 px-3 pb-3 pt-2.5">
      <div className="mx-auto max-w-3xl sm:px-3">
        {pendingRolls.map((pending) => (
          <PendingRollCard
            key={pending.id}
            campaignId={campaignId}
            pending={pending}
            sheets={sheets}
            meUserId={meUserId}
            isLead={isLead}
          />
        ))}
        <FloorBanners
          floor={floor}
          spotlighted={spotlighted}
          heldSpotlightNames={heldSpotlightNames}
          encounter={encounter}
          isLead={isLead}
          onRelease={onReleaseFloor}
        />
        {joinBanner ? (
          <NewAdventurerBanner
            campaignId={campaignId}
            text={joinBanner.text}
            onWriteIntro={joinBanner.onWriteIntro}
            onDismiss={joinBanner.onDismiss}
          />
        ) : null}
        <div className="mb-2 flex gap-1.5">
          {(["do", "say", "ooc", ...(isLead ? (["lead"] as const) : [])] as const).map(
            (option) => (
              <Tooltip key={option} content={KIND_TIPS[option]}>
                <button
                  type="button"
                  onClick={() => onKindChange(option)}
                  className={cn(
                    "rounded-full px-3.5 py-2 text-xs font-medium transition-all duration-150 ease-snap active:scale-95 sm:px-3 sm:py-1",
                    kind === option
                      ? option === "lead"
                        ? "bg-gradient-to-b from-ember-400 to-ember-600 text-stone-950 shadow-glow-ember"
                        : "bg-gradient-to-b from-amber-100 to-amber-400 text-amber-950 shadow-glow-gold"
                      : "bg-stone-900/80 text-stone-400 hover:bg-stone-800 hover:text-stone-200",
                  )}
                >
                  {option === "do"
                    ? "Do"
                    : option === "say"
                      ? "Say"
                      : option === "ooc"
                        ? "OOC"
                        : "Direct"}
                </button>
              </Tooltip>
            ),
          )}
          {dmStatus !== "idle" ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-stone-500">
              <Dices className="size-3.5 animate-bounce text-amber-600" />
              {dmStatus === "rolling"
                ? "DM rolling dice..."
                : dmStatus === "awaiting_rolls"
                  ? "Waiting on real dice..."
                  : dmStatus === "narrating"
                    ? "DM narrating..."
                    : dmStatus === "writing_chapter"
                      ? "DM writing the chapter..."
                      : dmStatus === "plotting_arc"
                        ? "DM plotting the story arc..."
                        : "DM at work..."}
            </span>
          ) : null}
        </div>
        <div className="texture-noise flex items-end gap-2 rounded-2xl border border-stone-700/70 bg-stone-950/90 p-2 shadow-elev-1 transition-[border-color,box-shadow] duration-200 focus-within:border-amber-400/60 focus-within:shadow-[0_0_0_3px_rgba(212,171,58,0.1),0_2px_12px_rgba(4,2,12,0.5)]">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit(event);
              }
            }}
            rows={2}
            disabled={inputBlocked}
            placeholder={placeholder}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-stone-200 outline-none disabled:opacity-50"
          />
          <PushToTalk
            disabled={inputBlocked}
            onTranscript={(text) =>
              setInput((current) => (current ? `${current} ${text}` : text))
            }
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || inputBlocked}
            className="rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 p-2.5 text-amber-950 shadow-[0_1px_0_rgba(253,247,231,0.6)_inset] transition-all duration-150 ease-snap hover:-translate-y-px hover:shadow-glow-gold-strong active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        {error ? <p className="mt-1.5 text-sm text-red-400">{error}</p> : null}
      </div>
    </form>
  );
}
