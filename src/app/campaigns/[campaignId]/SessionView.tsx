"use client";

import { initiativeCharacter, selectedCharacter } from "@/lib/player-characters";
import { LevelUpMoment, LootMoment, MomentVeil, RestMoment, TravelBanner } from "@/app/campaigns/[campaignId]/Moments";
import { CoordinationPanel } from "@/app/campaigns/[campaignId]/CoordinationPanel";
import { haptic, useEffectsRoot, useTurnChime } from "@/lib/effects-mode";
import { levelForXp } from "@/lib/srd";
import { transcribesVoice, useCapabilities } from "@/lib/use-capabilities";
import { SceneTitle } from "@/components/SceneTitle";
import { askConcentrationSwap, isConcentrationQuestion } from "@/components/concentration-prompt";
import { HandoutStage } from "@/components/HandoutStage";
import { SafetyPause } from "@/app/campaigns/[campaignId]/SafetyPause";
import type { Speaker } from "@/lib/dm/speech";
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
import { composerLimit, textLength } from "@/lib/text-limits";
import type { TourEnd } from "@/lib/tours/account-logic";
import { DM_TOUR, DM_TOUR_ID, FIRST_TURN_TOUR, PLAYER_TOUR, PLAYER_TOUR_ID } from "@/lib/tours/table";
import { finishTour, useTourFinished } from "@/lib/tours/tour-store";
import { Composer, type InputKind } from "@/app/campaigns/[campaignId]/Composer";
import { composerGate } from "@/app/campaigns/[campaignId]/composerGate";
import { DiceOverlay } from "@/app/campaigns/[campaignId]/DiceOverlay";
import { secretAudience } from "@/lib/dice/secret-audience";
import {
  requestMotionAccess,
  supportsShake,
  useShakeToRoll,
  writeShakeToRoll,
} from "@/lib/dice/shake-to-roll";
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
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import { isPrimaryDm } from "@/lib/dm/viewer";
import Link from "next/link";
import { SidePanel } from "@/app/campaigns/[campaignId]/SidePanel";
import { useChatChime } from "@/app/campaigns/[campaignId]/useChatChime";
import { useTableAudio } from "@/app/campaigns/[campaignId]/useTableAudio";
import type { SoundSteering } from "@/app/campaigns/[campaignId]/SoundPanel";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { InitiativeRibbon, PartyRail, QuestGlance, RollToast, SceneBackdrop, TabletopChronicle } from "@/app/campaigns/[campaignId]/CinematicParts";
import {
  NarrationFailureBanner,
  useNarrationReplay,
  useNarrationStatus,
} from "@/app/campaigns/[campaignId]/NarrationFailureBanner";
import { turnFromEncounter, turnHudBudget } from "@/lib/battlemap/hand-table";

import { TabPane, useDocked } from "@/app/campaigns/[campaignId]/SidePanel";
import type { SidePanelRouterProps } from "@/app/campaigns/[campaignId]/SidePanelRouter";
import { TableRow } from "@/app/campaigns/[campaignId]/TableLayout";
import { ChronicleSplitter } from "@/app/campaigns/[campaignId]/TableLayoutParts";
import { useWideTable } from "@/app/campaigns/[campaignId]/table-layout-context";
import { revealPane, useTableLayout, type LayoutSeat } from "@/app/campaigns/[campaignId]/table-layout-store";
import { poppedTabs, tabPane } from "@/lib/table-layout";
import { PanelLoading, panels, preloadSidePanels } from "@/app/campaigns/[campaignId]/side-panel-loaders";
import { preloadable } from "@/lib/preloadable";

// The level-up dialog carries the class feature and resource tables of the
// whole SRD; it loads the first time a character actually levels rather
// than with the table.
const LevelUpDialog = lazy(() =>
  import("@/app/campaigns/[campaignId]/LevelUpDialog").then((module) => ({
    default: module.LevelUpDialog,
  })),
);

