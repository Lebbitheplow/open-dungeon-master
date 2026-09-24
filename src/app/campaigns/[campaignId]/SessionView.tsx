"use client";

import { LevelUpMoment, LootMoment, MomentVeil, RestMoment, TravelBanner } from "@/app/campaigns/[campaignId]/Moments";
import { haptic, useEffectsRoot, useTurnChime } from "@/lib/effects-mode";
import { SceneTitle } from "@/components/SceneTitle";
import { HandoutStage } from "@/components/HandoutStage";
import { SafetyPause } from "@/app/campaigns/[campaignId]/SafetyPause";
import type { Speaker } from "@/lib/dm/speech";
import { LabelSheet } from "@/app/campaigns/[campaignId]/LabelSheet";
import type { MapLabel } from "@/lib/battlemap/scene";

const NOOP = () => {};
const NOOP_IDS: (ids: string[]) => void = () => {};
const NOOP_ID: (id: string) => void = () => {};
const NOOP_CUE: (cue: string) => void = () => {};
// One shared empty list: a fresh [] per render would defeat the memo on
// every panel that takes it.
const EMPTY_IDS: string[] = [];

import {
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { JOIN_NOTE_PREFIX, latestUnintroducedJoin } from "@/lib/campaign-types";
import { markTourSeen, tourSeen } from "@/lib/tours/logic";
import { DM_TOUR, DM_TOUR_ID, PLAYER_TOUR, PLAYER_TOUR_ID } from "@/lib/tours/table";
import { HelpDialog } from "@/components/HelpDialog";
import { GuidedTour } from "@/components/ui/GuidedTour";
import { CharacterGate } from "@/app/campaigns/[campaignId]/CharacterGate";
import { Composer, type InputKind } from "@/app/campaigns/[campaignId]/Composer";
import { composerGate } from "@/app/campaigns/[campaignId]/composerGate";
import { DiceOverlay } from "@/app/campaigns/[campaignId]/DiceOverlay";
import { DiceLookDialog } from "@/components/DiceLookEditor";
import {
  requestMotionAccess,
  supportsShake,
  useShakeToRoll,
  writeShakeToRoll,
} from "@/lib/dice/shake-to-roll";
import { LoreCheckDialog } from "@/app/campaigns/[campaignId]/LoreCheckDialog";
import { RenarrateDialog } from "@/app/campaigns/[campaignId]/RenarrateDialog";
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
import { SessionChatColumn } from "@/app/campaigns/[campaignId]/SessionChatColumn";
import { SessionHeader } from "@/app/campaigns/[campaignId]/SessionHeader";
import { SidePanel } from "@/app/campaigns/[campaignId]/SidePanel";
import { useChatChime } from "@/app/campaigns/[campaignId]/useChatChime";
import { useTableAudio } from "@/app/campaigns/[campaignId]/useTableAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { InitiativeRibbon, PartyRail, QuestGlance, RollToast, SceneBackdrop } from "@/app/campaigns/[campaignId]/CinematicParts";

// The level-up dialog carries the class feature and resource tables of the
// whole SRD; it loads the first time a character actually levels rather
// than with the table.
const LevelUpDialog = lazy(() =>
  import("@/app/campaigns/[campaignId]/LevelUpDialog").then((module) => ({
    default: module.LevelUpDialog,
  })),
);

// The localStorage-backed preferences below are read as external stores.
// Each keeps its last answer and forgets it only when its own event says
// something changed, so a render never touches localStorage; the events
// subscribed to are the same ones as before, nothing more.
const DICE3D_EVENT = "odm-dice3d-pref";
let dice3dCache: boolean | null = null;

function readDice3d(): boolean {
  if (dice3dCache === null) {
    dice3dCache = window.localStorage.getItem("odm:dice3d") !== "off";
  }
  return dice3dCache;
}

function subscribeDicePref(callback: () => void) {
  const listener = () => {
    dice3dCache = null;
    callback();
  };
  window.addEventListener(DICE3D_EVENT, listener);
  return () => window.removeEventListener(DICE3D_EVENT, listener);
}

// The once-only flag of each table tour, read the way the dice preference
// is: from localStorage as an external store, so finishing a tour in one
// tab is known to every other.
const TOUR_SEEN_EVENT = "odm-tour-seen";
const tourSeenCache = new Map<string, boolean>();

function readTourSeen(tourId: string): boolean {
  let seen = tourSeenCache.get(tourId);
  if (seen === undefined) {
    seen = tourSeen(window.localStorage, tourId);
    tourSeenCache.set(tourId, seen);
  }
  return seen;
}

function subscribeTourSeen(callback: () => void) {
  const listener = () => {
    tourSeenCache.clear();
    callback();
  };
  window.addEventListener(TOUR_SEEN_EVENT, listener);
  return () => window.removeEventListener(TOUR_SEEN_EVENT, listener);
}

// The play table. Header, the story column, the docked context column and
// the dialogs that float over all three. What lives here is the state the
// columns share: which tab is open, what the composer holds, who is blocked
// from sending and why, and the seat flags every panel reads.
export function SessionView({
  state,
  refreshNotes,
  refreshFacts,
  refreshSideChat,
  refreshWhispers,
  refreshAsks,
  refreshBattleMap,
  markFxPlayed = NOOP_IDS,
  markCameraDone = NOOP,
  markTitleCardShown = NOOP_ID,
  playSting = NOOP_CUE,
}: {
  state: CampaignState;
  refreshNotes: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  refreshSideChat: () => Promise<void>;
  refreshWhispers: () => Promise<void>;
  refreshAsks: () => Promise<void>;
  refreshBattleMap: () => Promise<void>;
  // The board reports effects it has played and camera moves it has obeyed
  // (useCampaignStream.ts), and this view may sound a local sting.
  markFxPlayed?: (ids: string[]) => void;
  markCameraDone?: () => void;
  markTitleCardShown?: (id: string) => void;
  playSting?: (cue: string) => void;
}) {
  // The effects mode rides on <html data-effects> for CSS-only consumers.
  useEffectsRoot();
  const turnChime = useTurnChime();
  const { campaign, me, sheets, messages, pendingRolls, auditLog, levelUps, locations, dmStatus, caps } =
    state;
  const [input, setInput] = useState("");
  const [kind, setKind] = useState<InputKind>("do");
  // The DM has no character, so "do" would be a mode they can never use.
  const [seenDmSeat, setSeenDmSeat] = useState(false);
  // Whether a lead direction is spoken to the table or only to the DM.
  // Defaults to off, so Direct keeps behaving as it always has unless the
  // lead deliberately hides one.
  const [leadPrivate, setLeadPrivate] = useState(false);
  // Who the DM seat is speaking as (docs/vtt-parity-implementation-plan.md
  // 8.1); null is the narrator.
  const [speaker, setSpeaker] = useState<Speaker | null>(null);

  // The Ask strip sits in the chat column and starts closed. It owns the rest
  // of the feature itself; all this view keeps is whether it is expanded.
  const [askOpen, setAskOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [dismissedLevelUp, setDismissedLevelUp] = useState("");
  // The level-up flourish plays once per level, then hands over to the dialog.
  const [celebratedLevelUp, setCelebratedLevelUp] = useState("");
  const [dismissedJoinNotice, setDismissedJoinNotice] = useState("");
  // "Message" on a party card: SidePanel switches to the chat tab and opens
  // the 1:1 thread with this user.
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  // Lore check: the flagged message plus whatever text was selected when
  // the flag was raised.
  const [loreCheck, setLoreCheck] = useState<{ message: CampaignMessage; selection: string } | null>(
    null,
  );
  // Narration reroll: the DM message whose prose the lead is rerolling.
  const [renarrate, setRenarrate] = useState<CampaignMessage | null>(null);
  // Bumped on pin/unpin so the pins panel refetches without a stream event.
  const [pinsVersion, setPinsVersion] = useState(0);
  // The guided tour on screen, if any: the player's or the DM's.
  const [tour, setTour] = useState<"player" | "dm" | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dice3d = useSyncExternalStore(subscribeDicePref, readDice3d, () => true);
  const toggleDice3d = useCallback(() => {
    window.localStorage.setItem("odm:dice3d", dice3d ? "off" : "on");
    window.dispatchEvent(new Event(DICE3D_EVENT));
  }, [dice3d]);
  const [diceLookOpen, setDiceLookOpen] = useState(false);
  const openDiceLook = useCallback(() => setDiceLookOpen(true), []);
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  // Shake to roll is a device preference; while it is on here, this
  // member's rolls are held at the campaign so the phone can release them.
  // Synced on arrival and when the switch moves, never on member updates,
  // so two open devices cannot chase each other's flag.
  const shakeOn = useShakeToRoll();
  const [canShake] = useState(() => supportsShake());
  const toggleShake = useCallback(() => {
    if (shakeOn) {
      writeShakeToRoll(false);
      return;
    }
    void requestMotionAccess().then((granted) => writeShakeToRoll(granted));
  }, [shakeOn]);
  const shake = useMemo(
    () => ({ supported: canShake, on: shakeOn, onToggle: toggleShake }),
    [canShake, shakeOn, toggleShake],
  );
  const myHoldRolls =
    state.members.find((member) => member.userId === me?.id)?.holdRolls ?? null;
  const myHoldRollsRef = useRef<boolean | null>(null);
  useEffect(() => {
    myHoldRollsRef.current = myHoldRolls;
  }, [myHoldRolls]);
  const campaignIdForShake = campaign?.id ?? null;
  useEffect(() => {
    if (
      !canShake ||
      !campaignIdForShake ||
      myHoldRollsRef.current === null ||
      myHoldRollsRef.current === shakeOn
    ) {
      return;
    }
    void fetch(`/api/campaigns/${campaignIdForShake}/members/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdRolls: shakeOn }),
    }).catch(() => undefined);
  }, [canShake, shakeOn, campaignIdForShake]);

  const { narration, ambience } = useTableAudio(state);
  // Chime on new private messages (side chats + DM whispers). The loaded
  // flags keep the page-load backlog silent.
  const chatUnreadTotal =
    state.sideThreads.reduce((sum, thread) => sum + thread.unread, 0) + state.whisperUnread;
  useChatChime(chatUnreadTotal, state.sideChatLoaded && state.whispersLoaded);
  const pendingNoteCount = state.notes.filter((note) => note.status === "pending").length;
  // Two different authorities, deliberately separate. `isLead` owns the
  // table (campaign info, invites, who holds which seat). `caps` says who
  // owns the story, which is the lead in an AI campaign and the DM in a
  // human-run one; the server decided it, this only reads it. Computed up
  // here because the tab hook needs it to fall off the lead tab when the
  // seat moves.
  const isLead = Boolean(campaign && me && campaign.leadUserId === me.id);
  const { panelTab, setPanelTab, mobileView, setMobileView } = useSessionTabs({
    chatTarget,
    battleMap: state.battleMap,
    isLead,
  });

  // Everything below runs on every dm_delta while the DM narrates, so the
  // values handed to the memoized panels are stabilized with useMemo and
  // useCallback. All hooks must stay above the null guard further down.
  const mySheet = useMemo(() => sheets.find((sheet) => sheet.userId === me?.id), [sheets, me?.id]);
  const myLevelUp = mySheet ? levelUps.find((notice) => notice.characterId === mySheet.id) : undefined;
  // Memoized so the open-floor fallback object keeps a stable identity and
  // does not invalidate the memos below on every render.
  const floor = useMemo(() => campaign?.floor ?? { mode: "open" as const }, [campaign?.floor]);
  const isDm = caps.role === "dm";
  const steersStory = caps.steersStory;
  if (isDm && !seenDmSeat) {
    setSeenDmSeat(true);
    setKind("narrate");
  }

  // The tour for this seat runs once, the first time the table is sat at,
  // after the layout has had a moment to settle. Help replays it.
  const tourId = isDm ? DM_TOUR_ID : PLAYER_TOUR_ID;
  const tourAlreadySeen = useSyncExternalStore(
    subscribeTourSeen,
    () => readTourSeen(tourId),
    () => true,
  );
  useEffect(() => {
    if (tourAlreadySeen) return;
    const timer = window.setTimeout(() => setTour(isDm ? "dm" : "player"), 1200);
    return () => clearTimeout(timer);
  }, [tourAlreadySeen, isDm]);
  const closeTour = useCallback(() => {
    markTourSeen(window.localStorage, tourId);
    window.dispatchEvent(new Event(TOUR_SEEN_EVENT));
    setTour(null);
  }, [tourId]);
  // The campaign's opening narration gets everyone's full attention: while
  // it plays for this user, do/say/lead input waits (OOC stays open).
  const firstDmMessageId = messages.find((message) => message.authorType === "dm")?.id;
  const openingNarrationPlaying =
    Boolean(firstDmMessageId) &&
    narration.playingMessageId === firstDmMessageId &&
    messages.filter((message) => message.authorType === "dm").length === 1;
  const myName = mySheet?.name ?? "your character";
  const meId = me?.id ?? "";
  // Muted by the party lead: the server refuses the send, so the box says
  // so instead of letting the player type into a wall.
  const muted = Boolean(state.members.find((member) => member.userId === meId)?.muted);
  const gate = useMemo(
    () =>
      composerGate({ floor, sheets, meUserId: meId, kind, myName, leadPrivate, openingNarrationPlaying }),
    [floor, sheets, meId, kind, myName, leadPrivate, openingNarrationPlaying],
  );
  // A mid-game joiner without a character is gated to creation first. The DM
  // runs no character, so the gate must never catch them.
  const needsCharacter = caps.needsCharacter && !mySheet && campaign?.status === "active";
  // Lead prompt: a newcomer's join note the DM has not narrated past yet.
  const joinNotice = latestUnintroducedJoin(messages);
  const showJoinBanner = steersStory && joinNotice !== null && dismissedJoinNotice !== joinNotice.id;
  const panelTabs = useMemo(
    () =>
      buildPanelTabs({
        hasBattleMap: Boolean(state.battleMap),
        mapsEnabled: campaign?.gameSettings?.mapsEnabled ?? true,
        hasSettings: Boolean(campaign),
        secretStory: caps.secretStory,
        adjudicates: caps.adjudicates,
        isLead,
      }),
    [state.battleMap, campaign, caps.secretStory, caps.adjudicates, isLead],
  );
  // Gates the Bonds sub-tab inside the Party panel.
  const relationshipsEnabled = campaign?.gameSettings?.relationships !== "off";

  const campaignId = campaign?.id;
  const raiseXCard = useCallback(() => {
    void fetch(`/api/campaigns/${campaignId}/safety/x-card`, { method: "POST" });
  }, [campaignId]);

  // The voice dock's props as one object with a stable identity, so the
  // memoized header only re-renders when the call itself changes. Who is
  // speaking is not here: the dock reads it from the live store.
  const voiceSettings = campaign?.gameSettings?.voice;
  const turnEnforcement = voiceSettings?.turnEnforcement ?? "soft";
  const sayRangeRule = Boolean(voiceSettings?.rules?.sayRange);
  const transcribe = Boolean(voiceSettings?.transcribe);
  const floorUserIds =
    floor.mode === "spotlight" || floor.mode === "initiative" ? floor.userIds : EMPTY_IDS;
  const voice = useMemo(
    () => ({
      campaignId: campaignId ?? "",
      meUserId: meId,
      roster: state.voiceRoster,
      floorMode: floor.mode,
      floorUserIds,
      turnEnforcement,
      adjudicates: caps.adjudicates,
      steersStory,
      sayRangeRule,
      transcribe,
      audibilityVersion: state.voiceAudibilityVersion,
      meshSignal: state.voiceMeshSignal,
    }),
    [
      campaignId,
      meId,
      state.voiceRoster,
      floor.mode,
      floorUserIds,
      turnEnforcement,
      caps.adjudicates,
      steersStory,
      sayRangeRule,
      transcribe,
      state.voiceAudibilityVersion,
      state.voiceMeshSignal,
    ],
  );

  const releaseFloor = useCallback(async () => {
    await fetch(`/api/campaigns/${campaignId}/floor`, { method: "POST" });
  }, [campaignId]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const content = input.trim();
      if (!content || sending || gate.inputBlocked || muted) {
        return;
      }
      setSending(true);
      setError("");
      try {
        // A lead direction goes one of two ways. Public is a visible note the
        // table can read and the DM answers now; private arms the same
        // one-turn steer the event presets use, so no character hears it and
        // it never enters the transcript.
        const [route, body] =
          kind === "narrate"
            ? ["dm/narrate", { content, speaker }]
            : kind === "lead"
              ? leadPrivate
                ? ["director", { oneShot: null, absoluteCommand: content }]
                : ["lead-note", { content }]
              : ["actions", { content, kind }];
        const response = await fetch(`/api/campaigns/${campaignId}/${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
    [campaignId, input, sending, gate.inputBlocked, muted, kind, leadPrivate, speaker],
  );

  const clearChatTarget = useCallback(() => setChatTarget(null), []);
  // The board's HUD puts words in the composer and brings it forward.
  const [composerPulse, setComposerPulse] = useState(false);
  const composeFromBoard = useCallback(
    (text: string) => {
      setKind("do");
      setInput(text);
      setMobileView("chat");
      // Focus after the view switch has painted, and put the caret where
      // the blank is when the text leaves one ("I cast  at the goblin").
      window.setTimeout(() => {
        const area = composerRef.current;
        if (!area) {
          return;
        }
        area.focus();
        const gap = text.indexOf("  ");
        const at = gap >= 0 ? gap + 1 : text.length;
        area.setSelectionRange(at, at);
      }, 50);
    },
    [setMobileView],
  );
  // Your turn: one chime, one haptic, one gold pulse on the composer, when
  // the initiative lands on this player's figure. Opt-out in device settings.
  const turnTokenId = state.battleMap?.turn?.tokenId ?? null;
  const myTokenId = state.battleMap?.myTokenId ?? null;
  const turnRound = state.battleMap?.turn?.round ?? 0;
  const lastChimeRef = useRef("");
  useEffect(() => {
    if (!turnTokenId || !myTokenId || turnTokenId !== myTokenId) {
      return;
    }
    const key = `${turnTokenId}:${turnRound}`;
    if (lastChimeRef.current === key) {
      return;
    }
    lastChimeRef.current = key;
    if (!turnChime) {
      return;
    }
    playSting("turn");
    haptic("turn");
    // The pulse is a moment: on after this tick, off when the animation
    // has run (--dur-linger).
    const on = window.setTimeout(() => setComposerPulse(true), 0);
    const off = window.setTimeout(() => setComposerPulse(false), 1700);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, [turnTokenId, myTokenId, turnRound, turnChime, playSting]);
  // A pinned label on the board opens what it points at in a sheet.
  const [openedLabel, setOpenedLabel] = useState<MapLabel | null>(null);
  const openLabel = setOpenedLabel;
  const selectChatView = useCallback(() => setMobileView("chat"), [setMobileView]);
  const selectPanelView = useCallback(
    (tab: PanelTab) => {
      setPanelTab(tab);
      setMobileView("panel");
    },
    [setPanelTab, setMobileView],
  );
  const bumpPins = useCallback(() => setPinsVersion((count) => count + 1), []);
  const openLoreCheck = useCallback(
    (message: CampaignMessage, selection: string) => setLoreCheck({ message, selection }),
    [],
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
  const openStoryCapture = useCallback(() => selectPanelView("dm"), [selectPanelView]);
  // What a tour step needs on screen before it can point at anything: the
  // right side-panel tab, or on a phone the chat column.
  const hasBattleMap = Boolean(state.battleMap);
  const prepareTourStep = useCallback(
    (name: string) => {
      switch (name) {
        case "show-chat":
          setMobileView("chat");
          break;
        case "open-dm":
          selectPanelView("dm");
          break;
        case "open-party":
          selectPanelView("party");
          break;
        case "open-story":
          selectPanelView("story");
          break;
        case "open-map":
          selectPanelView(hasBattleMap ? "battle" : "map");
          break;
        case "open-chat":
          selectPanelView("chat");
          break;
      }
    },
    [selectPanelView, setMobileView, hasBattleMap],
  );
  const snoozeStory = useCallback(() => setBeatSnoozedUntil(snoozeUntil(Date.now())), []);
  // The cadence memo above only reruns on new messages or rolls, so at a
  // quiet table a snooze would outlive its own expiry. Clearing it when the
  // clock passes it recomputes the reminder with a fresh now.
  useEffect(() => {
    if (!beatSnoozedUntil) {
      return;
    }
    const remaining = Date.parse(beatSnoozedUntil) - Date.now();
    const timer = window.setTimeout(() => setBeatSnoozedUntil(null), Math.max(0, remaining) + 50);
    return () => window.clearTimeout(timer);
  }, [beatSnoozedUntil]);

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

  const storyDue = storyCadence.level !== "quiet";

  return (
    <main className="cine-stage flex h-dvh flex-col">
      {/* The cinematic frame ("ODM World Concepts" 3b): the scene's painting
          behind everything, the party down the left, the turn order along
          the top, the last roll as a pill. CinematicParts.tsx. */}
      <SceneBackdrop
        messages={messages}
        cover={campaign.cover}
        genre={campaign.genre}
        seed={campaign.id}
        dark={state.scene?.isDark}
      />
      <SessionHeader
        title={campaign.title}
        scene={campaign.scene}
        user={me}
        voice={voice}
        dice3d={dice3d}
        onToggleDice3d={toggleDice3d}
        onCustomizeDice={openDiceLook}
        shake={shake}
        ttsEnabled={Boolean(campaign.gameSettings?.ttsEnabled)}
        narration={narration}
        ambienceEnabled={Boolean(campaign.gameSettings?.ambienceEnabled)}
        ambience={ambience}
        onHelp={openHelp}
        ribbon={
          state.encounter?.status === "active" ? (
            <InitiativeRibbon
              encounter={state.encounter}
              sheets={sheets}
              genre={campaign.genre}
              onOpen={() => setPanelTab("party")}
            />
          ) : null
        }
      />

      <div className="cine-row flex min-h-0 flex-1">
        <PartyRail
          sheets={sheets}
          meUserId={me.id}
          encounter={state.encounter}
          genre={campaign.genre}
          onOpen={() => setPanelTab("party")}
        />
        <SessionChatColumn
          state={state}
          campaignId={campaign.id}
          meUserId={me.id}
          steersStory={steersStory}
          narration={narration}
          visible={mobileView === "chat"}
          askOpen={askOpen}
          onAskOpenChange={setAskOpen}
          refreshAsks={refreshAsks}
          refreshFacts={refreshFacts}
          onError={setError}
          onLoreCheck={openLoreCheck}
          onRenarrate={setRenarrate}
          onPinned={bumpPins}
        >
          {needsCharacter ? (
            <CharacterGate campaignId={campaign.id} />
          ) : (
            <Composer
              campaignId={campaign.id}
              trackAmmo={campaign.gameSettings?.variantRules?.ammunition ?? false}
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
              inputBlocked={gate.inputBlocked || muted}
              placeholder={muted ? "The party lead has muted you at this table." : gate.placeholder}
              dmStatus={dmStatus}
              pendingRolls={pendingRolls}
              members={state.members}
              floor={floor}
              spotlighted={gate.spotlighted}
              heldSpotlightNames={gate.heldSpotlightNames}
              encounter={state.encounter}
              onReleaseFloor={releaseFloor}
              joinBanner={joinBanner}
              composerRef={composerRef}
              highlight={composerPulse}
              directorArm={state.directorArm}
              leadPrivate={leadPrivate}
              onLeadPrivateChange={setLeadPrivate}
              speaker={speaker}
              onSpeakerChange={setSpeaker}
              cast={state.cast}
              onXCard={campaign.gameSettings?.safety?.xCard ? raiseXCard : undefined}
              storyCadence={storyCadence}
              onCaptureStory={openStoryCapture}
              onSnoozeStory={snoozeStory}
              onSubmit={submit}
            />
          )}
        </SessionChatColumn>

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
          floor={floor}
          directorArm={state.directorArm}
          isLead={isLead}
          leadUserId={campaign.leadUserId}
          canTransferLead={isLead || campaign.ownerUserId === me.id}
          spotlightUserIds={floor.mode === "spotlight" ? floor.userIds : EMPTY_IDS}
          onlineUserIds={state.online}
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
          fx={state.fx}
          onFxPlayed={markFxPlayed}
          camera={state.camera}
          onCameraDone={markCameraDone}
          onCompose={composeFromBoard}
          scene={state.scene}
          canDraw={caps.adjudicates || campaign.gameSettings?.boardDrawing !== false}
          onOpenLabel={openLabel}
          refreshBattleMap={refreshBattleMap}
          tabs={panelTabs}
          tab={panelTab}
          onTabChange={setPanelTab}
          pendingCount={pendingNoteCount}
          chatUnread={chatUnreadTotal}
          mobileVisible={mobileView === "panel"}
          relationshipsVersion={state.relationshipsVersion}
          factionsVersion={state.factionsVersion}
          shopsVersion={state.shopsVersion}
          coins={state.coins}
          activeSheetId={state.activeSheetId}
          questsVersion={state.questsVersion}
          cast={state.cast}
          relationshipsEnabled={relationshipsEnabled}
          beats={state.beats}
          storyDue={storyDue}
          glance={<QuestGlance quests={campaign.questLog ?? []} onOpen={() => setPanelTab("story")} />}
        />
      </div>

      <RollToast latestRoll={state.latestRoll} sheets={sheets} />

      <BottomTabBar
        tabs={panelTabs}
        mobileView={mobileView}
        panelTab={panelTab}
        onSelectChat={selectChatView}
        onSelectPanel={selectPanelView}
        chatUnread={chatUnreadTotal}
        pendingCount={pendingNoteCount}
        storyDue={storyDue}
        steersStory={steersStory}
      />

      {dice3d ? <DiceOverlay latestRoll={state.latestRoll} enabled /> : null}
      <SceneTitle card={state.titleCard} onShown={markTitleCardShown} />
      <SafetyPause campaignId={campaign.id} paused={state.safetyPause !== null} steersStory={steersStory} />
      <HandoutStage
        campaignId={campaign.id}
        handout={state.handout}
        userId={me?.id ?? ""}
        steersStory={steersStory}
        onDismiss={async (id) => {
          await fetch(`/api/campaigns/${campaign.id}/dm/invoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "dismiss_handout", args: { handoutId: id } }),
          });
        }}
      />
      <LabelSheet campaignId={campaign.id} label={openedLabel} onClose={() => setOpenedLabel(null)} />
      <DiceLookDialog open={diceLookOpen} onOpenChange={setDiceLookOpen} />

      <HelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        tours={[
          {
            label: "Tour the table",
            detail: "How a player takes a turn, asks the DM, and finds the party, the story and the maps.",
            onStart: () => setTour("player"),
          },
          ...(caps.adjudicates
            ? [
                {
                  label: "Tour the DM console",
                  detail: "The floor, story beats, hand-over switches, the queue and the tools.",
                  onStart: () => setTour("dm"),
                },
              ]
            : []),
        ]}
      />

      <GuidedTour
        open={tour !== null}
        steps={tour === "dm" ? DM_TOUR : PLAYER_TOUR}
        onPrepare={prepareTourStep}
        onClose={closeTour}
      />

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

      <RestMoment auditLog={auditLog} sheets={sheets} />
      <LootMoment sheet={mySheet} />
      <TravelBanner locations={locations} />

      {myLevelUp && mySheet && dismissedLevelUp !== `${myLevelUp.characterId}:${myLevelUp.level}` ? (
        celebratedLevelUp !== `${myLevelUp.characterId}:${myLevelUp.level}` ? (
          <LevelUpMoment
            sheet={mySheet}
            level={myLevelUp.level}
            onDone={() => setCelebratedLevelUp(`${myLevelUp.characterId}:${myLevelUp.level}`)}
          />
        ) : (
        <Suspense fallback={<MomentVeil />}>
          <LevelUpDialog
            campaignId={campaign.id}
            sheet={mySheet}
            targetLevel={myLevelUp.level}
            multiclassAllowed={campaign.gameSettings?.multiclassingEnabled ?? true}
            onDone={() => setDismissedLevelUp(`${myLevelUp.characterId}:${myLevelUp.level}`)}
          />
        </Suspense>
        )
      ) : null}
    </main>
  );
}
