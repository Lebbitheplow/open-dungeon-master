"use client";

import {
  type FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { JOIN_NOTE_PREFIX, latestUnintroducedJoin } from "@/lib/campaign-types";
import { HelpDialog } from "@/components/HelpDialog";
import { CharacterGate } from "@/app/campaigns/[campaignId]/CharacterGate";
import { Composer, type InputKind } from "@/app/campaigns/[campaignId]/Composer";
import { composerGate } from "@/app/campaigns/[campaignId]/composerGate";
import { DiceOverlay } from "@/app/campaigns/[campaignId]/DiceOverlay";
import { LevelUpDialog } from "@/app/campaigns/[campaignId]/LevelUpDialog";
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

function subscribeDicePref(callback: () => void) {
  window.addEventListener("odm-dice3d-pref", callback);
  return () => window.removeEventListener("odm-dice3d-pref", callback);
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
}: {
  state: CampaignState;
  refreshNotes: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  refreshSideChat: () => Promise<void>;
  refreshWhispers: () => Promise<void>;
  refreshAsks: () => Promise<void>;
  refreshBattleMap: () => Promise<void>;
}) {
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
  // The Ask strip sits in the chat column and starts closed. It owns the rest
  // of the feature itself; all this view keeps is whether it is expanded.
  const [askOpen, setAskOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [dismissedLevelUp, setDismissedLevelUp] = useState("");
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
            ? ["dm/narrate", { content }]
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
    [campaignId, input, sending, gate.inputBlocked, muted, kind, leadPrivate],
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
  const snoozeStory = useCallback(() => setBeatSnoozedUntil(snoozeUntil(Date.now())), []);

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
    <main className="flex h-dvh flex-col">
      <SessionHeader
        title={campaign.title}
        scene={campaign.scene}
        voice={{
          campaignId: campaign.id,
          meUserId: me.id,
          roster: state.voiceRoster,
          speaking: state.voiceSpeaking,
          floorMode: floor.mode,
          floorUserIds:
            floor.mode === "spotlight" || floor.mode === "initiative" ? floor.userIds : [],
          turnEnforcement: campaign.gameSettings?.voice?.turnEnforcement ?? "soft",
          adjudicates: caps.adjudicates,
          steersStory,
          sayRangeRule: Boolean(campaign.gameSettings?.voice?.rules?.sayRange),
          audibilityVersion: state.voiceAudibilityVersion,
          meshSignal: state.voiceMeshSignal,
        }}
        dice3d={dice3d}
        onToggleDice3d={toggleDice3d}
        ttsEnabled={Boolean(campaign.gameSettings?.ttsEnabled)}
        narration={narration}
        ambienceEnabled={Boolean(campaign.gameSettings?.ambienceEnabled)}
        ambience={ambience}
        onHelp={() => setHelpOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
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
              floor={floor}
              spotlighted={gate.spotlighted}
              heldSpotlightNames={gate.heldSpotlightNames}
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
          spotlightUserIds={floor.mode === "spotlight" ? floor.userIds : []}
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
          storyDue={storyDue}
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
        storyDue={storyDue}
        steersStory={steersStory}
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

      {myLevelUp && mySheet && dismissedLevelUp !== `${myLevelUp.characterId}:${myLevelUp.level}` ? (
        <LevelUpDialog
          campaignId={campaign.id}
          sheet={mySheet}
          targetLevel={myLevelUp.level}
          multiclassAllowed={campaign.gameSettings?.multiclassingEnabled ?? true}
          onDone={() => setDismissedLevelUp(`${myLevelUp.characterId}:${myLevelUp.level}`)}
        />
      ) : null}
    </main>
  );
}
