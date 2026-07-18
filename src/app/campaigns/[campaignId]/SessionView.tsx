"use client";

import Link from "next/link";
import { Dices, Loader2, Send, Volume2, VolumeX } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import { LevelUpDialog } from "@/app/campaigns/[campaignId]/LevelUpDialog";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import { SidePanel } from "@/app/campaigns/[campaignId]/SidePanel";
import { useNarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

type InputKind = "do" | "say" | "ooc" | "lead";

export function SessionView({ state }: { state: CampaignState }) {
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

  const narration = useNarrationAudio();
  // Only tts_ready events newer than the seq present when the snapshot first
  // loaded autoplay; the backlog stays silent (replay buttons cover history).
  const mountSeqRef = useRef<number | null>(null);
  const { latestTts, loading, lastSeq } = state;
  const { onTtsReady } = narration;
  useEffect(() => {
    if (mountSeqRef.current === null && !loading) {
      mountSeqRef.current = lastSeq;
      return;
    }
    if (latestTts && mountSeqRef.current !== null) {
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

  async function releaseFloor() {
    await fetch(`/api/campaigns/${campaign!.id}/floor`, { method: "POST" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) {
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
      <header className="flex items-center justify-between border-b border-stone-800/80 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <PixelTile src={PIXEL_ICONS.story} size="size-9" />
          <div className="min-w-0">
            <h1 className="truncate font-serif leading-tight text-stone-100">{campaign.title}</h1>
            <p className="truncate text-xs text-stone-500">
              {campaign.scene || "The adventure unfolds"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {campaign.gameSettings?.ttsEnabled ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  narration.unlock();
                  narration.setMuted(!narration.muted);
                }}
                title={
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
              {narration.unlocked && !narration.muted ? (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={narration.volume}
                  onChange={(event) => narration.setVolume(Number(event.target.value))}
                  className="w-16 accent-amber-600"
                  title="Narration volume"
                />
              ) : null}
            </div>
          ) : null}
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
            dmStatus={dmStatus}
            dmDraft={dmDraft}
            mediaStatus={state.mediaStatus}
            onReplayAudio={
              campaign.gameSettings?.ttsEnabled
                ? (messageId) => {
                    narration.unlock();
                    narration.play(
                      state.narrationAudio[messageId] ??
                        `/generated-audio/${campaign!.id}/${messageId}.mp3`,
                    );
                  }
                : undefined
            }
          />

          <form onSubmit={submit} className="border-t border-stone-800 p-3">
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
            {floor.mode === "spotlight" ? (
              <div className="mb-2 flex items-center justify-between rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-1.5 text-xs">
                <span className="flex items-center gap-1.5 text-amber-200">
                  <span className="flex -space-x-1.5">
                    {spotlighted
                      .filter((sheet) => sheet.portrait)
                      .slice(0, 4)
                      .map((sheet) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={sheet.id}
                          src={sheet.portrait!.url}
                          alt=""
                          className="size-5 rounded-full border border-amber-900 object-cover"
                        />
                      ))}
                  </span>
                  <span>
                    Spotlight:{" "}
                    {spotlighted.map((sheet) => sheet.name).join(", ") || "someone"}
                    {floor.prompt ? (
                      <span className="text-amber-200/80"> · {floor.prompt}</span>
                    ) : null}
                  </span>
                </span>
                {isLead ? (
                  <button
                    type="button"
                    onClick={releaseFloor}
                    className="ml-3 shrink-0 text-amber-200 hover:text-amber-300"
                  >
                    Release
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="mb-2 flex gap-1.5">
              {(["do", "say", "ooc", ...(isLead ? (["lead"] as const) : [])] as const).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setKind(option)}
                    title={
                      option === "lead"
                        ? "Party lead: send an authoritative story direction to the DM"
                        : undefined
                    }
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium",
                      kind === option
                        ? option === "lead"
                          ? "bg-amber-600 text-stone-950"
                          : "bg-amber-200 text-stone-950"
                        : "bg-stone-900 text-stone-400 hover:text-stone-200",
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
                ),
              )}
              {dmStatus !== "idle" ? (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-stone-500">
                  <Dices className="size-3.5 animate-bounce text-amber-600" />
                  DM at work...
                </span>
              ) : null}
            </div>
            <div className="flex items-end gap-2 rounded-2xl border border-stone-700/80 bg-stone-950 p-2 focus-within:border-amber-300/60">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(event);
                  }
                }}
                rows={2}
                disabled={floorBlocked}
                placeholder={
                  floorBlocked
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
                disabled={floorBlocked}
                onTranscript={(text) =>
                  setInput((current) => (current ? `${current} ${text}` : text))
                }
              />
              <button
                type="submit"
                disabled={sending || !input.trim() || floorBlocked}
                className="rounded-lg bg-amber-200 p-2.5 text-stone-950 hover:bg-amber-100 disabled:opacity-40"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
            {error ? <p className="mt-1.5 text-sm text-red-400">{error}</p> : null}
          </form>
        </div>

        <SidePanel
          campaignId={campaign.id}
          sheets={sheets}
          meUserId={me.id}
          isLead={isLead}
          leadUserId={campaign.leadUserId}
          canTransferLead={isLead || campaign.ownerUserId === me.id}
          onAdjustHp={adjustHp}
          spotlightUserIds={floor.mode === "spotlight" ? floor.userIds : []}
          auditLog={auditLog}
          locations={locations}
          chapters={state.chapters}
          mediaStatus={state.mediaStatus}
          mapsEnabled={campaign.gameSettings?.mapsEnabled ?? true}
        />
      </div>

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
