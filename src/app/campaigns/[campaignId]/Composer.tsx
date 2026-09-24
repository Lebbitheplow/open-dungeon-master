"use client";

import { Eye, EyeOff, Hand, Loader2, Send } from "lucide-react";
import { memo } from "react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { D20Spinner } from "@/components/ui/D20Spinner";
import { GameIcon } from "@/components/ui/GameIcon";
import { Switch } from "@/components/ui/Switch";
import { MODE_GLYPHS } from "@/app/campaigns/[campaignId]/sessionGlyphs";
import { useLingeringEncounter } from "@/app/campaigns/[campaignId]/useLingeringEncounter";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloorBanners } from "@/app/campaigns/[campaignId]/FloorBanners";
import { Hand as CombatHand } from "@/app/campaigns/[campaignId]/Hand";
import { NewAdventurerBanner } from "@/app/campaigns/[campaignId]/NewAdventurerBanner";
import {
  DirectorArmedBanner,
  DirectorPresets,
} from "@/app/campaigns/[campaignId]/DirectorPanel";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import { StoryNudge } from "@/app/campaigns/[campaignId]/StoryNudge";
import { SpeakerPicker } from "@/app/campaigns/[campaignId]/SpeakerPicker";
import type { CastMember } from "@/lib/dm/cast";
import type { Speaker } from "@/lib/dm/speech";
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
  members,
  floor,
  spotlighted,
  heldSpotlightNames,
  encounter,
  onReleaseFloor,
  joinBanner,
  leadPrivate,
  onLeadPrivateChange,
  speaker = null,
  onSpeakerChange,
  cast = [],
  onXCard,
  composerRef,
  trackAmmo,
  highlight = false,
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
  // For the pending cards: who holds their own rolls (shake to roll).
  members: CampaignState["members"];
  floor: Parameters<typeof FloorBanners>[0]["floor"];
  spotlighted: CampaignState["sheets"];
  heldSpotlightNames: string[];
  encounter: CampaignState["encounter"];
  onReleaseFloor: () => Promise<void>;
  joinBanner: { text: string; onWriteIntro: () => void; onDismiss: () => void } | null;
  leadPrivate: boolean;
  onLeadPrivateChange: (leadPrivate: boolean) => void;
  // The DM seat's speaker (docs/vtt-parity-implementation-plan.md 8.1).
  speaker?: Speaker | null;
  onSpeakerChange?: (speaker: Speaker | null) => void;
  cast?: CastMember[];
  // The X-card (docs/vtt-parity-implementation-plan.md 9.1): always
  // there when the table uses it, one press, no confirmation.
  onXCard?: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  // The ammunition variant rule, for the Hand's ranged cards.
  trackAmmo?: boolean;
  // A gold pulse on the frame: the board says it is this player's turn.
  highlight?: boolean;
  directorArm: CampaignState["directorArm"];
  // How overdue the DM's story capture is. Always "quiet" for anyone but the
  // DM, so this renders nothing at a player's table.
  storyCadence: BeatCadence;
  onCaptureStory: () => void;
  onSnoozeStory: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  // The Hand outlives the fight by one beat so its fold-away can play.
  const hand = useLingeringEncounter(encounter);
  return (
    <form onSubmit={onSubmit} className="glass session-desk cine-desk border-t border-stone-700/40 px-3 pb-3 pt-2.5">
      <div className="mx-auto max-w-3xl sm:px-3">
        {pendingRolls.map((pending) => (
          <PendingRollCard
            key={pending.id}
            campaignId={campaignId}
            pending={pending}
            sheets={sheets}
            members={members}
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
        {/* The Hand (docs/visual-overhaul-plan.md 5.2): a player's combat options
            as cards, only while a fight is on. It adds to everything below and
            takes nothing away: the pills, the box, the mic and the send button
            work exactly as they do without it. */}
        {!isDm && hand.encounter ? (
          <CombatHand
            campaignId={campaignId}
            sheets={sheets}
            meUserId={meUserId}
            encounter={hand.encounter}
            leaving={hand.leaving}
            floor={floor}
            inputBlocked={inputBlocked}
            blockedReason={placeholder}
            input={input}
            setInput={setInput}
            onKindChange={onKindChange}
            composerRef={composerRef}
            trackAmmo={trackAmmo}
          />
        ) : null}
        <div data-pill-group="" className="mb-2 flex flex-wrap items-center gap-1.5" data-tour="composer-modes">
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
                <button data-on={kind === option ? "" : undefined}
                  data-mode={option}
                  type="button"
                  onClick={() => onKindChange(option)}
                  className="session-mode"
                >
                  <GameIcon icon={{ kind: "glyph", key: MODE_GLYPHS[option] }} size="size-6" />
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
            <span className="session-status live-in">
              <D20Spinner className="size-4 shrink-0 text-amber-500" />
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
        {kind === "narrate" && isDm && onSpeakerChange ? (
          <SpeakerPicker
            speaker={speaker}
            onChange={onSpeakerChange}
            cast={cast}
            monsters={(encounter?.enemies ?? []).filter((enemy) => enemy.status === "alive").map((enemy) => ({ id: enemy.id, name: enemy.name }))}
          />
        ) : null}
        {kind === "lead" && steersStory ? (
          <div className="reveal mb-2 flex flex-wrap items-center gap-1.5">
            <DirectorPresets campaignId={campaignId} />
            <Tooltip
              content={
                leadPrivate
                  ? "Only the DM sees this. It steers the next turn and never enters the transcript."
                  : "The table sees this direction, and the DM acts on it now."
              }
            >
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-stone-300">
                {leadPrivate ? <EyeOff className="size-3.5 text-amber-300" /> : <Eye className="size-3.5 text-stone-500" />}
                Private
                <Switch on={leadPrivate} onChange={onLeadPrivateChange} label="Private" />
              </span>
            </Tooltip>
          </div>
        ) : null}
        <div
          data-tour="composer-input"
          className={
            "session-well texture-noise flex items-end gap-2 p-2" +
            (highlight ? " composer-pulse" : "")
          }
        >
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
          {onXCard ? (
            <Tooltip content="X-card: pause the table without saying why. Nobody is told who pressed it.">
              <button
                type="button"
                onClick={onXCard}
                aria-label="Raise the X-card"
                className={cn(ui.btnSmall, "session-deskbtn text-stone-400")}
              >
                <Hand className="size-4" />
              </button>
            </Tooltip>
          ) : null}
          <PushToTalk
            disabled={inputBlocked}
            onTranscript={(text) =>
              setInput((current) => (current ? `${current} ${text}` : text))
            }
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || inputBlocked}
            aria-label="Send"
            className={cn(ui.btnPrimary, "session-deskbtn cine-send")}
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        {error ? <p className="motion-shake mt-1.5 text-sm text-red-400">{error}</p> : null}
      </div>
    </form>
  );
}

// Memoized for the same reason as SidePanel: unchanged props while the DM
// streams narration into the message list.
export const Composer = memo(ComposerInner);
