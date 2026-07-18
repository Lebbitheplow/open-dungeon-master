"use client";

import Link from "next/link";
import { CircleHelp, Dices, Loader2, Send, Volume2, VolumeX } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { JOIN_NOTE_PREFIX, latestUnintroducedJoin } from "@/lib/campaign-types";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import { HelpDialog } from "@/components/HelpDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { CharacterGate } from "@/app/campaigns/[campaignId]/CharacterGate";
import { DiceOverlay } from "@/app/campaigns/[campaignId]/DiceOverlay";
import { FloorBanners } from "@/app/campaigns/[campaignId]/FloorBanners";
import { LevelUpDialog } from "@/app/campaigns/[campaignId]/LevelUpDialog";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import { NewAdventurerBanner } from "@/app/campaigns/[campaignId]/NewAdventurerBanner";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import { SidePanel } from "@/app/campaigns/[campaignId]/SidePanel";
import { useNarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

type InputKind = "do" | "say" | "ooc" | "lead";

const KIND_TIPS: Record<InputKind, string> = {
  do: "Act in the world. The DM narrates what happens.",
  say: "Speak in character. Sent as dialogue in quotes.",
  ooc: "Table talk. The DM does not respond, and it works even when the floor is locked.",
  lead: "Party lead only. Send the DM an authoritative story direction.",
};

function subscribeDicePref(callback: () => void) {
  window.addEventListener("odm-dice3d-pref", callback);
  return () => window.removeEventListener("odm-dice3d-pref", callback);
}

export function SessionView({
  state,
  refreshNotes,
  refreshSideChat,
}: {
  state: CampaignState;
  refreshNotes: () => Promise<void>;
  refreshSideChat: () => Promise<void>;
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
  const inputBlocked = floorBlocked || holdBlocked || narrationBlocked;
  // A mid-game joiner without a character is gated to creation first.
  const needsCharacter = !mySheet && campaign.status === "active";
  // Lead prompt: a newcomer's join note the DM has not narrated past yet.
  const joinNotice = latestUnintroducedJoin(messages);
  const showJoinBanner =
    isLead && joinNotice !== null && dismissedJoinNotice !== joinNotice.id;

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
      <header className="glass z-10 flex items-center justify-between border-b border-stone-700/40 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <PixelTile src={PIXEL_ICONS.story} size="size-9" />
          <div className="min-w-0">
            <h1 className="truncate font-display leading-tight tracking-wide text-amber-50">{campaign.title}</h1>
            <p className="truncate text-xs text-stone-500">
              {campaign.scene || "The adventure unfolds"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Tooltip
            content={dice3d ? "Turn off 3D dice animation" : "Turn on 3D dice animation"}
            side="bottom"
          >
            <button
              type="button"
              onClick={toggleDice3d}
              aria-label={dice3d ? "Turn off 3D dice animation" : "Turn on 3D dice animation"}
              className={cn(
                "rounded-md border p-1.5",
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
                    "rounded-md border p-1.5",
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
                    className="w-16 accent-amber-600"
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
              className="rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-stone-300"
            >
              <CircleHelp className="size-4" />
            </button>
          </Tooltip>
          <Link href="/" className="text-sm text-stone-500 hover:text-stone-300">
            All campaigns
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
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
          <form
            onSubmit={submit}
            className="glass border-t border-stone-700/40 px-3 pb-3 pt-2.5"
          >
            <div className="mx-auto max-w-3xl sm:px-3">
            {pendingRolls.map((pending) => (
              <PendingRollCard
                key={pending.id}
                campaignId={campaign.id}
                pending={pending}
                sheets={sheets}
                meUserId={me.id}
                isLead={isLead}
              />
            ))}
            <FloorBanners
              floor={floor}
              spotlighted={spotlighted}
              heldSpotlightNames={heldSpotlightNames}
              isLead={isLead}
              onRelease={releaseFloor}
            />
            {showJoinBanner ? (
              <NewAdventurerBanner
                campaignId={campaign.id}
                text={joinNotice.content.slice(JOIN_NOTE_PREFIX.length)}
                onWriteIntro={() => {
                  setKind("lead");
                  composerRef.current?.focus();
                }}
                onDismiss={() => setDismissedJoinNotice(joinNotice.id)}
              />
            ) : null}
            <div className="mb-2 flex gap-1.5">
              {(["do", "say", "ooc", ...(isLead ? (["lead"] as const) : [])] as const).map(
                (option) => (
                  <Tooltip key={option} content={KIND_TIPS[option]}>
                    <button
                      type="button"
                      onClick={() => setKind(option)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-all duration-150 ease-snap active:scale-95",
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
                    submit(event);
                  }
                }}
                rows={2}
                disabled={inputBlocked}
                placeholder={
                  narrationBlocked
                    ? "The Dungeon Master is setting the scene... (OOC still open)"
                    : holdBlocked
                    ? "The party lead has the floor held for discussion... (OOC still open)"
                    : floorBlocked
                    ? `Waiting on ${spotlighted.map((sheet) => sheet.name).join(", ")}... (OOC still open)`
                    : kind === "do"
                      ? `What does ${mySheet?.name ?? "your character"} do?`
                      : kind === "say"
                        ? `What does ${mySheet?.name ?? "your character"} say?`
                        : kind === "ooc"
                          ? "Out-of-character note to the table"
                          : "Steer the story: an event or direction the DM must weave in"
                }
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
          chatTarget={chatTarget}
          onChatTargetHandled={() => setChatTarget(null)}
          onMessageUser={setChatTarget}
          mediaStatus={state.mediaStatus}
          mapsEnabled={campaign.gameSettings?.mapsEnabled ?? true}
          inviteCode={campaign.inviteCode}
          midGameJoinOpen={campaign.gameSettings?.midGameJoinOpen ?? false}
          campaign={campaign}
        />
      </div>

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
