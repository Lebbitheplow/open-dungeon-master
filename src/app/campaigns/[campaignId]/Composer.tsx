"use client";

import { Eye, EyeOff, Loader2, Send } from "lucide-react";
import { memo } from "react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { D20Spinner } from "@/components/ui/D20Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloorBanners } from "@/app/campaigns/[campaignId]/FloorBanners";
import { NewAdventurerBanner } from "@/app/campaigns/[campaignId]/NewAdventurerBanner";
import {
  DirectorArmedBanner,
  DirectorPresets,
} from "@/app/campaigns/[campaignId]/DirectorPanel";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import { StoryNudge } from "@/app/campaigns/[campaignId]/StoryNudge";
import type { BeatCadence } from "@/lib/dm/beat-cadence";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

import type { InputKind } from "@/lib/campaign-types";

export type { InputKind };

const KIND_TIPS: Record<InputKind, string> = {
  do: "Act in the world. The DM narrates what happens.",
  say: "Speak in character. Sent as dialogue in quotes.",
  ooc: "Table talk. The DM does not respond, and it works even when the floor is locked.",
  lead: "Party lead only. Send the DM an authoritative story direction.",
  narrate: "Dungeon Master only. Write the passage the table reads.",
};

// The action composer at the bottom of the game chat: pending-roll cards,
// floor banners, the join notice, kind pills and the input row.
//
// Asking the DM a question is NOT a mode here. It lives entirely in the Ask
// strip just above this composer (AskPanel.tsx), which has its own box. An
// "Ask" pill in this row would be the same feature offered twice, inches
// apart, which is exactly what it used to be.
function ComposerInner({
  campaignId,
  sheets,
  meUserId,
  steersStory,
  isDm,
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
  leadPrivate,
  onLeadPrivateChange,
  composerRef,
  directorArm,
  storyCadence,
  onCaptureStory,
  onSnoozeStory,
  onSubmit,
}: {
  campaignId: string;
  sheets: CampaignState["sheets"];
  meUserId: string;
  steersStory: boolean;
  // The DM seat: narrates instead of acting, and never runs a character.
  isDm: boolean;
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
  leadPrivate: boolean;
  onLeadPrivateChange: (leadPrivate: boolean) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  directorArm: CampaignState["directorArm"];
  // How overdue the DM's story capture is. Always "quiet" for anyone but the
  // DM, so this renders nothing at a player's table.
  storyCadence: BeatCadence;
  onCaptureStory: () => void;
  onSnoozeStory: () => void;
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
            steersStory={steersStory}
          />
        ))}
        <FloorBanners
          campaignId={campaignId}
          floor={floor}
          spotlighted={spotlighted}
          heldSpotlightNames={heldSpotlightNames}
          encounter={encounter}
          steersStory={steersStory}
          meUserId={meUserId}
          onRelease={onReleaseFloor}
        />
        <DirectorArmedBanner campaignId={campaignId} steersStory={steersStory} armed={directorArm} />
        <StoryNudge
          cadence={storyCadence}
          onCapture={onCaptureStory}
          onSnooze={onSnoozeStory}
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
          {/* The DM authors and talks out of character; they have no
              character to act or speak as, and the story directions exist to
              steer an AI narrator they have replaced. */}
          {(isDm
            ? (["narrate", "ooc"] as const)
            : ([
                "do",
                "say",
                "ooc",
                ...(steersStory ? (["lead"] as const) : []),
              ] as const)
          ).map(
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
              <D20Spinner className="size-3.5 shrink-0 text-amber-600" />
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
        {/*
          Direct's own controls, and the reason there is no second row of
          director buttons above this composer: a canned event to arm, and the
          choice of whether the direction is something the table reads.
        */}
        {kind === "lead" && steersStory ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <DirectorPresets campaignId={campaignId} />
            <Tooltip
              content={
                leadPrivate
                  ? "Only the DM sees this. It steers the next turn and never enters the transcript."
                  : "The table sees this direction, and the DM acts on it now."
              }
            >
              <button
                type="button"
                role="switch"
                aria-checked={leadPrivate}
                onClick={() => onLeadPrivateChange(!leadPrivate)}
                className={cn(
                  ui.btnSmall,
                  "ml-auto px-2 py-1 text-[11px]",
                  leadPrivate && "border-amber-500/50 bg-amber-500/10 text-amber-100",
                )}
              >
                {leadPrivate ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                Private
              </button>
            </Tooltip>
          </div>
        ) : null}
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

// Memoized for the same reason as SidePanel: unchanged props while the DM
// streams narration into the message list.
export const Composer = memo(ComposerInner);
