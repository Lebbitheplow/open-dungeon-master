"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  CircleHelp,
  Dices,
  DoorOpen,
  Music,
  Music2,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "@/lib/cn";
import { JOIN_NOTE_PREFIX, isFloorExempt, latestUnintroducedJoin } from "@/lib/campaign-types";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import { HelpDialog } from "@/components/HelpDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { CharacterGate } from "@/app/campaigns/[campaignId]/CharacterGate";
import { Composer, type InputKind } from "@/app/campaigns/[campaignId]/Composer";
import { ItemProposalBar } from "@/app/campaigns/[campaignId]/ItemProposalBar";
import { DiceOverlay } from "@/app/campaigns/[campaignId]/DiceOverlay";
import { LevelUpDialog } from "@/app/campaigns/[campaignId]/LevelUpDialog";
import { LoreCheckDialog } from "@/app/campaigns/[campaignId]/LoreCheckDialog";
import { RenarrateDialog } from "@/app/campaigns/[campaignId]/RenarrateDialog";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import { UtilityCallStrip } from "@/app/campaigns/[campaignId]/UtilityCallStrip";
import { AskDock } from "@/app/campaigns/[campaignId]/AskPanel";
import type { CampaignMessage } from "@/lib/db/messages";
import {
  beatCadence,
  DEFAULT_BEAT_CADENCE,
  QUIET_BEAT_CADENCE,
  snoozeUntil,
} from "@/lib/dm/beat-cadence";
import {
  BottomTabBar,
  buildPanelTabs,
  useSessionTabs,
  type PanelTab,
} from "@/app/campaigns/[campaignId]/SessionTabs";
import { DmCoverNotice } from "@/app/campaigns/[campaignId]/DmDelegationPanel";
import { SidePanel } from "@/app/campaigns/[campaignId]/SidePanel";
import { VoiceDock } from "@/app/campaigns/[campaignId]/VoiceDock";
import { useChatChime } from "@/app/campaigns/[campaignId]/useChatChime";
import { useNarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import { useAmbienceAudio } from "@/app/campaigns/[campaignId]/useAmbienceAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

function subscribeDicePref(callback: () => void) {
  window.addEventListener("odm-dice3d-pref", callback);
  return () => window.removeEventListener("odm-dice3d-pref", callback);
}

// One audio group in the header: narration or ambience. On sm+ it is the
// familiar icon button with an inline slider. Below sm the header has no
// spare width at all (the 320px budget in SessionTabs.tsx is already spent),
// so the same icon becomes a menu holding the mute toggle and the slider:
// the phone gets a reachable volume control without the header growing a
// pixel, in the menu surface the rest of the app already uses.
function HeaderAudioControl({
  onLabel,
  offLabel,
  enableLabel,
  volumeLabel,
  unlocked,
  muted,
  volume,
  onToggle,
  onVolume,
  OnIcon,
  OffIcon,
}: {
  onLabel: string;
  offLabel: string;
  enableLabel: string;
  volumeLabel: string;
  unlocked: boolean;
  muted: boolean;
  volume: number;
  onToggle: () => void;
  onVolume: (value: number) => void;
  OnIcon: LucideIcon;
  OffIcon: LucideIcon;
}) {
  const quiet = muted || !unlocked;
  const toggleLabel = !unlocked ? enableLabel : muted ? offLabel : onLabel;
  const buttonClass = cn(
    "rounded-md border p-2.5 sm:p-1.5",
    quiet
      ? "border-stone-700 text-stone-500 hover:text-stone-300"
      : "border-amber-800 bg-amber-950/40 text-amber-400",
  );
  const icon = quiet ? <OffIcon className="size-4" /> : <OnIcon className="size-4" />;
  return (
    <>
      <div className="hidden items-center gap-1.5 sm:flex">
        <Tooltip content={toggleLabel} side="bottom">
          <button type="button" onClick={onToggle} aria-label={toggleLabel} className={buttonClass}>
            {icon}
          </button>
        </Tooltip>
        {unlocked && !muted ? (
          <Tooltip content={volumeLabel} side="bottom">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => onVolume(Number(event.target.value))}
              className="w-16 accent-amber-600"
              aria-label={volumeLabel}
            />
          </Tooltip>
        ) : null}
      </div>
      <div className="sm:hidden">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label={volumeLabel} className={buttonClass}>
              {icon}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="panel z-50 min-w-44 rounded-lg p-1">
              <DropdownMenu.Item
                className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800"
                onSelect={onToggle}
              >
                {toggleLabel}
              </DropdownMenu.Item>
              {unlocked && !muted ? (
                // A plain row rather than an Item so dragging the slider does
                // not close the menu.
                <div className="px-2 py-1.5">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(event) => onVolume(Number(event.target.value))}
                    className="w-full accent-amber-600"
                    aria-label={volumeLabel}
                  />
                </div>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </>
  );
}

export function SessionView({
  state,
  refreshNotes,
  refreshFacts,
  refreshSideChat,
  refreshWhispers,
  refreshAsks,
  refreshBattleMap,
}: {
  state: CampaignState;
  refreshNotes: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  refreshSideChat: () => Promise<void>;
  refreshWhispers: () => Promise<void>;
  refreshAsks: () => Promise<void>;
  refreshBattleMap: () => Promise<void>;
}) {
  const {
    campaign,
    me,
    sheets,
    messages,
    rolls,
    pendingRolls,
    auditLog,
    levelUps,
    locations,
    dmStatus,
    utilityCalls,
    dmDraft,
    caps,
  } = state;
  const [input, setInput] = useState("");
  const [kind, setKind] = useState<InputKind>("do");
  // The DM has no character, so "do" would be a mode they can never use.
  const [seenDmSeat, setSeenDmSeat] = useState(false);
  // Whether a lead direction is spoken to the table or only to the DM.
  // Defaults to off, so Direct keeps behaving as it always has unless the
  // lead deliberately hides one.
  const [leadPrivate, setLeadPrivate] = useState(false);
  // The Ask strip sits in the chat column and starts closed. It owns the rest
  // of the feature itself, including the question box and the in-flight echo;
  // all this view keeps is whether the strip is expanded.
  const [askOpen, setAskOpen] = useState(false);
  // Ask already reports its own progress inside the strip, naming the question
  // being answered, so repeating it in the strip is the same news twice.
  const visibleUtilityCalls = useMemo(
    () => utilityCalls.filter((call) => call.kind !== "ask"),
    [utilityCalls],
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [dismissedLevelUp, setDismissedLevelUp] = useState("");
  const [dismissedJoinNotice, setDismissedJoinNotice] = useState("");
  // "Message" on a party card: SidePanel switches to the chat tab and opens
  // the 1:1 thread with this user.
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  // Lore check: the flagged message plus whatever text was selected when
  // the flag was raised (captured at click, before the dialog steals focus).
  const [loreCheck, setLoreCheck] = useState<{
    message: CampaignMessage;
    selection: string;
  } | null>(null);
  // Narration reroll: the DM message whose prose the lead is rerolling.
  const [renarrate, setRenarrate] = useState<CampaignMessage | null>(null);
  // Bumped on pin/unpin so the pins panel refetches without a stream event.
  const [pinsVersion, setPinsVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dice3d = useSyncExternalStore(
    subscribeDicePref,
    () => window.localStorage.getItem("odm:dice3d") !== "off",
    () => true,
  );

  const toggleDice3d = useCallback(() => {
    window.localStorage.setItem("odm:dice3d", dice3d ? "off" : "on");
    window.dispatchEvent(new Event("odm-dice3d-pref"));
  }, [dice3d]);

  const narration = useNarrationAudio();
  const ambience = useAmbienceAudio(
    state.ambience,
    state.ambienceSting,
    Boolean(campaign?.gameSettings?.ambienceEnabled),
  );
  // The room drops behind the DM's voice while a passage is being read, and
  // comes back when it stops. Nothing else in the app knows how to do this,
  // which is why the two hooks meet here rather than inside either one.
  const duckAmbience = ambience.setDucked;
  useEffect(() => {
    duckAmbience(Boolean(narration.playingMessageId));
  }, [duckAmbience, narration.playingMessageId]);
  // Chime on new private messages (side chats + DM whispers). The loaded
  // flags keep the page-load backlog silent.
  const chatUnreadTotal =
    state.sideThreads.reduce((sum, thread) => sum + thread.unread, 0) + state.whisperUnread;
  useChatChime(chatUnreadTotal, state.sideChatLoaded && state.whispersLoaded);
  const pendingNoteCount = state.notes.filter((note) => note.status === "pending").length;
  const { panelTab, setPanelTab, mobileView, setMobileView } = useSessionTabs({
    chatTarget,
    battleMap: state.battleMap,
  });
  // Only tts_ready events newer than the seq present when the snapshot first
  // loaded autoplay; the backlog stays silent (replay buttons cover history).
  // Each narration is handed over exactly once: unrelated events (new chat
  // messages) must never re-trigger and restart playback.
  const mountSeqRef = useRef<number | null>(null);
  const handedTtsRef = useRef<string | null>(null);
  const { latestTts, loading, lastSeq } = state;
  const { onTtsReady } = narration;
  useEffect(() => {
    if (mountSeqRef.current === null) {
      if (!loading) {
        mountSeqRef.current = lastSeq;
      }
      return;
    }
    if (latestTts && latestTts.messageId !== handedTtsRef.current) {
      handedTtsRef.current = latestTts.messageId;
      onTtsReady(latestTts.messageId, latestTts.url, latestTts.seq > mountSeqRef.current);
    }
  }, [latestTts, onTtsReady, loading, lastSeq]);

  // Everything below runs on every dm_delta while the DM narrates, so the
  // values handed to the memoized panels are stabilized with useMemo and
  // useCallback. All hooks must stay above the null guard further down.
  const mySheet = useMemo(
    () => sheets.find((sheet) => sheet.userId === me?.id),
    [sheets, me?.id],
  );
  const myLevelUp = mySheet
    ? levelUps.find((notice) => notice.characterId === mySheet.id)
    : undefined;
  // Memoized so the open-floor fallback object keeps a stable identity and
  // does not invalidate the memos below on every render.
  const floor = useMemo(() => campaign?.floor ?? { mode: "open" as const }, [campaign?.floor]);
  // Two different authorities, deliberately separate. `isLead` owns the
  // table (campaign info, invites, who holds which seat). `caps` says who
  // owns the story, which is the lead in an AI campaign and the DM in a
  // human-run one; the server decided it, this only reads it.
  const isLead = Boolean(campaign && me && campaign.leadUserId === me.id);
  const isDm = caps.role === "dm";
  const steersStory = caps.steersStory;
  const spotlighted = useMemo(
    () =>
      floor.mode === "spotlight"
        ? sheets.filter((sheet) => floor.mode === "spotlight" && floor.userIds.includes(sheet.userId))
        : [],
    [floor, sheets],
  );
  if (isDm && !seenDmSeat) {
    setSeenDmSeat(true);
    setKind("narrate");
  }
  // Table talk and lead directions never wait on the floor. (Asking does not
  // either, but it does not come through this composer at all.)
  const exempt = isFloorExempt(kind);
  const floorBlocked =
    floor.mode === "spotlight" && !floor.userIds.includes(me?.id ?? "") && !exempt;
  // Held responses: the lead has not opened the floor after the last DM
  // narration. OOC and lead directions stay available, as does the Ask strip.
  const holdBlocked = floor.mode === "hold" && !exempt;
  // Combat: only the current-turn player acts; everyone else waits.
  const initiativeBlocked =
    floor.mode === "initiative" && !floor.userIds.includes(me?.id ?? "") && !exempt;
  const heldSpotlightNames = useMemo(
    () =>
      floor.mode === "hold" && floor.next.mode === "spotlight"
        ? sheets
            .filter(
              (sheet) =>
                floor.mode === "hold" &&
                floor.next.mode === "spotlight" &&
                floor.next.userIds.includes(sheet.userId),
            )
            .map((sheet) => sheet.name)
        : [],
    [floor, sheets],
  );
  // The campaign's opening narration gets everyone's full attention: while
  // it plays for this user, do/say/lead input waits (OOC stays open).
  const firstDmMessageId = messages.find((message) => message.authorType === "dm")?.id;
  const openingNarrationPlaying =
    Boolean(firstDmMessageId) &&
    narration.playingMessageId === firstDmMessageId &&
    messages.filter((message) => message.authorType === "dm").length === 1;
  // The opening narration gets the table's attention. A question about it is
  // exactly the kind of thing someone wants to ask while it plays, and the
  // Ask strip is never blocked, so this only has to spare OOC.
  const narrationBlocked = openingNarrationPlaying && kind !== "ooc";
  const inputBlocked = floorBlocked || holdBlocked || initiativeBlocked || narrationBlocked;
  const placeholder = narrationBlocked
    ? "The Dungeon Master is setting the scene... (OOC still open)"
    : holdBlocked
      ? "The party lead has the floor held for discussion... (OOC still open)"
      : initiativeBlocked
        ? `${floor.mode === "initiative" ? floor.currentName : "Another hero"}'s turn in combat... (OOC still open)`
        : floorBlocked
          ? `Waiting on ${spotlighted.map((sheet) => sheet.name).join(", ")}... (OOC still open)`
          : kind === "do"
            ? `What does ${mySheet?.name ?? "your character"} do?`
            : kind === "say"
              ? `What does ${mySheet?.name ?? "your character"} say?`
              : kind === "narrate"
              ? "Narrate the scene. The server still rolls every die."
              : kind === "ooc"
                ? "Out-of-character note to the table"
                : leadPrivate
                  ? "Tell the DM privately what to do with the next turn"
                  : "Steer the story: a direction the DM must weave in";
  // A mid-game joiner without a character is gated to creation first. The DM
  // runs no character, so the gate must never catch them.
  const needsCharacter = caps.needsCharacter && !mySheet && campaign?.status === "active";
  // Lead prompt: a newcomer's join note the DM has not narrated past yet.
  const joinNotice = latestUnintroducedJoin(messages);
  const showJoinBanner =
    steersStory && joinNotice !== null && dismissedJoinNotice !== joinNotice.id;
  const panelTabs = useMemo(
    () =>
      buildPanelTabs({
        hasBattleMap: Boolean(state.battleMap),
        mapsEnabled: campaign?.gameSettings?.mapsEnabled ?? true,
        hasSettings: Boolean(campaign),
        secretStory: caps.secretStory,
        adjudicates: caps.adjudicates,
      }),
    [state.battleMap, campaign, caps.secretStory, caps.adjudicates],
  );
  // Gates the Bonds sub-tab inside the Party panel.
  const relationshipsEnabled = campaign?.gameSettings?.relationships !== "off";

  const campaignId = campaign?.id;

  const releaseFloor = useCallback(async () => {
    await fetch(`/api/campaigns/${campaignId}/floor`, { method: "POST" });
  }, [campaignId]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const content = input.trim();
      if (!content || sending || inputBlocked) {
        return;
      }
      setSending(true);
      setError("");
      try {
        // A lead direction goes one of two ways. Public is a visible note the
        // table can read and the DM answers now; private arms the same
        // one-turn steer the event presets use, so no character hears it and
        // it never enters the transcript.
        const response =
          kind === "narrate"
            ? await fetch(`/api/campaigns/${campaignId}/dm/narrate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
              })
            : kind === "lead"
            ? leadPrivate
              ? await fetch(`/api/campaigns/${campaignId}/director`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ oneShot: null, absoluteCommand: content }),
                })
              : await fetch(`/api/campaigns/${campaignId}/lead-note`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content }),
                })
            : await fetch(`/api/campaigns/${campaignId}/actions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content, kind }),
              });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error || "Could not send your action.");
          return;
        }
        setInput("");
      } catch {
        setError("Could not reach the server.");
      } finally {
        setSending(false);
      }
    },
    [campaignId, input, sending, inputBlocked, kind, leadPrivate],
  );

  const clearChatTarget = useCallback(() => setChatTarget(null), []);
  const selectChatView = useCallback(() => setMobileView("chat"), [setMobileView]);
  const selectPanelView = useCallback(
    (tab: PanelTab) => {
      setPanelTab(tab);
      setMobileView("panel");
    },
    [setPanelTab, setMobileView],
  );

  // Story capture: how long the DM has been running the table without any of
  // it reaching the log. Recomputed from state the client already holds, so
  // it follows every message and every roll with no extra request
  // (src/lib/dm/beat-cadence.ts).
  const [beatSnoozedUntil, setBeatSnoozedUntil] = useState<string | null>(null);
  const beatThreshold = campaign?.gameSettings?.beatReminder ?? DEFAULT_BEAT_CADENCE;
  const storyCadence = useMemo(
    () =>
      caps.adjudicates
        ? beatCadence({
            messages: state.messages,
            rolls: state.rolls,
            threshold: beatThreshold,
            snoozedUntil: beatSnoozedUntil,
            now: new Date().toISOString(),
          })
        : QUIET_BEAT_CADENCE,
    [caps.adjudicates, state.messages, state.rolls, beatThreshold, beatSnoozedUntil],
  );
  const openStoryCapture = useCallback(() => {
    selectPanelView("dm");
  }, [selectPanelView]);
  const snoozeStory = useCallback(() => {
    setBeatSnoozedUntil(snoozeUntil(Date.now()));
  }, []);

  const joinNoticeId = joinNotice?.id;
  const joinNoticeText = joinNotice?.content.slice(JOIN_NOTE_PREFIX.length);
  const joinBanner = useMemo(
    () =>
      showJoinBanner && joinNoticeId
        ? {
            text: joinNoticeText ?? "",
            onWriteIntro: () => {
              setKind("lead");
              composerRef.current?.focus();
            },
            onDismiss: () => setDismissedJoinNotice(joinNoticeId),
          }
        : null,
    [showJoinBanner, joinNoticeId, joinNoticeText],
  );

  if (!campaign || !me) {
    return null;
  }

  return (
    <main className="flex h-dvh flex-col">
      <header className="glass z-10 flex items-center justify-between border-b border-stone-700/40 px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2.5">
          <PixelTile src={PIXEL_ICONS.story} size="size-9" />
          <div className="min-w-0">
            <h1 className="truncate font-display leading-tight tracking-wide text-amber-50">{campaign.title}</h1>
            <p className="truncate text-xs text-stone-500">
              {campaign.scene || "The adventure unfolds"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <VoiceDock
            campaignId={campaign.id}
            meUserId={me.id}
            roster={state.voiceRoster}
            speaking={state.voiceSpeaking}
            floorMode={floor.mode}
            floorUserIds={
              floor.mode === "spotlight" || floor.mode === "initiative" ? floor.userIds : []
            }
            turnEnforcement={campaign.gameSettings?.voice?.turnEnforcement ?? "soft"}
            adjudicates={caps.adjudicates}
            sayRangeRule={Boolean(campaign.gameSettings?.voice?.rules?.sayRange)}
            audibilityVersion={state.voiceAudibilityVersion}
          />
          <Tooltip
            content={dice3d ? "Turn off 3D dice animation" : "Turn on 3D dice animation"}
            side="bottom"
          >
            <button
              type="button"
              onClick={toggleDice3d}
              aria-label={dice3d ? "Turn off 3D dice animation" : "Turn on 3D dice animation"}
              className={cn(
                "rounded-md border p-2.5 sm:p-1.5",
                dice3d
                  ? "border-amber-800 bg-amber-950/40 text-amber-400"
                  : "border-stone-700 text-stone-500 hover:text-stone-300",
              )}
            >
              <Dices className="size-4" />
            </button>
          </Tooltip>
          {campaign.gameSettings?.ttsEnabled ? (
            <HeaderAudioControl
              onLabel="Mute narration"
              offLabel="Unmute narration"
              enableLabel="Enable narration audio"
              volumeLabel="Narration volume"
              unlocked={narration.unlocked}
              muted={narration.muted}
              volume={narration.volume}
              onToggle={() => {
                narration.unlock();
                narration.setMuted(!narration.muted);
              }}
              onVolume={(value) => narration.setVolume(value)}
              OnIcon={Volume2}
              OffIcon={VolumeX}
            />
          ) : null}
          {campaign.gameSettings?.ambienceEnabled && ambience.installed ? (
            <HeaderAudioControl
              onLabel="Mute ambience and music"
              offLabel="Unmute ambience and music"
              enableLabel="Enable ambience"
              volumeLabel="Ambience and music volume"
              unlocked={ambience.unlocked}
              muted={ambience.muted}
              volume={ambience.volume}
              onToggle={() => {
                ambience.unlock();
                ambience.setMuted(!ambience.muted);
              }}
              onVolume={(value) => ambience.setVolume(value)}
              OnIcon={Music}
              OffIcon={Music2}
            />
          ) : null}
          <Tooltip content="How everything works" side="bottom">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Help"
              className="rounded-md border border-stone-700 p-2.5 text-stone-500 hover:text-stone-300 sm:p-1.5"
            >
              <CircleHelp className="size-4" />
            </button>
          </Tooltip>
          <Link
            href="/"
            aria-label="All campaigns"
            className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-300"
          >
            <DoorOpen className="size-4 md:hidden" />
            <span className="hidden md:inline">All campaigns</span>
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-w-0 flex-1 flex-col",
            mobileView === "chat" ? "flex" : "hidden lg:flex",
          )}
        >
          <MessageList
            messages={messages}
            campaignId={campaign.id}
            canRetryTurn={steersStory}
            rolls={rolls}
            sheets={sheets}
            members={state.members}
            locations={locations}
            dmStatus={dmStatus}
            dmDraft={dmDraft}
            mediaStatus={state.mediaStatus}
            onReplayAudio={
              campaign.gameSettings?.ttsEnabled
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
                      `/api/campaigns/${campaign.id}/messages/${messageId}/narrate`,
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
              const selection = window.getSelection()?.toString().trim() ?? "";
              setLoreCheck({
                message,
                selection: selection.length > 3 ? selection : "",
              });
            }}
            onRenarrate={steersStory ? (message) => setRenarrate(message) : undefined}
            onContinueScene={
              steersStory
                ? async (message) => {
                    // No dialog: a continue takes no options, so the button is
                    // the whole interaction. The server publishes
                    // message_updated with the extended prose.
                    const response = await fetch(
                      `/api/campaigns/${campaign.id}/messages/${message.id}/continue`,
                      { method: "POST" },
                    );
                    if (!response.ok) {
                      const data = await response.json().catch(() => ({}));
                      setError(data.error || "Could not continue the scene.");
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
                      `/api/campaigns/${campaign.id}/messages/${message.id}/renarrate`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "select", index }),
                      },
                    );
                    if (!response.ok) {
                      const data = await response.json().catch(() => ({}));
                      setError(data.error || "Could not switch takes.");
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
                      `/api/campaigns/${campaign.id}/messages/${message.id}/edit`,
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
              // NE-P's isFullMessage distinction: a selection is an excerpt,
              // no selection pins the whole narration. Any member may pin,
              // unlike onPinCanon (facts), which is lead-only canon.
              const selection = window.getSelection()?.toString().trim() ?? "";
              const isFullMessage = selection.length <= 3;
              const response = await fetch(`/api/campaigns/${campaign.id}/pins`, {
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
                setError(data.error || "Could not pin that.");
                return;
              }
              setPinsVersion((count) => count + 1);
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
                    await fetch(`/api/campaigns/${campaign.id}/facts`, {
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
            campaignId={campaign.id}
            proposals={state.itemProposals}
            sheets={sheets}
            meUserId={me.id}
            steersStory={steersStory}
          />

          <AskDock
            campaignId={campaign.id}
            asks={state.asks}
            meUserId={me.id}
            loaded={state.asksLoaded}
            open={askOpen}
            onOpenChange={setAskOpen}
            onAsked={refreshAsks}
          />

          {/* Directly above the composer, so the answer to "why is nothing
              happening" sits where the player is already looking. Ask has its
              own in-flight row inside the strip, which names the actual
              question, so it is filtered out here rather than shown twice. */}
          <UtilityCallStrip calls={visibleUtilityCalls} />

          {/* Assisted mode: the DM stepped away and the AI is answering for
              them. Shown to every seat, because a player owed an answer is
              owed the knowledge of who is giving it. */}
          <DmCoverNotice cover={campaign.dmCover} />

          {needsCharacter ? (
            <CharacterGate campaignId={campaign.id} />
          ) : (
            <Composer
              campaignId={campaign.id}
              sheets={sheets}
              meUserId={me.id}
              steersStory={steersStory}
              isDm={isDm}
              kind={kind}
              onKindChange={setKind}
              input={input}
              setInput={setInput}
              sending={sending}
              error={error}
              inputBlocked={inputBlocked}
              placeholder={placeholder}
              dmStatus={dmStatus}
              pendingRolls={pendingRolls}
              floor={floor}
              spotlighted={spotlighted}
              heldSpotlightNames={heldSpotlightNames}
              encounter={state.encounter}
              onReleaseFloor={releaseFloor}
              joinBanner={joinBanner}
              composerRef={composerRef}
              directorArm={state.directorArm}
              leadPrivate={leadPrivate}
              onLeadPrivateChange={setLeadPrivate}
              storyCadence={storyCadence}
              onCaptureStory={openStoryCapture}
              onSnoozeStory={snoozeStory}
              onSubmit={submit}
            />
          )}
        </div>

        <SidePanel
          pinsVersion={pinsVersion}
          campaignId={campaign.id}
          sheets={sheets}
          members={state.members}
          meUserId={me.id}
          steersStory={steersStory}
          adjudicates={caps.adjudicates}
          dmCover={campaign.dmCover}
          messages={state.messages}
          dmIntents={state.dmIntents}
          floorMode={floor.mode}
          isLead={isLead}
          leadUserId={campaign.leadUserId}
          canTransferLead={isLead || campaign.ownerUserId === me.id}
          spotlightUserIds={floor.mode === "spotlight" ? floor.userIds : []}
          auditLog={auditLog}
          locations={locations}
          chapters={state.chapters}
          notes={state.notes}
          facts={state.facts}
          characterEvents={state.characterEvents}
          refreshNotes={refreshNotes}
          refreshFacts={refreshFacts}
          sideThreads={state.sideThreads}
          refreshSideChat={refreshSideChat}
          whispers={state.whispers}
          whisperUnread={state.whisperUnread}
          refreshWhispers={refreshWhispers}
          chatTarget={chatTarget}
          onChatTargetHandled={clearChatTarget}
          onMessageUser={setChatTarget}
          mediaStatus={state.mediaStatus}
          inviteCode={campaign.inviteCode}
          midGameJoinOpen={campaign.gameSettings?.midGameJoinOpen ?? false}
          campaign={campaign}
          encounter={state.encounter}
          battleMap={state.battleMap}
          mapPing={state.mapPing}
          refreshBattleMap={refreshBattleMap}
          tabs={panelTabs}
          tab={panelTab}
          onTabChange={setPanelTab}
          pendingCount={pendingNoteCount}
          chatUnread={chatUnreadTotal}
          mobileVisible={mobileView === "panel"}
          relationshipsVersion={state.relationshipsVersion}
          relationshipsEnabled={relationshipsEnabled}
          beats={state.beats}
          storyDue={storyCadence.level !== "quiet"}
        />
      </div>

      <BottomTabBar
        tabs={panelTabs}
        mobileView={mobileView}
        panelTab={panelTab}
        onSelectChat={selectChatView}
        onSelectPanel={selectPanelView}
        chatUnread={chatUnreadTotal}
        pendingCount={pendingNoteCount}
        storyDue={storyCadence.level !== "quiet"}
      />

      {dice3d ? <DiceOverlay latestRoll={state.latestRoll} enabled /> : null}

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      {loreCheck ? (
        <LoreCheckDialog
          campaignId={campaign.id}
          message={loreCheck.message}
          selection={loreCheck.selection}
          steersStory={steersStory}
          onClose={() => setLoreCheck(null)}
        />
      ) : null}

      {renarrate ? (
        <RenarrateDialog
          campaignId={campaign.id}
          message={
            // Track the live message so the take counter in the dialog
            // follows the variant the reroll just added.
            messages.find((entry) => entry.id === renarrate.id) ?? renarrate
          }
          onClose={() => setRenarrate(null)}
        />
      ) : null}

      {myLevelUp &&
      mySheet &&
      dismissedLevelUp !== `${myLevelUp.characterId}:${myLevelUp.level}` ? (
        <LevelUpDialog
          campaignId={campaign.id}
          sheet={mySheet}
          targetLevel={myLevelUp.level}
          multiclassAllowed={campaign.gameSettings?.multiclassingEnabled ?? true}
          onDone={() =>
            setDismissedLevelUp(`${myLevelUp.characterId}:${myLevelUp.level}`)
          }
        />
      ) : null}
    </main>
  );
}