// What a table only needs when someone reaches for it: the dialogs, the
// tours, the character gate and the board. Each is its own download,
// fetched when the browser is idle after the table is up (with the side
// panels, side-panel-loaders.ts), so it is already here when it is opened.
// The dialogs that animate closed mount on first open and then stay
// mounted (useOpenedOnce), so their exit animation still plays.
const tablePieces = {
  HelpDialog: preloadable(() => import("@/components/HelpDialog").then((module) => module.HelpDialog)),
  GuidedTour: preloadable(() => import("@/components/ui/GuidedTour").then((module) => module.GuidedTour)),
  CharacterGate: preloadable(() => import("@/app/campaigns/[campaignId]/CharacterGate").then((module) => module.CharacterGate)),
  DiceLookDialog: preloadable(() => import("@/components/DiceLookEditor").then((module) => module.DiceLookDialog)),
  DiceTrayDialog: preloadable(() => import("@/app/campaigns/[campaignId]/DiceTrayDialog").then((module) => module.DiceTrayDialog)),
  LoreCheckDialog: preloadable(() => import("@/app/campaigns/[campaignId]/LoreCheckDialog").then((module) => module.LoreCheckDialog)),
  RenarrateDialog: preloadable(() => import("@/app/campaigns/[campaignId]/RenarrateDialog").then((module) => module.RenarrateDialog)),
  LabelSheet: preloadable(() => import("@/app/campaigns/[campaignId]/LabelSheet").then((module) => module.LabelSheet)),
};
const { HelpDialog, GuidedTour, CharacterGate, DiceLookDialog, DiceTrayDialog, LoreCheckDialog, RenarrateDialog, LabelSheet } = tablePieces;
const { BattleMapPanel } = panels;

// True from the first time `open` is true: a dialog mounts then and stays.
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) {
    setOpened(true);
  }
  return opened || open;
}

