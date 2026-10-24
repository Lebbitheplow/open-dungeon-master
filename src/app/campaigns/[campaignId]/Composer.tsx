"use client";

import { Eye, EyeOff, Hand, Loader2, Send } from "lucide-react";
import { memo, useId, type ReactNode } from "react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { Switch } from "@/components/ui/Switch";
import { MODE_GLYPHS } from "@/app/campaigns/[campaignId]/sessionGlyphs";
import { useLingeringEncounter } from "@/app/campaigns/[campaignId]/useLingeringEncounter";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloorBanners } from "@/app/campaigns/[campaignId]/FloorBanners";
import { SideNotice } from "@/app/campaigns/[campaignId]/SideBadge";
import { TableWaitBanner } from "@/app/campaigns/[campaignId]/TableWaitBanner";
import { Hand as CombatHand } from "@/app/campaigns/[campaignId]/Hand";
import { MonsterHand } from "@/app/campaigns/[campaignId]/MonsterHand";
import { NewAdventurerBanner } from "@/app/campaigns/[campaignId]/NewAdventurerBanner";
import {
  DirectorArmedBanner,
  DirectorPresets,
} from "@/app/campaigns/[campaignId]/DirectorPanel";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { DmStatusLine } from "@/app/campaigns/[campaignId]/DmStatusLine";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import { StoryNudge } from "@/app/campaigns/[campaignId]/StoryNudge";
import { SpeakerPicker } from "@/app/campaigns/[campaignId]/SpeakerPicker";
import type { CastMember } from "@/lib/dm/cast";
import type { Speaker } from "@/lib/dm/speech";
import type { BeatCadence } from "@/lib/dm/beat-cadence";
import type { TargetEdge } from "@/lib/battlemap/view-tactics";
import type { PlayerMapView } from "@/lib/battlemap/view-types";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

import type { InputKind } from "@/lib/campaign-types";
import { LengthNote } from "@/components/ui/LengthNote";
import { composerLimit, textLength } from "@/lib/text-limits";

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
  activeSheetId,
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
  dmJob,
  pendingRolls,
  members,
  floor,
  tableWait,
  spotlighted,
  heldSpotlightNames,
  encounter,
  onReleaseFloor,
  joinBanner,
  notice,
  leadPrivate,
  onLeadPrivateChange,
  speaker = null,
  onSpeakerChange,
  cast = [],
  onXCard,
  composerRef,
  trackAmmo,
  romanceCue = true,
  edges,
  drops,
  mounts,
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
  activeSheetId?: string;
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
  dmJob: CampaignState["dmJob"];
  pendingRolls: CampaignState["pendingRolls"];
  // For the pending cards: who holds their own rolls (shake to roll).
  members: CampaignState["members"];
  floor: Parameters<typeof FloorBanners>[0]["floor"];
  tableWait?: CampaignState["tableWait"];
  spotlighted: CampaignState["sheets"];
  heldSpotlightNames: string[];
  encounter: CampaignState["encounter"];
  onReleaseFloor: () => Promise<void>;
  joinBanner: { text: string; onWriteIntro: () => void; onDismiss: () => void } | null;
  // One more banner in the stack, owned by the caller (narration that was
  // not read aloud). Memoized there, so this component's memo still holds.
  notice?: ReactNode;
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
  // The Director's Romance cue is offered (issue 501).
  romanceCue?: boolean;
  // The board's cover and flanking from this character to each enemy, for
  // the Hand's hit preview (src/lib/battlemap/view-tactics.ts).
  edges?: Record<string, TargetEdge>;
  // What lies on the board and who rides what, for the Hand's gear cards.
  drops?: PlayerMapView["drops"];
  mounts?: PlayerMapView["mounts"];
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
  // Each mode's limit, counted as its route counts it. The count shows once
  // a draft nears it, and a draft over it is held here, marked, rather than
  // refused after the send or cut short on the server (issue 207).
  const noteId = useId();
  const maxChars = composerLimit(kind, leadPrivate);
  const length = textLength(input);
  const tooLong = length > maxChars;
  return (
    <form onSubmit={onSubmit} className="glass session-desk cine-desk border-t border-stone-700/40 px-3 pb-3 pt-2.5">
      <div className="session-desk-body mx-auto max-w-3xl sm:px-3">
        <div className="session-compose-notices">
        {pendingRolls.map((pending) => (
          <PendingRollCard
            // Inspiration rewrites the parked roll's dice: the card starts
            // over with the new faces (and files in again).
            key={`${pending.id}:${pending.expression}`}
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
        <SideNotice encounter={encounter ?? null} sheets={sheets} meUserId={meUserId} />
        {floor.mode === "open" && dmStatus === "idle" ? (
          <TableWaitBanner
            campaignId={campaignId}
            wait={tableWait ?? null}
            meUserId={meUserId}
            steersStory={steersStory}
            onGoOn={onReleaseFloor}
          />
        ) : null}
        <DirectorArmedBanner campaignId={campaignId} steersStory={steersStory} armed={directorArm} />
        <StoryNudge
          cadence={storyCadence}
          onCapture={onCaptureStory}
          onSnooze={onSnoozeStory}
        />
        {notice}
        {joinBanner ? (
          <NewAdventurerBanner
            campaignId={campaignId}
            text={joinBanner.text}
            onWriteIntro={joinBanner.onWriteIntro}
            onDismiss={joinBanner.onDismiss}
          />
        ) : null}
        </div>
        <div className="session-compose-hand">
        {/* The Hand (docs/visual-overhaul-plan.md 5.2): a player's combat options
            as cards, only while a fight is on. It adds to everything below and
            takes nothing away: the pills, the box, the mic and the send button
            work exactly as they do without it. */}
        {/* The DM's hand (issue #108): the monsters' attacks and abilities
            as the same cards, played through the console's invoke route. */}
        {isDm && hand.encounter ? (
          <MonsterHand
            campaignId={campaignId}
            sheets={sheets}
            encounter={hand.encounter}
            leaving={hand.leaving}
          />
        ) : null}
        {!isDm && hand.encounter ? (
          <CombatHand
            activeSheetId={activeSheetId}
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
            edges={edges}
            drops={drops}
            mounts={mounts}
          />
        ) : null}
        </div>
        <div className="session-compose-entry">
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
          <DmStatusLine campaignId={campaignId} dmStatus={dmStatus} dmJob={dmJob} canStop={steersStory} />
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
            <DirectorPresets campaignId={campaignId} romance={romanceCue} />
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
          data-over={tooLong ? "" : undefined}
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
            aria-describedby={noteId}
            aria-invalid={tooLong || undefined}
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
            composerRef={composerRef}
            onTranscript={(text) =>
              setInput((current) => (current ? `${current} ${text}` : text))
            }
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || inputBlocked || tooLong}
            aria-label="Send"
            className={cn(ui.btnPrimary, "session-deskbtn cine-send")}
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        <LengthNote id={noteId} length={length} max={maxChars} from={0.8} className="mt-1" />
        {error ? <p className="motion-shake mt-1.5 text-sm text-red-400">{error}</p> : null}
        </div>
      </div>
    </form>
  );
}

// Memoized for the same reason as SidePanel: unchanged props while the DM
// streams narration into the message list.
export const Composer = memo(ComposerInner);
