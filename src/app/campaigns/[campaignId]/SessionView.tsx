"use client";

import Link from "next/link";
import { CircleHelp, Dices, DoorOpen, Volume2, VolumeX } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { JOIN_NOTE_PREFIX, latestUnintroducedJoin } from "@/lib/campaign-types";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import { HelpDialog } from "@/components/HelpDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { CharacterGate } from "@/app/campaigns/[campaignId]/CharacterGate";
import { Composer, type InputKind } from "@/app/campaigns/[campaignId]/Composer";
import { DiceOverlay } from "@/app/campaigns/[campaignId]/DiceOverlay";
import { LevelUpDialog } from "@/app/campaigns/[campaignId]/LevelUpDialog";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import {
  BottomTabBar,
  buildPanelTabs,
  useSessionTabs,
} from "@/app/campaigns/[campaignId]/SessionTabs";
import { SidePanel } from "@/app/campaigns/[campaignId]/SidePanel";
import { useChatChime } from "@/app/campaigns/[campaignId]/useChatChime";
import { useNarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

function subscribeDicePref(callback: () => void) {
  window.addEventListener("odm-dice3d-pref", callback);
  return () => window.removeEventListener("odm-dice3d-pref", callback);
}

export function SessionView({
  state,
  refreshNotes,
  refreshSideChat,
  refreshWhispers,
  refreshBattleMap,
}: {
  state: CampaignState;
  refreshNotes: () => Promise<void>;
  refreshSideChat: () => Promise<void>;
  refreshWhispers: () => Promise<void>;
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
    dmDraft,
  } = state;
  const [input, setInput] = useState("");
  const [kind, setKind] = useState<InputKind>("do");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [dismissedLevelUp, setDismissedLevelUp] = useState("");
  const [dismissedJoinNotice, setDismissedJoinNotice] = useState("");
  // "Message" on a party card: SidePanel switches to the chat tab and opens
  // the 1:1 thread with this user.
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dice3d = useSyncExternalStore(
    subscribeDicePref,
    () => window.localStorage.getItem("odm:dice3d") !== "off",
    () => true,
  );

  function toggleDice3d() {
    window.localStorage.setItem("odm:dice3d", dice3d ? "off" : "on");
    window.dispatchEvent(new Event("odm-dice3d-pref"));
  }

  const narration = useNarrationAudio();
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

  if (!campaign || !me) {
    return null;
  }

  const mySheet = sheets.find((sheet) => sheet.userId === me.id);
  const myLevelUp = mySheet
    ? levelUps.find((notice) => notice.characterId === mySheet.id)
    : undefined;
  const floor = campaign.floor ?? { mode: "open" as const };
  const isLead = campaign.leadUserId === me.id;
  const spotlighted =
    floor.mode === "spotlight"
      ? sheets.filter((sheet) => floor.userIds.includes(sheet.userId))
      : [];
  const floorBlocked =
    floor.mode === "spotlight" &&
    !floor.userIds.includes(me.id) &&
    kind !== "ooc" &&
    kind !== "lead";
  // Held responses: the lead has not opened the floor after the last DM
  // narration. OOC and lead directions stay available.
  const holdBlocked = floor.mode === "hold" && kind !== "ooc" && kind !== "lead";
  // Combat: only the current-turn player acts; everyone else waits.
  const initiativeBlocked =
    floor.mode === "initiative" &&
    !floor.userIds.includes(me.id) &&
    kind !== "ooc" &&
    kind !== "lead";
  const heldSpotlightNames =
    floor.mode === "hold" && floor.next.mode === "spotlight"
      ? sheets
          .filter((sheet) => floor.next.mode === "spotlight" && floor.next.userIds.includes(sheet.userId))
          .map((sheet) => sheet.name)
      : [];
  // The campaign's opening narration gets everyone's full attention: while
  // it plays for this user, do/say/lead input waits (OOC stays open).
  const firstDmMessageId = messages.find((message) => message.authorType === "dm")?.id;
  const openingNarrationPlaying =
    Boolean(firstDmMessageId) &&
    narration.playingMessageId === firstDmMessageId &&
    messages.filter((message) => message.authorType === "dm").length === 1;
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
              : kind === "ooc"
                ? "Out-of-character note to the table"
                : "Steer the story: an event or direction the DM must weave in";
  // A mid-game joiner without a character is gated to creation first.
  const needsCharacter = !mySheet && campaign.status === "active";
  // Lead prompt: a newcomer's join note the DM has not narrated past yet.
  const joinNotice = latestUnintroducedJoin(messages);
  const showJoinBanner =
    isLead && joinNotice !== null && dismissedJoinNotice !== joinNotice.id;
  const panelTabs = buildPanelTabs({
    hasBattleMap: Boolean(state.battleMap),
    mapsEnabled: campaign.gameSettings?.mapsEnabled ?? true,
    hasSettings: Boolean(campaign),
  });

  async function releaseFloor() {
    await fetch(`/api/campaigns/${campaign!.id}/floor`, { method: "POST" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending || inputBlocked) {
      return;
    }
    setSending(true);
    setError("");
    try {
      const response =
        kind === "lead"
          ? await fetch(`/api/campaigns/${campaign!.id}/lead-note`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content }),
            })
          : await fetch(`/api/campaigns/${campaign!.id}/actions`, {
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
  }

  async function adjustHp(delta: number) {
    if (!mySheet) {
      return;
    }
    await fetch(`/api/campaigns/${campaign!.id}/sheet`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentHp: Math.max(0, Math.min(mySheet.maxHp, mySheet.currentHp + delta)),
      }),
    });
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
            <div className="flex items-center gap-1.5">
              <Tooltip
                content={
                  !narration.unlocked
                    ? "Enable narration audio"
                    : narration.muted
                      ? "Unmute narration"
                      : "Mute narration"
                }
                side="bottom"
              >
                <button
                  type="button"
                  onClick={() => {
                    narration.unlock();
                    narration.setMuted(!narration.muted);
                  }}
                  aria-label={
                    !narration.unlocked
                      ? "Enable narration audio"
                      : narration.muted
                        ? "Unmute narration"
                        : "Mute narration"
                  }
                  className={cn(
                    "rounded-md border p-2.5 sm:p-1.5",
                    narration.muted || !narration.unlocked
                      ? "border-stone-700 text-stone-500 hover:text-stone-300"
                      : "border-amber-800 bg-amber-950/40 text-amber-400",
                  )}
                >
                  {narration.muted || !narration.unlocked ? (
                    <VolumeX className="size-4" />
                  ) : (
                    <Volume2 className="size-4" />
                  )}
                </button>
              </Tooltip>
              {narration.unlocked && !narration.muted ? (
                <Tooltip content="Narration volume" side="bottom">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={narration.volume}
                    onChange={(event) => narration.setVolume(Number(event.target.value))}
                    className="hidden w-16 accent-amber-600 sm:block"
                    aria-label="Narration volume"
                  />
                </Tooltip>
              ) : null}
            </div>
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
            rolls={rolls}
            sheets={sheets}
            members={state.members}
            locations={locations}
            dmStatus={dmStatus}
            dmDraft={dmDraft}
            mediaStatus={state.mediaStatus}
            onReplayAudio={
              campaign.gameSettings?.ttsEnabled
                ? (messageId) => {
                    narration.unlock();
                    narration.play(
                      messageId,
                      state.narrationAudio[messageId] ??
                        `/generated-audio/${campaign!.id}/${messageId}.mp3`,
                    );
                  }
                : undefined
            }
          />

          {needsCharacter ? (
            <CharacterGate campaignId={campaign.id} />
          ) : (
            <Composer
              campaignId={campaign.id}
              sheets={sheets}
              meUserId={me.id}
              isLead={isLead}
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
              joinBanner={
                showJoinBanner
                  ? {
                      text: joinNotice.content.slice(JOIN_NOTE_PREFIX.length),
                      onWriteIntro: () => {
                        setKind("lead");
                        composerRef.current?.focus();
                      },
                      onDismiss: () => setDismissedJoinNotice(joinNotice.id),
                    }
                  : null
              }
              composerRef={composerRef}
              onSubmit={submit}
            />
          )}
        </div>

        <SidePanel
          campaignId={campaign.id}
          sheets={sheets}
          members={state.members}
          meUserId={me.id}
          isLead={isLead}
          leadUserId={campaign.leadUserId}
          canTransferLead={isLead || campaign.ownerUserId === me.id}
          onAdjustHp={adjustHp}
          spotlightUserIds={floor.mode === "spotlight" ? floor.userIds : []}
          auditLog={auditLog}
          locations={locations}
          chapters={state.chapters}
          notes={state.notes}
          characterEvents={state.characterEvents}
          refreshNotes={refreshNotes}
          sideThreads={state.sideThreads}
          refreshSideChat={refreshSideChat}
          whispers={state.whispers}
          whisperUnread={state.whisperUnread}
          refreshWhispers={refreshWhispers}
          chatTarget={chatTarget}
          onChatTargetHandled={() => setChatTarget(null)}
          onMessageUser={setChatTarget}
          mediaStatus={state.mediaStatus}
          inviteCode={campaign.inviteCode}
          midGameJoinOpen={campaign.gameSettings?.midGameJoinOpen ?? false}
          campaign={campaign}
          encounter={state.encounter}
          battleMap={state.battleMap}
          refreshBattleMap={refreshBattleMap}
          tabs={panelTabs}
          tab={panelTab}
          onTabChange={setPanelTab}
          pendingCount={pendingNoteCount}
          chatUnread={chatUnreadTotal}
          mobileVisible={mobileView === "panel"}
        />
      </div>

      <BottomTabBar
        tabs={panelTabs}
        mobileView={mobileView}
        panelTab={panelTab}
        onSelectChat={() => setMobileView("chat")}
        onSelectPanel={(tab) => {
          setPanelTab(tab);
          setMobileView("panel");
        }}
        chatUnread={chatUnreadTotal}
        pendingCount={pendingNoteCount}
      />

      <DiceOverlay latestRoll={state.latestRoll} enabled={dice3d} />

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      {myLevelUp &&
      mySheet &&
      dismissedLevelUp !== `${myLevelUp.characterId}:${myLevelUp.level}` ? (
        <LevelUpDialog
          campaignId={campaign.id}
          sheet={mySheet}
          targetLevel={myLevelUp.level}
          onDone={() =>
            setDismissedLevelUp(`${myLevelUp.characterId}:${myLevelUp.level}`)
          }
        />
      ) : null}
    </main>
  );
}