// Once the table is drawn and the browser has a moment, fetch what it may
// reach for next.
function usePreloadTable() {
  useEffect(() => {
    const preload = () => {
      preloadSidePanels();
      for (const piece of Object.values(tablePieces)) {
        void piece.preload().catch(() => undefined);
      }
    };
    const idle = typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(preload, { timeout: 3000 })
      : window.setTimeout(preload, 1500);
    return () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle as number);
      window.clearTimeout(idle as number);
    };
  }, []);
}

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
  // The party card's Level up button opened the dialog by hand.
  const [levelUpByHand, setLevelUpByHand] = useState(false);
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
  // "first" is the short first-turn tour a player meets by itself; "player"
  // and "dm" are the full tours Help plays.
  const [tour, setTour] = useState<"first" | "player" | "dm" | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dice3d = useSyncExternalStore(subscribeDicePref, readDice3d, () => true);
  const toggleDice3d = useCallback(() => {
    window.localStorage.setItem("odm:dice3d", dice3d ? "off" : "on");
    window.dispatchEvent(new Event(DICE3D_EVENT));
  }, [dice3d]);
  const [diceLookOpen, setDiceLookOpen] = useState(false);
  const openDiceLook = useCallback(() => setDiceLookOpen(true), []);
  const [diceTrayOpen, setDiceTrayOpen] = useState(false);
  const openDiceTray = useCallback(() => setDiceTrayOpen(true), []);
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  usePreloadTable();
  const helpMounted = useOpenedOnce(helpOpen);
  const diceLookMounted = useOpenedOnce(diceLookOpen);
  const diceTrayMounted = useOpenedOnce(diceTrayOpen);
  const tourMounted = useOpenedOnce(tour !== null);

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
  // Narration that was not read aloud, and the way to ask for it again
  // (issue 88): under the passage in the transcript, and above the composer
  // where a staged fight still shows it.
  const narrationStatus = useNarrationStatus(narration, state.narrationStatus);
  const replayNarration = useNarrationReplay(campaign?.id ?? "", narration, state.narrationAudio);
  const messageIds = useMemo(() => state.messages.map((message) => message.id), [state.messages]);
  const narrationNotice = useMemo(
    () => <NarrationFailureBanner messageIds={messageIds} status={narrationStatus} onRetry={replayNarration} />,
    [messageIds, narrationStatus, replayNarration],
  );
  // Chime on new private messages (side chats + DM whispers). The loaded
  // flags keep the page-load backlog silent.
  const chatUnreadTotal =
    state.sideThreads.reduce((sum, thread) => sum + thread.unread, 0) +
    state.whisperUnread +
    // A person in the DM seat: players' private messages still unanswered.
    state.dmInbox.filter((whisper) => !whisper.answered).length;
  useChatChime(chatUnreadTotal, state.sideChatLoaded && state.whispersLoaded);
  const pendingNoteCount = state.notes.filter((note) => note.status === "pending").length;
  // Two different authorities, deliberately separate. `isLead` owns the
  // table (campaign info, invites, who holds which seat). `caps` says who
  // owns the story, which is the lead in an AI campaign and the DM in a
  // human-run one; the server decided it, this only reads it. Computed up
  // here because the tab hook needs it to fall off the lead tab when the
  // seat moves.
  const isLead = Boolean(campaign && me && campaign.leadUserId === me.id);
  // The fight stage: while a board is on the table and the columns are
  // docked, the board takes the main column with the chronicle scroll
  // beside it, so a card is aimed at a board the size of the table rather
  // than a map in the side panel. The header switch shows the story there
  // instead; the choice is the reader's, kept per browser.
  const docked = useDocked();
  const [stageView, setStageView] = useState<"board" | "story">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("odm:stage-view") === "story" ? "story" : "board",
  );
  const toggleStage = useCallback(() => {
    setStageView((current) => {
      const next = current === "board" ? "story" : "board";
      window.localStorage.setItem("odm:stage-view", next);
      return next;
    });
  }, []);
  const { panelTab, setPanelTab, mobileView, setMobileView } = useSessionTabs({
    chatTarget,
    battleMap: state.battleMap,
    isLead,
  });

  // Everything below runs on every dm_delta while the DM narrates, so the
  // values handed to the memoized panels are stabilized with useMemo and
  // useCallback. All hooks must stay above the null guard further down.
  // Three "my character"s for a player fielding several
  // (src/lib/player-characters.ts): the selected one (Play as, in the party
  // panel), the one whose turn it is, and the one that acts: the turn's
  // character while it lasts, else the selected one. The Hand, the HUD and
  // the composer follow actingSheet; OOC stays with the selected one.
  // A seat that only has companions falls back to any sheet of theirs.
  const mySheet = useMemo(
    () => selectedCharacter(sheets, me?.id ?? "", state.activeSheetId) ?? sheets.find((sheet) => sheet.userId === me?.id) ?? null,
    [sheets, me?.id, state.activeSheetId],
  );
  const turnSheet = initiativeCharacter(sheets, me?.id ?? "", state.encounter?.acting?.id);
  const actingSheet = turnSheet ?? mySheet;
  // The server's notice opens the level-up dialog once, when the experience
  // lands. Closing it only puts it off: the sheet's experience still earns
  // the level, so the party card offers a Level up button until it is done.
  const noticeLevel = mySheet
    ? (levelUps.find((notice) => notice.characterId === mySheet.id)?.level ?? 0)
    : 0;
  const earnedLevel = mySheet && !mySheet.isCompanion ? Math.min(20, levelForXp(mySheet.xp)) : 0;
  const noticeKey =
    mySheet && noticeLevel > mySheet.level ? `${mySheet.id}:${noticeLevel}` : "";
  // The experience earns the level (a DM's milestone is an experience award);
  // levels are taken one at a time, so the next one is what is offered.
  const myLevelUp =
    mySheet && earnedLevel > mySheet.level
      ? { characterId: mySheet.id, level: mySheet.level + 1 }
      : undefined;
  const levelUpShown =
    Boolean(myLevelUp) && (levelUpByHand || (Boolean(noticeKey) && dismissedLevelUp !== noticeKey));
  // Memoized so the open-floor fallback object keeps a stable identity and
  // does not invalidate the memos below on every render.
  const floor = useMemo(() => campaign?.floor ?? { mode: "open" as const }, [campaign?.floor]);
  const isDm = caps.role === "dm";
  const steersStory = caps.steersStory;
  // Who may change what the table hears, for the header's sound panel.
  const sound = useMemo<SoundSteering>(
    () => ({
      campaignId: campaign?.id ?? "",
      canSteer: steersStory,
      auto: Boolean(campaign?.gameSettings?.ambienceAuto),
      isAdmin: Boolean((me as { isAdmin?: boolean } | null)?.isAdmin),
    }),
    [campaign?.id, campaign?.gameSettings?.ambienceAuto, steersStory, me],
  );
  if (isDm && !seenDmSeat) {
    setSeenDmSeat(true);
    setKind("narrate");
  }

  // The tour for this seat runs once per account, the first time the table
  // is sat at, after the layout has had a moment to settle; only a definite
  // "not finished" from the account opens it (issue #306). Help replays it.
  const tourId = isDm ? DM_TOUR_ID : PLAYER_TOUR_ID;
  const seatTourFinished = useTourFinished(tourId);
  // A phone starts the tour on the chat column: which steps apply is read
  // off the page before any step's prepare runs, and a fight with a map
  // opens the phone on the board, which would drop every composer step.
  const startTour = useCallback(
    (which: "first" | "player" | "dm") => {
      setMobileView("chat");
      setTour(which);
    },
    [setMobileView],
  );
  useEffect(() => {
    if (seatTourFinished !== false) return;
    const timer = window.setTimeout(() => startTour(isDm ? "dm" : "first"), 1200);
    return () => clearTimeout(timer);
  }, [seatTourFinished, isDm, startTour]);
  // The tour that was on screen is the one finished: Help can replay the
  // other seat's, and the seat can change while a tour is open.
  const closeTour = useCallback(
    (how: TourEnd) => {
      if (tour) finishTour(tour === "dm" ? DM_TOUR_ID : PLAYER_TOUR_ID, how);
      setTour(null);
    },
    [tour],
  );
  // The campaign's opening narration gets everyone's full attention: while
  // it plays for this user, do/say/lead input waits (OOC stays open).
  const firstDmMessageId = messages.find((message) => message.authorType === "dm")?.id;
  const openingNarrationPlaying =
    Boolean(firstDmMessageId) &&
    narration.playingMessageId === firstDmMessageId &&
    messages.filter((message) => message.authorType === "dm").length === 1;
  const myName = actingSheet?.name ?? "your character";
  const meId = me?.id ?? "";
  // Muted by the party lead: the server refuses the send, so the box says
  // so instead of letting the player type into a wall.
  const muted = Boolean(state.members.find((member) => member.userId === meId)?.muted);
  // An ended campaign refuses every new action (the actions route), so the
  // box says so the same way, and the story above it stays to be read.
  const ended = campaign?.status === "ended";
  const silenced = muted || ended;
  const silencedPlaceholder = ended
    ? "This campaign has ended. The story stays here to read."
    : "The party lead has muted you at this table.";
  const enemyTurns = state.encounter?.enemyTurns === true;
  const gate = useMemo(
    () =>
      composerGate({ floor, sheets, meUserId: meId, kind, myName, leadPrivate, openingNarrationPlaying, enemyTurns }),
    [floor, sheets, meId, kind, myName, leadPrivate, openingNarrationPlaying, enemyTurns],
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
  // The table's arrangement for this seat (client issue 46,
  // src/lib/table-layout.ts): which side-panel tabs have a pane of their
  // own, on a window wide enough for an arrangement at all. A tab with a
  // pane leaves the rail, so no panel is ever drawn twice; a phone keeps
  // every tab behind its bottom bar.
  const layoutSeat: LayoutSeat = isDm ? "dm" : "player";
  const tableLayout = useTableLayout(layoutSeat);
  const arranged = useWideTable();
  const popped = useMemo(() => (arranged ? poppedTabs(tableLayout) : []), [arranged, tableLayout]);
  const railTabs = useMemo(
    () => (popped.length ? panelTabs.filter(([id]) => !popped.includes(id)) : panelTabs),
    [panelTabs, popped],
  );
  const railTab = railTabs.some(([id]) => id === panelTab) ? panelTab : (railTabs[0]?.[0] ?? panelTab);
  // A Battle pane holds the board, so the fight stage leaves the table
  // column to the story and the header's switch has nothing to switch.
  const battlePane = popped.includes("battle");
  // Opens a tab wherever it lives: in the rail's panel, or in its own pane,
  // shown again and lit if it was set aside.
  const openTab = useCallback(
    (tab: PanelTab) => {
      if (popped.includes(tab)) {
        revealPane(layoutSeat, tabPane(tab));
      } else {
        setPanelTab(tab);
      }
    },
    [popped, layoutSeat, setPanelTab],
  );
  // A fight starting or a party card's Message picks a tab by itself
  // (useSessionTabs); when that tab has a pane, the pane is what is shown.
  const lastPanelTab = useRef(panelTab);
  useEffect(() => {
    if (lastPanelTab.current === panelTab) {
      return;
    }
    lastPanelTab.current = panelTab;
    if (popped.includes(panelTab)) {
      revealPane(layoutSeat, tabPane(panelTab));
    }
  }, [panelTab, popped, layoutSeat]);
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
  // Nothing records or announces a transcript the server cannot write.
  const capabilities = useCapabilities();
  const transcribe = Boolean(voiceSettings?.transcribe) && transcribesVoice(capabilities);
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
      // Over the mode's limit the box says so and keeps the draft (issue 207).
      if (!content || sending || gate.inputBlocked || silenced || textLength(content) > composerLimit(kind, leadPrivate)) {
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
              : ["actions", { content, kind, characterId: (kind === "ooc" ? mySheet : actingSheet)?.id }];
        const send = (extra: Record<string, unknown> = {}) =>
          fetch(`/api/campaigns/${campaignId}/${route}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, ...extra }),
          });
        let response = await send();
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          // A typed cast that ends the spell held now is asked about first
          // (issue 252); a no keeps the draft and spends nothing.
          if (route === "actions" && isConcentrationQuestion(response.status, data)) {
            const concentrationAck = await askConcentrationSwap(data);
            if (!concentrationAck) {
              return;
            }
            response = await send({ concentrationAck });
            if (!response.ok) {
              const again = await response.json().catch(() => ({}));
              setError(again.error || "Could not send your action.");
              return;
            }
          } else {
            setError(data.error || "Could not send your action.");
            return;
          }
        }
        setInput("");
      } catch {
        setError("Could not reach the server.");
      } finally {
        setSending(false);
      }
    },
    [campaignId, input, sending, gate.inputBlocked, silenced, kind, leadPrivate, speaker, mySheet, actingSheet],
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
  const labelMounted = useOpenedOnce(openedLabel !== null);
  const openLabel = setOpenedLabel;
  const selectChatView = useCallback(() => setMobileView("chat"), [setMobileView]);
  const selectPanelView = useCallback(
    (tab: PanelTab) => {
      openTab(tab);
      setMobileView("panel");
    },
    [openTab, setMobileView],
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
  // right side-panel tab, or on a phone the chat column. While the fight
  // stage holds the board, the Battle tab shows the party, so the maps
  // step opens the Map tab instead.
  const hasBattleMap = Boolean(state.battleMap);
  const boardStaged = docked && stageView === "board" && hasBattleMap && !battlePane;
  const boardInTab = hasBattleMap && !boardStaged;
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
          selectPanelView(boardInTab ? "battle" : "map");
          break;
        case "open-chat":
          selectPanelView("chat");
          break;
      }
    },
    [selectPanelView, setMobileView, boardInTab],
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
  const fightStaged = boardStaged;
  // Two copies of the scroll: the fight stage's has no composer (the desk
  // is right under the board); the enlarged board's keeps it (the dialog
  // covers the desk).
  const chronicleFor = (composer: boolean) => needsCharacter ? null : (
    <TabletopChronicle
      messages={messages}
      rolls={state.rolls}
      sheets={sheets}
      members={state.members}
      isDm={isDm}
      steersStory={steersStory}
      kind={kind}
      onKindChange={setKind}
      input={input}
      setInput={setInput}
      sending={sending}
      inputBlocked={gate.inputBlocked || silenced}
      placeholder={silenced ? silencedPlaceholder : gate.placeholder}
      onSubmit={submit}
      maxChars={composerLimit(kind, leadPrivate)}
      // The stage's copy opens the story for what its window leaves out;
      // the enlarged board's dialog covers the story, so it only says so.
      onShowStory={composer ? undefined : toggleStage}
      composer={composer}
    />
  );
  const chronicle = chronicleFor(false);
  const chronicleDesk = chronicleFor(true);

  // Everything a side-panel tab's content needs, shared by the side panel
  // and by any tab with a pane of its own (TabPane).
  const routerProps = {
    levelUpLevel: myLevelUp && !levelUpShown ? myLevelUp.level : null,
    onLevelUp: () => setLevelUpByHand(true),
    pinsVersion,
    campaignId: campaign.id,
    sheets,
    members: state.members,
    meUserId: me.id,
    steersStory,
    adjudicates: caps.adjudicates,
    dmCover: campaign.dmCover,
    messages: state.messages,
    dmIntents: state.dmIntents,
    floor,
    directorArm: state.directorArm,
    coordinating: Boolean(state.coordination),
    isLead,
    leadUserId: campaign.leadUserId,
    canTransferLead: isLead || campaign.ownerUserId === me.id,
    // The same pair the PATCH route lets end it: the owner, or the DM proper.
    canEndCampaign:
      campaign.ownerUserId === me.id ||
      isPrimaryDm(
        {
          dmMode: campaign.gameSettings?.dmMode ?? "ai",
          humanDmUserId: campaign.dmUserId,
          assistantDmUserId: campaign.assistantDmUserId,
        },
        me.id,
      ),
    spotlightUserIds: floor.mode === "spotlight" ? floor.userIds : EMPTY_IDS,
    onlineUserIds: state.online,
    auditLog,
    locations,
    chapters: state.chapters,
    notes: state.notes,
    facts: state.facts,
    characterEvents: state.characterEvents,
    refreshNotes,
    refreshFacts,
    sideThreads: state.sideThreads,
    refreshSideChat,
    whispers: state.whispers,
    whisperUnread: state.whisperUnread,
    dmInbox: state.dmInbox,
    refreshWhispers,
    chatTarget,
    onChatTargetHandled: clearChatTarget,
    onMessageUser: setChatTarget,
    mediaStatus: state.mediaStatus,
    inviteCode: campaign.inviteCode,
    midGameJoinOpen: campaign.gameSettings?.midGameJoinOpen ?? false,
    campaign,
    encounter: state.encounter,
    battleMap: state.battleMap,
    mapPing: state.mapPing,
    fx: state.fx,
    onFxPlayed: markFxPlayed,
    camera: state.camera,
    onCameraDone: markCameraDone,
    onCompose: composeFromBoard,
    scene: state.scene,
    canDraw: caps.adjudicates || campaign.gameSettings?.boardDrawing !== false,
    onOpenLabel: openLabel,
    refreshBattleMap,
    relationshipsVersion: state.relationshipsVersion,
    factionsVersion: state.factionsVersion,
    worldVersion: state.worldVersion,
    loreVersion: state.loreVersion,
    shopsVersion: state.shopsVersion,
    coins: state.coins,
    activeSheetId: state.activeSheetId,
    questsVersion: state.questsVersion,
    cast: state.cast,
    relationshipsEnabled,
    beats: state.beats,
    tabletopChronicle: chronicleDesk ?? undefined,
    stageBoard: fightStaged,
  } satisfies Omit<SidePanelRouterProps, "tab" | "visible" | "onOpenTab">;

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
        onRollDice={openDiceTray}
        shake={shake}
        ttsEnabled={Boolean(campaign.gameSettings?.ttsEnabled)}
        narration={narration}
        ambienceEnabled={Boolean(campaign.gameSettings?.ambienceEnabled)}
        ambience={ambience}
        sound={sound}
        onHelp={openHelp}
        stage={state.battleMap && docked && !battlePane ? { on: stageView === "board", onToggle: toggleStage } : undefined}
        layoutSeat={layoutSeat}
        ribbon={
          state.encounter?.status === "active" ? (
            <InitiativeRibbon
              encounter={state.encounter}
              sheets={sheets}
              genre={campaign.genre}
              onOpen={() => openTab("party")}
            />
          ) : null
        }
      />

      <TableRow
        seat={layoutSeat}
        active={arranged}
        tabs={panelTabs}
        panes={[
          {
            id: "rail",
            node: fightStaged ? null : (
              <PartyRail
                sheets={sheets}
                meUserId={me.id}
                encounter={state.encounter}
                genre={campaign.genre}
                onOpen={() => openTab("party")}
              />
            ),
          },
          {
            id: "table",
            node: (
              <SessionChatColumn
                stage={
                  fightStaged && state.battleMap ? (
                    <div className="cine-fight">
                      {chronicle}
                      {chronicle ? <ChronicleSplitter /> : null}
                      <div className="cine-fight-board cine-board-frame">
                        <Suspense fallback={<PanelLoading />}>
                        <BattleMapPanel
                          campaignId={campaign.id}
                          meUserId={me.id}
                          activeSheetId={state.activeSheetId}
                          multiCharacter={campaign.gameSettings?.multiCharacter ?? "off"}
                          view={state.battleMap}

                          intents={state.battleMap.intents}
                          genre={campaign.gameSettings?.genre ?? null}
                          turnBudget={
                            // The engine's count, the one the Hand reads
                            // (src/lib/battlemap/hand-table.ts): a spent reaction
                            // lives in reactionsUsed, not the turn budget.
                            actingSheet && !actingSheet.isCompanion && state.encounter
                              ? turnHudBudget(
                                  turnFromEncounter(state.encounter, actingSheet, {
                                    myTurn: state.encounter.turn?.ownerId === actingSheet.id,
                                  }),
                                )
                              : null
                          }
                          canDirect={caps.adjudicates}
                          canFocusPing={steersStory}
                          ping={state.mapPing ?? null}
                          fx={state.fx}
                          onFxPlayed={markFxPlayed}
                          camera={state.camera ?? null}
                          onCameraDone={markCameraDone}
                          onCompose={composeFromBoard}
                          sky={state.scene ?? null}
                          canDraw={caps.adjudicates || campaign.gameSettings?.boardDrawing !== false}
                          onOpenLabel={openLabel}
                          encounter={state.encounter ?? null}
                          sheets={sheets}
                          refreshBattleMap={refreshBattleMap}
                          chronicle={chronicleDesk}
                          visible
                        />
                        </Suspense>
                      </div>
                    </div>
                  ) : undefined
                }
                state={state}
                campaignId={campaign.id}
                meUserId={me.id}
                steersStory={steersStory}
                narrationStatus={narrationStatus}
                onReplayAudio={replayNarration}
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
                  <Suspense fallback={<PanelLoading />}>
                    <CharacterGate campaignId={campaign.id} />
                  </Suspense>
                ) : (
                  <>
                  {ended ? (
                    <SessionBanner
                      glyph="tab-campaigns"
                      tone="quiet"
                      className="campaign-ended-banner"
                      title="The campaign has ended"
                      actions={
                        <Link href="/" className={bannerButtonClass(true)}>
                          All campaigns
                        </Link>
                      }
                    >
                      Characters from a library took their progress home with them. The story stays
                      here to read.
                    </SessionBanner>
                  ) : null}
                  {/* The plan the party is coordinating (issue 254), above the
                      box its players would otherwise type their moves into. */}
                  {state.coordination ? (
                    <CoordinationPanel campaignId={campaign.id} phase={state.coordination} meUserId={me.id} steersStory={steersStory} />
                  ) : null}
                  <Composer
                    campaignId={campaign.id}
                    trackAmmo={campaign.gameSettings?.variantRules?.ammunition ?? false}
                    edges={state.battleMap?.edges}
                    sheets={sheets}
                    meUserId={me.id}
                    activeSheetId={state.activeSheetId}
                    steersStory={steersStory}
                    isDm={isDm}
                    kind={kind}
                    onKindChange={setKind}
                    input={input}
                    setInput={setInput}
                    sending={sending}
                    error={error}
                    inputBlocked={gate.inputBlocked || silenced}
                    placeholder={silenced ? silencedPlaceholder : gate.placeholder}
                    dmStatus={dmStatus}
                    dmJob={state.dmJob}
                    pendingRolls={pendingRolls}
                    members={state.members}
                    floor={floor}
                    spotlighted={gate.spotlighted}
                    heldSpotlightNames={gate.heldSpotlightNames}
                    encounter={state.encounter}
                    onReleaseFloor={releaseFloor}
                    joinBanner={joinBanner}
                    notice={narrationNotice}
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
                  </>
                )}
              </SessionChatColumn>
            ),
          },
          {
            id: "panel",
            node: (
              <SidePanel
                {...routerProps}
                tabs={railTabs}
                tab={railTab}
                onTabChange={openTab}
                pendingCount={pendingNoteCount}
                chatUnread={chatUnreadTotal}
                mobileVisible={mobileView === "panel"}
                storyDue={storyDue}
                glance={<QuestGlance quests={campaign.questLog ?? []} onOpen={() => openTab("story")} />}
              />
            ),
          },
          ...popped.flatMap((tab) => {
            const def = panelTabs.find(([id]) => id === tab);
            return def
              ? [{ id: tabPane(tab), node: <TabPane {...routerProps} paneTab={tab} paneLabel={def[1]} onOpenTab={openTab} /> }]
              : [];
          }),
        ]}
      />

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
        canTakeDown={caps.adjudicates}
        onDismiss={async (id) => {
          await fetch(`/api/campaigns/${campaign.id}/dm/invoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "dismiss_handout", args: { handoutId: id } }),
          });
        }}
      />
      <Suspense fallback={null}>
      {labelMounted ? (
        <LabelSheet campaignId={campaign.id} label={openedLabel} onClose={() => setOpenedLabel(null)} />
      ) : null}
      {diceLookMounted ? <DiceLookDialog open={diceLookOpen} onOpenChange={setDiceLookOpen} /> : null}
      {diceTrayMounted ? (
      <DiceTrayDialog
        open={diceTrayOpen}
        onOpenChange={setDiceTrayOpen}
        campaignId={campaign.id}
        audience={secretAudience({
          dmSeat: caps.adjudicates,
          steersStory: caps.steersStory,
          aiTable: campaign.gameSettings?.dmMode === "ai" || campaign.gameSettings?.dmMode === "steered",
        })}
      />
      ) : null}

      {helpMounted ? (
      <HelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        tours={[
          {
            label: "Tour the table",
            detail: "How a player takes a turn, asks the DM, and finds the party, the story and the maps.",
            onStart: () => startTour("player"),
          },
          ...(caps.adjudicates
            ? [
                {
                  label: "Tour the DM console",
                  detail: "The floor, story beats, hand-over switches, the queue and the tools.",
                  onStart: () => startTour("dm"),
                },
              ]
            : []),
        ]}
      />
      ) : null}

      {tourMounted ? (
      <GuidedTour
        open={tour !== null}
        steps={tour === "dm" ? DM_TOUR : tour === "first" ? FIRST_TURN_TOUR : PLAYER_TOUR}
        onPrepare={prepareTourStep}
        onClose={closeTour}
      />
      ) : null}

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
      </Suspense>

      <RestMoment auditLog={auditLog} sheets={sheets} />
      <LootMoment sheet={mySheet} />
      <TravelBanner locations={locations} />

      {myLevelUp && mySheet && levelUpShown ? (
        !levelUpByHand && celebratedLevelUp !== `${myLevelUp.characterId}:${myLevelUp.level}` ? (
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
            hpMethod={campaign.gameSettings?.hpMethod ?? "average"}
            onDone={() => {
              setDismissedLevelUp(noticeKey);
              setLevelUpByHand(false);
            }}
          />
        </Suspense>
        )
      ) : null}
    </main>
  );
}
